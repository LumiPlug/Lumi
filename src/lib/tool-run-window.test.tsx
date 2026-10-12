// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { activeTask, runWindowRoute } from './tool-run-window'
import { WindowPanel } from '../components/ui/WindowPanel'
const capabilityId = 'f06cb86e-b41c-418e-9034-c92325d76732'
const taskId = '1e10f383-17d5-4254-9ab1-9fcc445baf76'
describe('independent run windows', () => {
  it('routes only valid tool/task IDs and does not accept paths or addresses', () => {
    expect(runWindowRoute(`?runTool=${capabilityId}`)).toEqual({ capabilityId, taskId: null })
    expect(runWindowRoute(`?runTool=${capabilityId}&task=${taskId}`)).toEqual({
      capabilityId,
      taskId,
    })
    for (const search of [
      '',
      '?runTool=../../main',
      '?runTool=https://example.com',
      `?runTool=${capabilityId}&task=bad`,
      '?task=' + taskId,
    ])
      expect(runWindowRoute(search)).toBeNull()
  })
  it('requires a close choice for running and stopping tasks, but not terminal states', () => {
    expect(activeTask({ status: 'running' })).toBe(true)
    expect(activeTask({ status: 'stopping' })).toBe(true)
    for (const status of ['completed', 'cancelled', 'failed', 'timed_out', 'interrupted'] as const)
      expect(activeTask({ status })).toBe(false)
    expect(activeTask(null)).toBe(false)
  })
  it('shares the header/body/actions layout without a dialog or modal backdrop', () => {
    const html = renderToStaticMarkup(
      <WindowPanel title="独立运行" actions={<button>停止</button>}>
        <p>实时日志</p>
      </WindowPanel>,
    )
    expect(html).toContain('aria-label="独立运行"')
    expect(html).toContain('ui-modal-body')
    expect(html).toContain('ui-modal-actions')
    expect(html).toContain('实时日志')
    expect(html).not.toContain('<dialog')
    expect(html).not.toContain('aria-modal')
  })
})
