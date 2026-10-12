// SPDX-License-Identifier: MPL-2.0
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { UiCoreStatus } from '@lumiplug/shared'
import WorkbenchPage from '../components/WorkbenchPage'
import KnowledgePage from '../components/KnowledgePage'

vi.mock('../components/ToastProvider', () => ({ useToast: () => () => {} }))

const coreStatus = (state: UiCoreStatus['state']): UiCoreStatus => ({
  state,
  protocolVersion: 1,
  coreVersion: null,
  userDataPathAvailable: false,
  restartCount: 0,
  lastError: null,
})

describe('Core lifecycle presentation', () => {
  const workbench = (state: UiCoreStatus['state'], loaded = true) =>
    renderToStaticMarkup(
      <WorkbenchPage
        connection={null}
        coreStatus={coreStatus(state)}
        coreStatusLoaded={loaded}
        openSettings={() => {}}
      />,
    )
  const knowledge = (state: UiCoreStatus['state'], loaded = true) =>
    renderToStaticMarkup(
      <KnowledgePage
        active
        coreStatus={coreStatus(state)}
        coreStatusLoaded={loaded}
        openSettings={() => {}}
      />,
    )

  it('waits only while the first status loads or Core starts', () => {
    for (const state of ['starting', 'restarting'] as const) {
      expect(workbench(state)).toContain('aria-busy="true"')
      expect(knowledge(state)).toContain('正在连接 Core')
      expect(knowledge(state)).not.toContain('到设置查看服务')
    }
    expect(workbench('disconnected', false)).toContain('aria-busy="true"')
    expect(knowledge('disconnected', false)).toContain('正在连接 Core')
  })

  it('shows disconnected and startup failure with a path to settings', () => {
    for (const state of ['disconnected', 'stopped'] as const) {
      expect(workbench(state)).toContain('Lumi 服务未连接')
      expect(knowledge(state)).toContain('Core 未连接')
    }
    expect(workbench('error')).toContain('Lumi 服务启动失败')
    expect(knowledge('error')).toContain('Core 启动失败')
    for (const html of [workbench('error'), knowledge('error')]) {
      expect(html).toContain('到设置查看服务')
      expect(html).not.toContain('aria-busy="true"')
    }
  })

  it('names a missing workbench connection after Core becomes ready', () => {
    expect(workbench('ready')).toContain('连接配置暂不可用')
    expect(workbench('ready')).toContain('到设置查看服务')
  })
})
