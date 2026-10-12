// SPDX-License-Identifier: MPL-2.0
import { Button, IconButton, Textarea, Segmented } from './ui'
import { useEffect, useRef, useState } from 'react'
import type { McpConnectionInfo } from '@lumiplug/shared'
import { copyText } from '../lib/clipboard'
import { formatMcpConfig, mcpAvailability } from '../lib/mcp'
import type { McpTransport } from '../lib/mcp'
import { isSameReadySession } from '../lib/workbench'
import { checkMcpConnection, refreshMcpToken } from '../lib/tauri'
import { useToast } from './ToastProvider'
import SettingsPreviewDialog from './SettingsPreviewDialog'
import './mcp-connection.css'

export default function McpConnectionCard({
  connection = null,
  onConnectionChange,
}: {
  onConnectionChange: (connection: McpConnectionInfo) => void
  connection?: McpConnectionInfo | null
}) {
  const showToast = useToast()
  const [open, setOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const [checking, setChecking] = useState(false)
  const [transport, setTransport] = useState<McpTransport>('http')
  const [fallback, setFallback] = useState(0)
  const field = useRef<HTMLTextAreaElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const currentConnection = useRef(connection)
  const copyingRef = useRef(false)
  const checkingRef = useRef(false)
  currentConnection.current = connection
  const ready = connection?.coreState === 'ready'
  const activeTransport = transport === 'stdio' && connection?.stdioCommand ? 'stdio' : 'http'
  const config = connection ? formatMcpConfig(connection, activeTransport) : ''

  useEffect(() => {
    if (open && fallback) {
      field.current?.focus()
      field.current?.select()
    }
  }, [open, fallback, config])

  async function handleRefresh() {
    if (refreshingRef.current || copyingRef.current || checkingRef.current || !ready) return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      const next = await refreshMcpToken()
      currentConnection.current = next
      onConnectionChange(next)
      showToast('令牌已刷新，旧配置已失效，请重新复制 MCP 配置。', 'success')
    } catch {
      showToast('令牌未能刷新，请检查本地服务后重试。', 'error')
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }

  async function handleCheck() {
    if (
      refreshingRef.current ||
      checkingRef.current ||
      currentConnection.current?.coreState !== 'ready'
    )
      return
    checkingRef.current = true
    setChecking(true)
    try {
      const result = await checkMcpConnection()
      showToast(
        result.ok
          ? `MCP 自检通过 · 发现 ${result.toolCount} 个工具`
          : (result.error ?? 'MCP 自检失败，请重试。'),
        result.ok ? 'success' : 'error',
      )
    } catch {
      showToast('自检失败，请检查 Lumi 本地服务并重试。', 'error')
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }

  async function handleCopy(selected: McpTransport) {
    const current = currentConnection.current
    if (refreshingRef.current || copyingRef.current || !current || current.coreState !== 'ready')
      return
    const text = formatMcpConfig(current, selected)
    if (!text) return
    copyingRef.current = true
    setCopying(true)
    try {
      const copied = await copyText(text)
      if (!isSameReadySession(current, currentConnection.current)) {
        showToast('Lumi 会话已更新，请重新复制当前配置。', 'info')
        return
      }
      showToast(
        copied ? '已复制 MCP 配置' : '未能自动复制，请选中配置手动复制。',
        copied ? 'success' : 'error',
      )
      if (!copied) {
        setTransport(selected)
        setOpen(true)
        setFallback((value) => value + 1)
      }
    } finally {
      copyingRef.current = false
      setCopying(false)
    }
  }

  return (
    <section className="settings-row" aria-labelledby="mcp-connection-title">
      <div className="settings-row-label">
        <h2 id="mcp-connection-title">MCP 连接</h2>
        <p className="settings-service-note">重启保留连接配置；令牌仅在手动刷新时更新。</p>
        {!ready && <p className="settings-service-note">{mcpAvailability(connection)}</p>}
      </div>
      <div className="settings-row-controls">
        <Button
          variant="primary"
          type="button"
          className="settings-button"
          aria-label="复制 MCP HTTP 配置"
          disabled={!ready || refreshing}
          loading={copying}
          loadingLabel="复制中…"
          onClick={(event) => {
            trigger.current = event.currentTarget
            setFallback(0)
            void handleCopy('http')
          }}
        >
          复制配置
        </Button>
        <Button
          loading={refreshing}
          loadingLabel="刷新中…"
          disabled={!ready || copying || checking}
          onClick={() => void handleRefresh()}
        >
          刷新令牌
        </Button>
        <IconButton
          type="button"
          className="settings-icon-button"
          label="查看 MCP 连接详情"
          onClick={(event) => {
            trigger.current = event.currentTarget
            setFallback(0)
            setOpen(true)
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
        </IconButton>
      </div>
      {open && (
        <SettingsPreviewDialog
          title="MCP 连接详情"
          returnFocus={trigger.current}
          close={() => setOpen(false)}
          actions={
            <>
              <Button
                type="button"
                className="settings-button settings-button-secondary"
                disabled={!ready || refreshing}
                loading={checking}
                loadingLabel="检查中…"
                onClick={() => void handleCheck()}
              >
                检查连接
              </Button>
              <Button
                variant="primary"
                type="button"
                className="settings-button"
                disabled={!ready || refreshing}
                loading={copying}
                loadingLabel="复制中…"
                onClick={() => void handleCopy(activeTransport)}
              >
                {`复制 ${activeTransport === 'http' ? 'HTTP' : 'stdio'} 配置`}
              </Button>
            </>
          }
        >
          <Segmented
            className="mcp-transport-options"
            label="MCP 连接方式"
            value={activeTransport}
            onValueChange={setTransport}
            items={[
              { value: 'http', label: 'Streamable HTTP', disabled: copying },
              {
                value: 'stdio',
                label: 'stdio 代理',
                disabled: !connection?.stdioCommand || copying,
              },
            ]}
          />
          {!connection?.stdioCommand && (
            <p id="mcp-stdio-unavailable">当前环境没有可用的 stdio 代理。</p>
          )}
          <dl className="mcp-connection-facts">
            <div>
              <dt>服务地址</dt>
              <dd>{connection?.endpoint ?? '尚未获取配置'}</dd>
            </div>
            <div>
              <dt>认证方式</dt>
              <dd>{connection ? '本地令牌 · 请求头认证' : '—'}</dd>
            </div>
          </dl>
          <p>{mcpAvailability(connection)}</p>
          {connection && (
            <>
              <label className="mcp-config-label" htmlFor="mcp-client-config">
                {activeTransport === 'http' ? 'HTTP' : 'stdio'} 配置
              </label>
              <Textarea
                id="mcp-client-config"
                ref={field}
                className="settings-code-preview"
                value={config}
                readOnly
                spellCheck={false}
                rows={10}
              />
              <p className="mcp-config-note">
                请按 AI 软件的要求调整配置格式。修改端口并重启，或手动刷新令牌后，请重新复制配置。
              </p>
            </>
          )}
        </SettingsPreviewDialog>
      )}
    </section>
  )
}
