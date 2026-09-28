// SPDX-License-Identifier: MPL-2.0

import { useRef, useState } from 'react'
import type { McpConnectionInfo } from '@lumiplug/shared'
import { copyText } from '../lib/clipboard'
import { formatMcpConfig, mcpAvailability } from '../lib/mcp'
import type { McpTransport } from '../lib/mcp'
import { checkMcpConnection } from '../lib/tauri'
import './mcp-connection.css'

export default function McpConnectionCard({
  connection = null,
}: {
  connection?: McpConnectionInfo | null
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [checking, setChecking] = useState(false)
  const [transport, setTransport] = useState<McpTransport>('http')
  const field = useRef<HTMLTextAreaElement>(null)
  const activeTransport = transport === 'stdio' && connection?.stdioCommand ? 'stdio' : 'http'
  const config = connection ? formatMcpConfig(connection, activeTransport) : ''

  async function handleCheck() {
    setChecking(true)
    setNotice(null)
    try {
      const result = await checkMcpConnection()
      setNotice(result.ok ? `MCP 自检通过 · 发现 ${result.toolCount} 个工具` : result.error)
    } catch {
      setNotice('自检失败，请检查 Lumi 本地服务并重试。')
    } finally {
      setChecking(false)
    }
  }

  async function handleCopy() {
    setCopying(true)
    try {
      const copied = await copyText(config)
      setNotice(copied ? '已复制 MCP 配置' : '未能自动复制，请选中配置手动复制。')
      if (!copied) {
        field.current?.focus()
        field.current?.select()
      }
    } finally {
      setCopying(false)
    }
  }

  return (
    <section className="mcp-connection-card" aria-labelledby="mcp-connection-title">
      <h2 id="mcp-connection-title">MCP 连接</h2>
      <p>在 AI 软件中添加 Lumi，查看能力目录并创建草稿。</p>
      <div className="mcp-transport-options" role="group" aria-label="MCP 连接方式">
        <button
          type="button"
          aria-pressed={activeTransport === 'http'}
          onClick={() => {
            setTransport('http')
            setNotice(null)
          }}
        >
          Streamable HTTP
        </button>
        <button
          type="button"
          aria-pressed={activeTransport === 'stdio'}
          disabled={!connection?.stdioCommand}
          onClick={() => {
            setTransport('stdio')
            setNotice(null)
          }}
        >
          stdio 代理
        </button>
      </div>
      <dl>
        <div>
          <dt>传输方式</dt>
          <dd>{activeTransport === 'http' ? 'Streamable HTTP' : 'stdio → 本机 HTTP'}</dd>
        </div>
        <div>
          <dt>服务地址</dt>
          <dd>{connection?.endpoint ?? '请在桌面应用中查看'}</dd>
        </div>
        <div>
          <dt>认证方式</dt>
          <dd>{connection ? '会话令牌 · 请求头认证' : '—'}</dd>
        </div>
      </dl>
      <p className="mcp-connection-hint">{mcpAvailability(connection)}</p>
      {connection && (
        <>
          <label className="mcp-config-label" htmlFor="mcp-client-config">
            通用 MCP 配置
          </label>
          <textarea
            id="mcp-client-config"
            ref={field}
            value={config}
            readOnly
            spellCheck={false}
            rows={10}
          />
          <p className="mcp-config-note">
            请按 AI 软件的要求调整配置格式。Lumi 重新启动后，请重新复制配置。
          </p>
        </>
      )}
      <div className="mcp-connection-actions">
        <button type="button" disabled={!connection || copying} onClick={() => void handleCopy()}>
          {copying ? '复制中…' : '复制 MCP 配置'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!connection?.gatewayAvailable || connection.coreState !== 'ready' || checking}
          onClick={() => void handleCheck()}
        >
          {checking ? '检查中…' : '检查连接'}
        </button>
        <span role="status" aria-live="polite">
          {notice}
        </span>
      </div>
    </section>
  )
}
