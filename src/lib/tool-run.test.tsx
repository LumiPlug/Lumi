// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createCapabilityDefinition } from '@lumiplug/shared'
import type { CapabilityField, JsonSchema, ToolTask } from '@lumiplug/shared'
import {
  needsRunInput,
  multilineRunField,
  prepareRunInputs,
  runParameterPreview,
  runTargetDetails,
  runLogText,
  prepareManualInputs,
  runFieldValue,
  runConfigurationPreview,
  runResultMarkdown,
} from './tool-run'
import ToolRunPanel, { TaskResult, RunProcess } from '../components/ToolRunPanel'
import { terminalOutputText } from './terminal-output'
import { RunTerminalParameters } from '../components/RunTerminalParameters'
import { Input } from '../components/ui'
vi.mock('../components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastViewport: () => {},
}))
const field = (key: string, schema: JsonSchema, required = true): CapabilityField => ({
  key,
  schema,
  required,
  aiVisible: true,
  value: null,
  binding: null,
})
function definition(fields: CapabilityField[]) {
  const def = createCapabilityDefinition({
    kind: 'terminal',
    name: '测试工具',
    namespace: 'review',
    command: 'echo ok',
  })
  def.tools[0]!.fields = fields
  def.enabled = true
  def.status = 'ready'
  return def
}
const task: ToolTask = {
  id: 'other-task',
  capabilityId: 'test',
  capabilityName: '测试工具',
  operation: 'review.run',
  version: 1,
  runnerType: 'terminal',
  source: 'ai',
  status: 'completed',
  startedAt: '2026-10-05T00:00:00Z',
  finishedAt: '2026-10-05T00:00:01Z',
  result: { stdout: '上次历史结果', stderr: '', exitCode: 0 },
  error: null,
  stdout: '上次历史结果',
  stderr: '',
  truncated: false,
  cancellationUncertain: false,
}
describe('current run parameters and result', () => {
  it('chooses stable multiline controls without changing numeric/boolean/enum or private inputs', () => {
    for (const schema of [
      { type: 'array' },
      { type: 'object' },
      { type: 'string', maxLength: 500 },
      { type: 'string', default: 'line1\nline2' },
    ])
      expect(multilineRunField(field('content', schema as JsonSchema))).toBe(true)
    for (const schema of [
      { type: 'integer' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'string', enum: ['a', 'b'] },
      { type: 'string', maxLength: 80 },
    ])
      expect(multilineRunField(field('content', schema as JsonSchema))).toBe(false)
    expect(multilineRunField({ ...field('secret', { type: 'string' }), aiVisible: false })).toBe(
      false,
    )
    const text = 'literal\n$(do_not_execute)\n第三行'
    const parsed = prepareManualInputs(
      definition([field('content', { type: 'string' })]).tools[0]!,
      { content: text },
    )
    expect(parsed).toEqual({ ok: true, args: { content: text }, fixedParameters: {} })
  })
  it('groups required inputs first, retains optional defaults, and expands an optional error with associated help', () => {
    const optional = field(
      'NOTE',
      { type: 'string', title: '备注', description: '可保留默认值', default: 'preset' },
      false,
    )
    const required = field('NAME', { type: 'string', description: '必填说明' })
    const render = (error?: { key: string; message: string }) =>
      renderToStaticMarkup(
        <RunTerminalParameters
          fields={[optional, required]}
          error={error}
          renderValue={(f, describedBy, id) => (
            <Input id={id} aria-describedby={describedBy} value={runFieldValue(f, {})} readOnly />
          )}
        />,
      )
    const normal = render()
    expect(normal.indexOf('>NAME</label>')).toBeLessThan(normal.indexOf('>备注</label>'))
    expect(normal).toContain('value="preset"')
    expect(normal).toContain('aria-expanded="false"')
    expect(normal.indexOf('tools-run-parameter-name')).toBeLessThan(
      normal.indexOf('tools-run-parameter-tags'),
    )
    expect(normal.indexOf('tools-run-parameter-tags')).toBeLessThan(
      normal.indexOf('tools-run-parameter-value'),
    )
    expect(normal).not.toContain('tools-run-parameter-info')
    expect(normal).not.toContain('class="ui-field-description"')
    expect(normal).toContain('aria-label="NAME输入提示"')
    expect(normal).toContain('ui-input-hint')
    const invalid = render({ key: 'NOTE', message: '请修正备注' })
    expect(invalid).toContain('aria-expanded="true"')
    expect(invalid).toMatch(/aria-describedby="[^"]+-description [^"]+-error"/)
    expect(invalid).toContain('请修正备注')
    const promoted = renderToStaticMarkup(
      <RunTerminalParameters
        fields={[optional]}
        needsInput={() => true}
        renderValue={() => <Input />}
      />,
    )
    expect(promoted).not.toContain('高级参数（')
    expect(promoted).toContain('必填')
  })
  it('keeps long text and JSON controls in a fixed-action run window with cancel available', () => {
    const def = definition([
      field('command', { type: 'string' }),
      field('list', { type: 'array', default: [1, 2] }, false),
    ])
    const html = renderToStaticMarkup(
      <ToolRunPanel
        definition={def}
        tasks={[]}
        inspect={() => {}}
        busy={false}
        windowed
        close={() => {}}
        run={async () => undefined}
        stop={() => {}}
      />,
    )
    expect(html).toContain('ui-modal-body')
    expect(html).toContain('ui-modal-actions')
    expect(html).toMatch(/<textarea[^>]*name="command"/)
    expect(html).toMatch(/<textarea[^>]*name="list"/)
    expect(html).toContain('[1,2]')
    expect(html).toContain('取消')
    expect(html).toContain('开始运行')
  })

  it('presents structured results with readable values while escaping links and markup', () => {
    const markdown = runResultMarkdown(
      JSON.stringify({
        count: 0,
        enabled: false,
        nested: { message: '[打开](https://example.test) <script>x</script>' },
      }),
    )
    expect(markdown).toContain('**count**\n\n0')
    expect(markdown).toContain('**enabled**\n\n否')
    expect(markdown).toContain('**nested / message**')
    expect(markdown).toContain('\\[打开\\]')
    expect(markdown).toContain('\\<script\\>')
    expect(runResultMarkdown('第一行\n第二行')).toBe('第一行  \n第二行')
    expect(runResultMarkdown(JSON.stringify(Array.from({ length: 101 }, (_, i) => i)))).toContain(
      '其余内容请查看原始数据',
    )
  })
  it('parses only explicit public inputs, preserving empty strings and falsy values', () => {
    const def = definition([
      field('empty', { type: 'string', default: 'original' }),
      field('flag', { type: 'boolean', default: true }),
      field('count', { type: 'integer', default: 1 }),
      field('nullable', { type: ['string', 'null'], default: 'value' }),
    ])
    expect(prepareRunInputs(def.tools[0]!, {})).toEqual({ ok: true, args: {} })
    expect(
      prepareRunInputs(def.tools[0]!, { empty: '', flag: 'false', count: '0', nullable: 'null' }),
    ).toEqual({ ok: true, args: { empty: '', flag: false, count: 0, nullable: null } })
    expect(needsRunInput(def.tools[0]!.fields[0]!, ['empty'])).toBe(true)
    expect(prepareRunInputs(def.tools[0]!, { count: 'invalid' })).toMatchObject({
      ok: false,
      key: 'count',
    })
  })
  it('edits fixed values locally while keeping them out of public arguments', () => {
    const fixed = { ...field('SECRET', { type: 'string' }), aiVisible: false, value: 'original' }
    const def = definition([fixed, field('COUNT', { type: 'integer', default: 1 })])
    expect(runFieldValue(fixed, {})).toBe('original')
    expect(prepareManualInputs(def.tools[0]!, { SECRET: 'changed', COUNT: '0' })).toEqual({
      ok: true,
      args: { COUNT: 0 },
      fixedParameters: { SECRET: 'changed' },
    })
    expect(fixed.value).toBe('original')
    const html = renderToStaticMarkup(
      <ToolRunPanel
        definition={{ ...def, enabled: false }}
        tasks={[]}
        inspect={() => {}}
        busy={false}
        run={async () => undefined}
        stop={() => {}}
      />,
    )
    expect(html).toContain('type="password"')
    expect(html).toContain('value="original"')
    expect(html).not.toContain('value="original" disabled')
  })
  it('inspects the complete current draft without changing saved configuration or losing falsy values', () => {
    const fixed = {
      ...field('SECRET', { type: 'string' }),
      required: false,
      aiVisible: false,
      value: 'original',
    }
    const def = definition([
      fixed,
      field('TEXT', { type: 'string', default: 'saved' }),
      field('FLAG', { type: 'boolean', default: true }),
      field('COUNT', { type: 'integer', default: 1 }),
    ])
    const original = structuredClone(def)
    const preview = runConfigurationPreview(def, def.runner.settings, def.tools[0]!.name, {
      SECRET: 'latest',
      TEXT: '',
      FLAG: 'false',
      COUNT: '0',
    })
    expect(preview.本次运行参数).toEqual({ SECRET: 'latest', TEXT: '', FLAG: false, COUNT: 0 })
    expect(preview.完整工具配置.tools[0]!.fields[0]!.value).toBe('latest')
    expect(preview.完整工具配置.runner).toEqual(def.runner)
    expect(preview.完整工具配置.tools[0]!.outputSchema).toEqual(def.tools[0]!.outputSchema)
    expect(def).toEqual(original)
    const invalid = runConfigurationPreview(def, def.runner.settings, def.tools[0]!.name, {
      COUNT: 'unfinished',
    })
    expect(invalid.本次运行参数.COUNT).toBe('unfinished')
    const nested = definition([field('payload', { type: 'object', default: {} })])
    const frozen = runConfigurationPreview(
      nested,
      nested.runner.settings,
      nested.tools[0]!.name,
      { payload: '{}' },
      { payload: { limit: 3 } },
      true,
    )
    expect(frozen.本次运行参数.payload).toEqual({ limit: 3 })
  })
  it('fixes HTTP targets and header keys, permitting only existing request values', () => {
    const def = createCapabilityDefinition({
      kind: 'http',
      name: 'HTTP',
      namespace: 'request',
      url: 'https://example.test/fixed',
    })
    if (def.runner.settings.type !== 'http') throw new Error('fixture')
    def.runner.settings.fixedHeaders = { Authorization: 'header-original' }
    def.runner.settings.method = 'POST'
    def.runner.settings.bodyMode = 'json'
    def.runner.settings.body = { text: 'body-original' }
    def.tools[0]!.fields = [field('QUERY', { type: 'string', default: 'query-original' }, false)]
    const html = renderToStaticMarkup(
      <ToolRunPanel
        definition={def}
        tasks={[]}
        inspect={() => {}}
        busy={false}
        run={async () => undefined}
        stop={() => {}}
      />,
    )
    expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="POST"/)
    expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="https:\/\/example\.test\/fixed"/)
    expect(html).toMatch(/<label[^>]*>Authorization<\/label>/)
    expect(html).toContain('value="header-original"')
    expect(html).toContain('>body-original</textarea>')
    expect(html).toContain('>query-original</textarea>')
    expect(html).not.toContain('添加请求头')
    expect(html).not.toContain('删除请求头')
    expect(html).not.toContain('超时（毫秒）')
    expect(html).toContain('更多设置')
    expect(html).toContain('查看技术信息')
  })
  it('fixes the configured MCP operation and address, editing existing headers only', () => {
    const def = createCapabilityDefinition({
      kind: 'mcp',
      name: 'MCP',
      namespace: 'mcp',
      url: 'https://example.test/mcp',
    })
    if (def.runner.settings.type !== 'mcp') throw new Error('fixture')
    def.runner.settings.transport = 'streamable-http'
    def.runner.settings.headers = { Authorization: 'header-original' }
    def.tools = ['first', 'chosen'].map((name) => ({
      ...def.tools[0]!,
      name,
      upstreamName: name,
      upstreamSignature: 'cached-' + name,
      fields: [field('HIDDEN', { type: 'string', default: 'preset' })],
    }))
    def.runner.settings.toolName = 'chosen'
    const html = renderToStaticMarkup(
      <ToolRunPanel
        definition={def}
        tasks={[]}
        inspect={() => {}}
        busy={false}
        run={async () => undefined}
        stop={() => {}}
      />,
    )
    expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="https:\/\/example\.test\/mcp"/)
    expect(html).toMatch(/<option[^>]*value="chosen"[^>]*selected=""[^>]*>chosen<\/option>/)
    expect(html).toMatch(/<label[^>]*>Authorization<\/label>/)
    expect(html).toContain('aria-label="MCP工具"')
    expect(html).toContain('HIDDEN')
    expect(html).toMatch(/<textarea[^>]*readOnly=""[^>]*>preset<\/textarea>/)
    expect(html).toContain('MCP 预设参数（只读）')
    expect(html).not.toContain('添加请求头')
    expect(html).not.toContain('删除请求头')
    expect(html).toContain('更多设置')
    expect(html).toContain('查看技术信息')
    const preview = runConfigurationPreview(
      def,
      { ...def.runner.settings, headers: { Authorization: 'latest' } },
      'chosen',
      {},
    )
    expect(preview.本次运行参数.HIDDEN).toBe('preset')
    expect(preview.完整工具配置.runner.settings).toMatchObject({
      headers: { Authorization: 'latest' },
    })
    expect(preview.完整工具配置.tools).toHaveLength(2)
  })
  it('previews nested defaults using effective arguments and never reveals private fields', () => {
    const privateField = {
      ...field('secret', { type: 'string' }),
      aiVisible: false,
      required: false,
      value: 'PRIVATE_CANARY',
    }
    const def = definition([
      field('payload', {
        type: 'object',
        properties: { limit: { type: 'integer', default: 3 } },
        default: {},
      }),
      privateField,
    ])
    const preview = runParameterPreview(def.tools[0]!, {}, { payload: { limit: 3 } })
    expect(preview).toEqual([{ key: 'payload', source: '工具默认值', value: '{"limit":3}' }])
    expect(JSON.stringify(preview)).not.toContain('PRIVATE_CANARY')
  })
  it('edits public inputs without attaching historical tasks or mounting their output', () => {
    const def = definition([
      field('required', { type: 'string', description: '运行参数说明' }),
      field('preset', { type: 'string', default: 'hidden-default' }),
      field('optional', { type: 'string' }, false),
    ])
    const html = renderToStaticMarkup(
      <ToolRunPanel
        definition={def}
        tasks={[task]}
        inspect={() => {}}
        busy={false}
        run={async () => undefined}
        stop={() => {}}
      />,
    )
    expect(html).not.toContain('查看本次运行参数')
    expect(html).not.toContain('仅影响本次运行')
    expect(html).not.toContain('本次运行无需输入参数。')
    expect(html).toContain('aria-label="填写内容"')
    expect(html).not.toContain('>参数配置<')
    expect(html).toContain('ui-stage-title">配置<')
    expect(html).toContain('ui-stage-title">执行<')
    expect(html.indexOf('ui-stage-title">配置<')).toBeLessThan(
      html.indexOf('ui-stage-title">执行<'),
    )
    expect(html).not.toContain('已准备就绪')
    expect(html).not.toContain('关闭时可选择')
    expect(html).not.toContain('尚未开始')
    expect(html).not.toContain('ui-stage-title">结果<')
    expect(html).toContain('工作目录')
    expect(html).toContain('选择文件夹')
    expect(html).toContain('aria-label="外部参数"')
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('aria-label="参数 1 参数名"')
    expect(html).not.toContain('aria-label="参数 1 描述"')
    expect(html).toMatch(/<label for="[^"]+">required<\/label>/)
    expect(html).toContain('运行参数说明')
    expect(html).toMatch(/aria-describedby="[^"]+-description"/)
    expect(html).toContain('外部可见')
    expect(html).toContain('必填')
    expect(html).toContain('可选')
    expect(html).not.toContain('<table')
    expect(html).toContain('高级参数（1）')
    expect(html).toMatch(/aria-label="高级参数"[^>]*hidden|hidden=""[^>]*aria-label="高级参数"/)
    expect(html).toContain('aria-label="required 参数值"')
    expect(html).not.toContain('添加参数')
    expect(html).not.toContain('排序参数')
    expect(html).not.toContain('删除参数')
    expect(html).not.toContain('Shell 命令')
    expect(html).toContain('填写内容')
    expect(html).not.toContain('一次执行')
    expect(html).not.toContain('持续执行')
    expect(html).not.toContain('执行方式')
    expect(html).not.toContain('role="tab"')
    expect(html).toContain('开始运行')
    expect(html).not.toContain('更多设置')
    expect(html).toContain('查看技术信息')
    expect(html).not.toContain('添加环境变量')
    expect(html).not.toContain('textbox')
    expect(html).toContain('<input')
    expect(html).toContain('required')
    expect(html).toContain('optional')
    expect(html).not.toContain('取消')
    expect(html).toContain('hidden-default')
    expect(html).not.toContain('上次历史结果')
    expect(html).not.toContain('自动更新结果')
  })
  it('retains both streams once and selects remote results only after completion', () => {
    const html = renderToStaticMarkup(
      <RunProcess
        task={{
          ...task,
          stdout: '完整输出',
          stderr: '错误日志',
          result: { stdout: '完整输出', stderr: '错误日志', exitCode: 2 },
        }}
      />,
    )
    expect(html.split('完整输出')).toHaveLength(2)
    expect(html.split('错误日志')).toHaveLength(2)
    expect(html).not.toContain('退出码')
    expect(html).toContain('复制日志')
    expect(html).not.toContain('复制结果')
    expect(html).not.toContain('ui-output--result')
    expect(html).toContain('ui-output--fill')
    expect(html).toContain('ui-output-overlay')
    expect(html).toContain('ui-icon-button--small')
    expect(html).not.toContain('ui-output-header')
    expect(html).not.toContain('查看详情')
    expect(html).toContain('aria-label="复制日志"')
    expect(html).not.toContain('1 秒')
    expect(html).not.toContain('ui-badge')
    const remote = {
      ...task,
      runnerType: 'http' as const,
      stdout: '',
      events: [{ at: task.startedAt, message: '请求日志' }],
      result: { status: 200, body: '最终响应' },
    }
    expect(
      renderToStaticMarkup(
        <RunProcess task={{ ...remote, status: 'running', finishedAt: null }} />,
      ),
    ).not.toContain('最终响应')
    const finished = renderToStaticMarkup(<RunProcess task={remote} />)
    expect(finished).toContain('请求日志')
    expect(finished).toContain('最终响应')
    expect(finished).not.toContain('HTTP 200')
    expect(finished).toContain('复制响应正文')
    expect(finished).toContain('ui-output-overlay')
    expect(finished).not.toContain('ui-output--combined')
    expect(finished).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>响应</)
    expect(finished).toMatch(/role="tabpanel"[^>]*-log-tab" hidden=""/)
    const failed = renderToStaticMarkup(
      <RunProcess task={{ ...remote, status: 'failed', error: 'tool_http_failed' }} />,
    )
    expect(failed).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>运行记录</)
    expect(failed).toContain('HTTP 请求失败')
    expect(failed).toContain('最终响应')
    expect(finished).not.toContain(new Date(task.startedAt).toLocaleTimeString())
  })
  it('keeps final responses out of execution logs and retains both terminal streams', () => {
    expect(runLogText({ ...task, stdout: '第一行\n第二行\n', stderr: '诊断\n' })).toBe(
      '第一行\n第二行\n[stderr] 诊断',
    )
    const log = runLogText({
      ...task,
      runnerType: 'http',
      result: '最终响应',
      events: [{ at: task.startedAt, message: '开始请求' }],
    })
    expect(log).toContain('开始请求')
    expect(log).not.toContain('最终响应')
    expect(runLogText({ ...task, runnerType: 'mcp', events: [] })).toBe('')
  })
  it('projects both terminal streams to copyable text while preserving raw task output', () => {
    const colored = {
      ...task,
      stdout: '\u001b[32m启动成功🚀\u001b[0m\n',
      stderr: '\u001b[33m提醒⚠️\u001b[0m\n',
    }
    expect(terminalOutputText(runLogText(colored))).toBe('启动成功🚀\n[stderr] 提醒⚠️')
    const html = renderToStaticMarkup(<RunProcess task={colored} />)
    expect(html).toContain('启动成功🚀')
    expect(html.replace(/<[^>]*>/g, '')).toContain('[stderr] 提醒⚠️')
    expect(html).not.toContain('\u001b')
    expect(html).toContain('color:var(--lumi-terminal-2)')
    expect(html).toContain('color:var(--lumi-terminal-3)')
    expect(colored.stdout).toContain('\u001b[32m')
    expect(
      runLogText({
        ...colored,
        runnerType: 'http',
        events: [{ at: task.startedAt, message: '\u001b[32m原文' }],
      }),
    ).toBe('\u001b[32m原文')
  })
  it('uses the stage marker for status in the staged result', () => {
    const html = renderToStaticMarkup(
      <TaskResult
        task={{ ...task, status: 'failed', stderr: '错误详情' }}
        staged
        stop={() => {}}
        restart={() => {}}
        busy={false}
      />,
    )
    expect(html).not.toContain('ui-badge')
    expect(html).toContain('错误详情')
  })
  it('renders terminal output once instead of duplicating it as JSON', () => {
    const html = renderToStaticMarkup(
      <TaskResult task={task} stop={() => {}} restart={() => {}} busy={false} />,
    )
    expect(html.split('上次历史结果')).toHaveLength(2)
    expect(html).toContain('退出码 0')
    expect(html).not.toContain('other-task')
  })
  it('keeps uncertain remote execution from exposing a direct restart', () => {
    const html = renderToStaticMarkup(
      <TaskResult
        task={{
          ...task,
          runnerType: 'http',
          status: 'cancelled',
          cancellationUncertain: true,
          result: null,
        }}
        stop={() => {}}
        restart={() => {}}
        busy={false}
      />,
    )
    expect(html).toContain('结果未知')
    expect(html).toMatch(/disabled=""[^>]*><span[^>]*>再次运行/)
    expect(html).toContain('确认上次操作的结果')
  })
  it('shows simple remote text without a code frame, and hides successful execution events', () => {
    const html = renderToStaticMarkup(
      <TaskResult
        task={{
          ...task,
          runnerType: 'mcp',
          result: { text: '本次结果' },
          events: [{ at: task.startedAt, message: '调用阶段证据' }],
        }}
        stop={() => {}}
        restart={() => {}}
        busy={false}
      />,
    )
    expect(html).toContain('tool-run-text')
    expect(html).toContain('复制结果')
    expect(html).not.toContain('调用阶段证据')
    expect(html).toContain('查看执行过程')
  })
  it('opens failure evidence with stderr selected and keeps stdout available', () => {
    const html = renderToStaticMarkup(
      <TaskResult
        task={{ ...task, status: 'failed', stdout: '部分输出', stderr: '故障证据' }}
        stop={() => {}}
        restart={() => {}}
        busy={false}
      />,
    )
    expect(html).toContain('故障证据')
    expect(html).not.toContain('部分输出')
    expect(html).toContain('aria-selected="true"')
  })
  it('formats JSON bodies returned by HTTP as structured output', () => {
    const html = renderToStaticMarkup(
      <TaskResult
        task={{ ...task, runnerType: 'http', result: { status: 200, body: '{"checks":12}' } }}
        stop={() => {}}
        restart={() => {}}
        busy={false}
      />,
    )
    expect(html).toContain('HTTP 200')
    expect(html).toContain('<pre aria-label="运行结果">')
    expect(html).not.toContain('tool-run-text')
  })
  it('summarizes execution targets without leaking fixed connection credentials', () => {
    const def = createCapabilityDefinition({
      kind: 'http',
      name: 'HTTP',
      namespace: 'target',
      url: 'https://user:PASS_CANARY@example.com/api?token=TOKEN_CANARY#SECRET_FRAGMENT',
      method: 'POST',
    })
    const rows = runTargetDetails(def, def.tools[0]!.name)
    expect(rows[0]).toEqual(['请求方式', 'POST'])
    expect(rows[1]![1]).toContain('example.com/api')
    expect(JSON.stringify(rows)).not.toMatch(/PASS_CANARY|TOKEN_CANARY|SECRET_FRAGMENT/)
    const mcp = createCapabilityDefinition({
      kind: 'mcp',
      name: 'MCP',
      namespace: 'target',
      transport: 'stdio',
      command: '/usr/bin/node',
    })
    expect(runTargetDetails(mcp, '')).toContainEqual(['本机连接', '本机进程（stdio） · node'])
    expect(runTargetDetails(mcp, '')).toContainEqual(['工具名称', '全部工具'])
  })
})
