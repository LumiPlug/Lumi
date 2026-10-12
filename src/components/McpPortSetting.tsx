// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_MCP_PORT } from '@lumiplug/shared'
import type { McpPortSettings, UiCoreStatus } from '@lumiplug/shared'
import { Button, Field, Input } from './ui'
import { useToast } from './ToastProvider'
import { getMcpPortSettings, setMcpPort } from '../lib/tauri'
import { mcpPortError, parseMcpPort } from '../lib/mcp'

export default function McpPortSetting({ coreStatus }: { coreStatus: UiCoreStatus }) {
  const [settings, setSettings] = useState<McpPortSettings | null>(null)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const toast = useToast()
  useEffect(() => {
    let cancelled = false
    void getMcpPortSettings()
      .then((next) => {
        if (!cancelled) {
          setSettings(next)
          setValue(String(next.configuredPort))
        }
      })
      .catch(() => {
        if (!cancelled) toast('无法读取 MCP 端口设置，请重新打开设置重试。', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])
  useEffect(() => {
    if (error && !saving) input.current?.focus()
  }, [error, saving])
  async function save() {
    if (busy.current || !settings) return
    const port = parseMcpPort(value)
    if (port === null) {
      const message = mcpPortError('mcp_port_invalid')
      setError(message)
      toast(message, 'error')
      return
    }
    busy.current = true
    setSaving(true)
    setError('')
    try {
      const next = await setMcpPort(port)
      setSettings(next)
      setValue(String(next.configuredPort))
      toast(
        next.activePort === next.configuredPort
          ? '端口设置已保存。'
          : '端口已保存，重启 Lumi 后生效。',
        'success',
      )
    } catch (error) {
      const message = mcpPortError(error)
      setError(message)
      toast(message, 'error')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  return (
    <section className="settings-row" aria-labelledby="mcp-port-title">
      <div className="settings-row-label">
        <h2 id="mcp-port-title">MCP 端口</h2>
        <p className="settings-service-note">
          默认 {settings?.defaultPort ?? DEFAULT_MCP_PORT}，保存后重启 Lumi 生效。
        </p>
        {settings && settings.configuredPort !== settings.activePort && (
          <p className="settings-service-note">
            当前端口 {settings.activePort}，重启后使用 {settings.configuredPort}。
          </p>
        )}
        {coreStatus.lastError === 'mcp_port_in_use' && (
          <p className="settings-service-note">当前端口被占用，请修改端口并重启 Lumi。</p>
        )}
      </div>
      <form
        className="settings-row-controls mcp-port-controls"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label="端口号" error={error} className="mcp-port-field">
          <Input
            ref={input}
            inputMode="numeric"
            maxLength={5}
            value={value}
            disabled={loading || saving || !settings}
            onChange={(event) => {
              setValue(event.target.value)
              setError('')
            }}
          />
        </Field>
        <Button
          type="submit"
          loading={saving}
          disabled={loading || !settings || String(settings.configuredPort) === value.trim()}
        >
          保存端口
        </Button>
      </form>
    </section>
  )
}
