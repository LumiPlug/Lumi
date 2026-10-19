// SPDX-License-Identifier: MPL-2.0
import type { McpConnectionInfo, UiCoreStatus } from '@lumiplug/shared'
import HomepagePromptSetting from './HomepagePromptSetting'
import McpConnectionCard from './McpConnectionCard'
import McpPortSetting from './McpPortSetting'
import { Button, ThemePicker } from './ui'
import './settings.css'

type Theme = 'dark' | 'light'
const statusLabels: Record<UiCoreStatus['state'], string> = {
  ready: '已连接',
  starting: '启动中',
  restarting: '重启中',
  stopping: '停止中',
  error: '连接异常',
  stopped: '已停止',
  disconnected: '未连接',
}

export default function SettingsPage({
  coreStatus,
  mcpConnection,
  onMcpConnectionChange,
  theme,
  onThemeChange,
  openComponents,
}: {
  coreStatus: UiCoreStatus
  mcpConnection: McpConnectionInfo | null
  onMcpConnectionChange: (connection: McpConnectionInfo) => void
  theme: Theme
  onThemeChange: (theme: Theme) => void
  openComponents: () => void
}) {
  return (
    <div className="settings-page">
      <header className="page-header">
        <h1 className="sr-only">设置</h1>
        <p>调整外观，管理 MCP 连接与本地服务。</p>
      </header>
      <section className="settings-row" aria-labelledby="appearance-title">
        <h2 id="appearance-title">外观</h2>
        <ThemePicker value={theme} onValueChange={onThemeChange} />
      </section>
      <McpConnectionCard connection={mcpConnection} onConnectionChange={onMcpConnectionChange} />
      <McpPortSetting coreStatus={coreStatus} />
      <HomepagePromptSetting />
      <section className="settings-row" aria-labelledby="core-title">
        <h2 id="core-title" tabIndex={-1}>
          Core
        </h2>
        <dl className="settings-core-values">
          <div>
            <dt className="sr-only">连接状态</dt>
            <dd className="settings-core-status" data-state={coreStatus.state}>
              {statusLabels[coreStatus.state]}
            </dd>
          </div>
          <div>
            <dt className="sr-only">版本</dt>
            <dd className="settings-core-version">{coreStatus.coreVersion ?? '版本未知'}</dd>
          </div>
        </dl>
      </section>
      {import.meta.env.DEV && (
        <section className="settings-row" aria-labelledby="development-title">
          <h2 id="development-title">开发</h2>
          <div className="settings-row-controls">
            <Button id="ui-components-entry" onClick={openComponents}>
              UI组件
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
