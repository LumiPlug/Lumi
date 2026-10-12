// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createCapabilityDefinition } from '@lumiplug/shared'
import type { CapabilityDefinition } from '@lumiplug/shared'
import { availableRunOperations, initialRunOperation } from './run-operation'
import { safeRunAddress } from './tool-run'
import RunConfigurationFields from '../components/RunConfigurationFields'
import ToolRunPanel from '../components/ToolRunPanel'
vi.mock('../components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastViewport: () => {},
}))
function mcp(): CapabilityDefinition {
  const d = createCapabilityDefinition({
    kind: 'mcp',
    name: 'catalog',
    namespace: 'local',
    transport: 'stdio',
    command: '/trusted/bin/node',
  })
  d.tools = ['alpha', 'beta'].map((name) => ({
    ...d.tools[0]!,
    name,
    upstreamName: name,
    upstreamSignature: 'sig-' + name,
    fields: [
      {
        key: 'shared',
        schema:
          name === 'alpha' ? { type: 'string', default: 'alpha' } : { type: 'integer', default: 7 },
        required: true,
        aiVisible: true,
        value: null,
        binding: null,
      },
    ],
  }))
  d.enabled = true
  d.status = 'ready'
  return d
}
describe('combined connection and saved MCP catalog', () => {
  it('uses one readonly HTTP row and only sanitized address text in all attributes', () => {
    const d = createCapabilityDefinition({
      kind: 'http',
      name: 'http',
      url: 'https://user:URL_SECRET@example.test/token/PATH_SECRET?key=QUERY_SECRET#HASH_SECRET',
    })
    const html = renderToStaticMarkup(
      <RunConfigurationFields
        settings={d.runner.settings}
        section="connection"
        disabled={false}
        change={() => {}}
      />,
    )
    expect(html).toContain('请求：')
    expect(html).not.toMatch(/class="ui-badge[^"]*"[^>]*>固定(?:值)?</)
    expect(html.match(/class="ui-field/g)).toHaveLength(3)
    expect(html).toMatch(/aria-label="请求方式（固定）"[^>]*readOnly=""/)
    expect(html).toMatch(/aria-label="请求地址（固定）"[^>]*readOnly=""/)
    for (const secret of ['URL_SECRET', 'PATH_SECRET', 'QUERY_SECRET', 'HASH_SECRET', 'user:'])
      expect(html).not.toContain(secret)
    expect(html).not.toContain('>请求方式</label>')
    expect(html).not.toContain('>请求地址</label>')
  })
  it('omits fixed-value badges in shared request rows while retaining actual JSON type tags and masking', () => {
    const d = createCapabilityDefinition({ kind: 'http', name: 'values', url: 'http://127.0.0.1' })
    if (d.runner.settings.type !== 'http') throw new Error('fixture')
    d.runner.settings.fixedHeaders = { Authorization: 'fixture-only' }
    d.runner.settings.bodyMode = 'json'
    d.runner.settings.body = { message: 'original', data: { ok: true } }
    const html = renderToStaticMarkup(
      <RunConfigurationFields
        settings={d.runner.settings}
        section="values"
        disabled={false}
        change={() => {}}
      />,
    )
    expect(html).not.toMatch(/class="ui-badge[^"]*"[^>]*>固定(?:值)?</)
    expect(html).toContain('JSON')
    expect(html).toContain('type="password"')
    expect(html).toContain('fixture-only')
    expect(html).toContain('original')
  })
  it('filters placeholder/stale directory entries and leaves a multi-tool catalog unselected', () => {
    const d = mcp()
    d.tools.push({ ...d.tools[0]!, name: 'placeholder', upstreamSignature: undefined })
    expect(availableRunOperations(d).map((tool) => tool.name)).toEqual(['alpha', 'beta'])
    expect(initialRunOperation(d)).toBe('')
    if (d.runner.settings.type !== 'mcp') throw new Error('fixture')
    d.runner.settings.toolName = 'beta'
    expect(initialRunOperation(d)).toBe('beta')
    d.runner.settings.toolName = 'missing'
    expect(initialRunOperation(d)).toBe('')
  })
  it('preselects a sole discovered tool and retains ordinary HTTP/terminal defaults', () => {
    const d = mcp()
    d.tools = d.tools.slice(0, 1)
    expect(initialRunOperation(d)).toBe('alpha')
    for (const kind of ['http', 'terminal'] as const) {
      const def = createCapabilityDefinition({
        kind,
        name: kind,
        url: 'http://127.0.0.1',
        command: 'printf ok',
      })
      expect(initialRunOperation(def)).toBe(def.tools[0]!.name)
    }
  })
  it('shows a real stdio summary and a blank selectable state with disabled execution', () => {
    const d = mcp(),
      before = JSON.stringify(d)
    const html = renderToStaticMarkup(
      <ToolRunPanel
        definition={d}
        tasks={[]}
        inspect={() => {}}
        run={async () => undefined}
        stop={() => {}}
        busy={false}
      />,
    )
    expect(html).toContain('MCP：')
    expect(html).toContain('stdio · node')
    expect(html).not.toContain('/trusted/bin')
    expect(html).toContain('value="alpha"')
    expect(html).toContain('value="beta"')
    expect(html).toContain('请选择工具（可留空）')
    expect(html).toMatch(/disabled=""[^>]*>[^<]*<span[^>]*>开始运行/)
    expect(html).toContain('请选择要运行的工具')
    expect(html).not.toContain('shared 参数值')
    expect(JSON.stringify(d)).toBe(before)
  })
  it('renders selected cached schemas from the saved tool and never exposes an editable connection target', () => {
    const d = mcp()
    if (d.runner.settings.type !== 'mcp') throw new Error('fixture')
    d.runner.settings.toolName = 'beta'
    const html = renderToStaticMarkup(
      <ToolRunPanel
        definition={d}
        tasks={[]}
        inspect={() => {}}
        run={async () => undefined}
        stop={() => {}}
        busy={false}
      />,
    )
    expect(html).toMatch(/aria-label="shared 参数值"[^>]*readOnly=""[^>]*value="7"/)
    expect(html).toContain('MCP工具')
    expect(html).not.toContain('value="alpha" selected')
    expect(html).not.toContain('MCP 地址</label>')
    expect(html).not.toContain('本次工具</label>')
    expect(safeRunAddress('https://u:p@example.test?token=secret')).not.toContain('secret')
  })
})
