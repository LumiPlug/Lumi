// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createCapabilityDefinition } from '@lumiplug/shared'
import type { CapabilityField, ToolTask } from '@lumiplug/shared'
import ToolRunPanel, { RunProcess, ToolRunStages } from '../components/ToolRunPanel'
import { RunParameters } from '../components/RunParameters'
import { Input } from '../components/ui'
import type { ReactNode } from 'react'
import { remoteResultPanels, runHttpStatus, displayRunResult } from './run-remote-result'
import { multilineRunField } from './tool-run'
const field = (key: string, required = true): CapabilityField => ({
  key,
  schema: { type: 'string', description: `${key}说明`, maxLength: 80, default: 'preset' },
  required,
  aiVisible: true,
  value: null,
  binding: null,
})
const task = (runnerType: ToolTask['runnerType'], result: ToolTask['result']): ToolTask => ({
  id: 'task',
  capabilityId: 'cap',
  capabilityName: 'test',
  operation: 'test.run',
  version: 1,
  runnerType,
  source: 'manual',
  status: 'completed',
  startedAt: '2026-10-12T00:00:00Z',
  finishedAt: '2026-10-12T00:00:01Z',
  result,
  error: null,
  stdout: '',
  stderr: '',
  truncated: false,
  cancellationUncertain: false,
})
vi.mock('../components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastViewport: () => {},
}))
const render = (node: ReactNode) => renderToStaticMarkup(node)
describe('shared protocol run presentation', () => {
  it('keeps the three-area rows, private masking and long JSON for HTTP and read-only MCP presets', () => {
    for (const kind of ['terminal', 'http', 'mcp'] as const) {
      const definition = createCapabilityDefinition({
        kind,
        name: kind,
        namespace: 'demo',
        command: 'printf ok',
        url: 'http://127.0.0.1/fixture',
      })
      definition.tools[0]!.fields = [
        field('name'),
        {
          ...field('payload'),
          schema: { type: 'object', description: '长JSON说明', default: { items: [1, 2] } },
        },
        {
          ...field('secret'),
          aiVisible: false,
          value: 'private-fixture',
          schema: { type: 'string', enum: ['private-fixture'] },
        },
      ]
      if (kind === 'mcp') {
        definition.tools[0]!.upstreamName = 'cached-tool'
        definition.tools[0]!.upstreamSignature = 'cached-signature'
      }
      definition.enabled = true
      definition.status = 'ready'
      const html = render(
        <ToolRunPanel
          definition={definition}
          tasks={[]}
          inspect={() => {}}
          busy={false}
          run={async () => undefined}
          stop={() => {}}
          windowed
          close={() => {}}
        />,
      )
      expect(html).toContain('tools-run-parameter-name')
      expect(html).toContain('tools-run-parameter-tags')
      expect(html).toContain('tools-run-parameter-value')
      expect(html).toMatch(/<textarea[^>]*aria-label="payload 参数值"/)
      expect(html).toMatch(/<input[^>]*type="password"[^>]*value="private-fixture"/)
      expect(html).toContain('ui-input-hint--multiline')
      expect(html).not.toContain('ui-field-description')
      expect(html).toContain('ui-modal-actions')
      expect(html).toContain('取消')
      if (kind === 'mcp') {
        expect(html).toContain('MCP 预设参数（只读）')
        expect(html).toMatch(/readOnly=""[^>]*value="preset"/)
      }
    }
  })
  it('expands an invalid optional field and keeps dependency-promoted fields and intra-group order', () => {
    const html = render(
      <RunParameters
        fields={[field('first'), field('second', false), field('third', false)]}
        needsInput={(f) => f.key === 'second'}
        error={{ key: 'third', message: '无效' }}
        renderValue={(f, descriptionId, id) => (
          <Input id={id} aria-describedby={descriptionId} defaultValue={f.key} />
        )}
      />,
    )
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toMatch(/aria-describedby="[^"]+-description [^"]+-error"/)
    expect(html.indexOf('>first</label>')).toBeLessThan(html.indexOf('>second</label>'))
    expect(html.indexOf('>second</label>')).toBeLessThan(html.indexOf('>third</label>'))
  })
  it('omits hint icons without descriptions and keeps a stable scalar/JSON choice', () => {
    const f = { ...field('plain'), schema: { type: 'string' as const, maxLength: 80 } }
    const html = render(
      <RunParameters
        fields={[f]}
        renderValue={(_, d, id) => <Input id={id} aria-describedby={d} />}
      />,
    )
    expect(html).not.toContain('输入提示')
    expect(multilineRunField(f)).toBe(false)
    expect(multilineRunField({ ...f, schema: { type: 'string' } })).toBe(true)
    expect(multilineRunField({ ...f, schema: { type: 'object' } })).toBe(true)
  })
  it('formats long JSON for reading without altering the original copy source', () => {
    const original = '{"items":[1,2],"ok":false}'
    expect(displayRunResult(original)).toBe(JSON.stringify(JSON.parse(original), null, 2))
    expect(remoteResultPanels(task('http', { status: 200, body: original }))[0]!.text).toBe(
      original,
    )
    for (const text of ['literal\ntext', 'not-json', '0', 'false', '"string"'])
      expect(displayRunResult(text)).toBe(text)
  })
  it('copies HTTP body and other actual data separately without inventing response headers', () => {
    const current = task('http', { status: 200, body: 'raw response\n', extra: { value: 0 } })
    expect(remoteResultPanels(current)).toEqual([
      { key: 'body', label: '响应正文', text: 'raw response\n' },
      { key: 'data', label: '其他返回数据', text: '{\n  "extra": {\n    "value": 0\n  }\n}' },
    ])
    const html = render(<RunProcess task={current} />)
    expect(html).toContain('复制响应正文')
    expect(html).toContain('复制其他返回数据')
    expect(html).not.toContain('响应头')
    expect(html).not.toContain('ui-output-header')
    expect(runHttpStatus(current)).toBeNull()
    expect(
      runHttpStatus({
        ...current,
        events: [{ at: current.startedAt, message: '收到响应（HTTP 200）' }],
      }),
    ).toBe(200)
  })
  it('separates MCP text and structure, preserves false/zero values and disables empty copies', () => {
    expect(remoteResultPanels(task('mcp', { text: 'answer\n', count: 0, ok: false }))).toEqual([
      { key: 'text', label: '文本结果', text: 'answer\n' },
      { key: 'data', label: '结构化数据', text: '{\n  "count": 0,\n  "ok": false\n}' },
    ])
    for (const value of [0, false, [], {}])
      expect(remoteResultPanels(task('mcp', value))[0]!.text).toBe(JSON.stringify(value, null, 2))
    const html = render(<RunProcess task={task('mcp', null)} />)
    expect(html).toContain('没有返回内容。')
    expect(html).toMatch(/aria-label="复制结果"[^>]*disabled=""/)
  })
  it('uses actual success/failure/cancellation outcomes and shared small floating copies for both remote protocols', () => {
    for (const runnerType of ['http', 'mcp'] as const)
      for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
        const current = { ...task(runnerType, { text: 'content' }), status }
        const html = render(
          <ToolRunStages task={current} configuration={<Input readOnly />}>
            <RunProcess task={current} />
          </ToolRunStages>,
        )
        expect(html).toContain(
          { running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' }[status],
        )
        expect(html).toContain('ui-output-overlay')
        expect(html).toContain('ui-icon-button--small')
        expect(html).not.toContain('ui-output-header')
      }
  })
})
