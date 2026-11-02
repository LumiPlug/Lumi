// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserUserAction, BrowserUserStatus, UiCoreStatus } from '@lumiplug/shared'
import { t, useLocale } from '../i18n'
import { Badge, Button, Card, DataText, Field, FieldGroup, Input, Modal } from './ui'
import ConfirmationDialog from './ConfirmationDialog'
import { useToast } from './ToastProvider'
import {
  browserUserActionLabel,
  browserUserRequest,
  browserUserStateLabel,
  getBrowserUserStatus,
  performBrowserUserAction,
  validBrowserExtensionId,
} from '../lib/browser-user'

export function BrowserUserSummary({
  status,
  coreReady,
}: {
  status: BrowserUserStatus | null
  coreReady: boolean
}) {
  useLocale()
  const active = status?.sessions.filter((session) => session.state === 'active').length ?? 0
  const issues = status ? [...new Set([...status.registration.issues, ...status.issues])] : []
  return (
    <div className="browser-user-fields">
      <div className="browser-user-status" role="status" aria-live="polite">
        <Badge
          tone={
            coreReady &&
            status?.enabled &&
            active > 0 &&
            status.connectedHosts > 0 &&
            status.registration.registered
              ? 'success'
              : 'neutral'
          }
        >
          {browserUserStateLabel(status, coreReady)}
        </Badge>
        {coreReady && status && (
          <DataText muted>
            {t('连接扩展 {v0} · 授权标签页 {v1}', { v0: status.connectedHosts, v1: active })}
          </DataText>
        )}
      </div>
      {coreReady && status && (
        <>
          <DataText muted>
            {status.registration.registered ? t('本机注册已确认') : t('本机注册未确认')}
          </DataText>
          {issues.length > 0 && (
            <Card density="compact">
              <DataText muted>{t('诊断信息')}</DataText>
              <ul>
                {issues.map((issue) => (
                  <li key={issue}>
                    <DataText mono>{issue}</DataText>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {status.sessions.length > 0 && (
            <FieldGroup label={t('浏览器会话')}>
              {status.sessions.map((session) => (
                <Card key={session.id} density="compact">
                  <div className="browser-user-status">
                    <DataText>{session.title || session.origin}</DataText>
                    <Badge>{session.state}</Badge>
                  </div>
                  <DataText muted>{session.origin}</DataText>
                </Card>
              ))}
            </FieldGroup>
          )}
        </>
      )}
    </div>
  )
}

export default function BrowserUserSetting({ coreStatus }: { coreStatus: UiCoreStatus }) {
  useLocale()
  const toast = useToast()
  const coreReady = coreStatus.state === 'ready'
  const [status, setStatus] = useState<BrowserUserStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [extensionId, setExtensionId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<BrowserUserAction | null>(null)
  const [confirmation, setConfirmation] = useState<{
    action: Exclude<BrowserUserAction, 'diagnose'>
    extensionId: string
  } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const reading = useRef(false)
  const lock = useRef(false),
    dirty = useRef(false),
    sequence = useRef(0),
    mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      sequence.current++
    }
  }, [])
  const refresh = useCallback(
    async (notify = false) => {
      if (!coreReady || lock.current || reading.current) return
      reading.current = true
      const request = ++sequence.current
      setLoading(true)
      try {
        const next = await getBrowserUserStatus()
        if (!mounted.current || request !== sequence.current) return
        setStatus(next)
        if (!dirty.current) setExtensionId(next.extensionId ?? '')
        if (notify) toast(t('Browser User 状态已刷新。'), 'info')
      } catch {
        if (!mounted.current || request !== sequence.current) return
        setStatus(null)
        if (notify) toast(t('无法读取 Browser User 状态，请检查 Core 后重试。'), 'error')
      } finally {
        reading.current = false
        if (mounted.current && request === sequence.current) setLoading(false)
      }
    },
    [coreReady, toast],
  )
  useEffect(() => {
    if (!coreReady) {
      sequence.current++
      setStatus(null)
      setConfirmation(null)
      setLoading(false)
      return
    }
    void refresh()
  }, [coreReady, refresh])
  useEffect(() => {
    if (!open || !coreReady) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5000)
    return () => clearInterval(timer)
  }, [open, coreReady, refresh])
  useEffect(() => {
    if (error && !busy) input.current?.focus()
  }, [error, busy])
  async function perform(action: BrowserUserAction, id: string, confirmed: boolean) {
    if (lock.current || !coreReady) return
    lock.current = true
    const request = ++sequence.current
    setLoading(false)
    setBusy(action)
    try {
      const next = await performBrowserUserAction(browserUserRequest(action, id, confirmed))
      if (!mounted.current || request !== sequence.current) return
      setStatus(next)
      setConfirmation(null)
      dirty.current = false
      setExtensionId(next.extensionId ?? '')
      const issues = [...next.issues, ...next.registration.issues]
      toast(
        issues.length > 0
          ? t('操作已返回诊断问题，请查看真实状态；未确认连接成功。')
          : action === 'diagnose'
            ? t('诊断已完成，请查看当前连接与授权状态。')
            : t('Browser User 设置已更新；浏览器授权仍需在 Chrome 中完成。'),
        issues.length > 0 || action === 'diagnose' ? 'info' : 'success',
      )
    } catch {
      if (mounted.current && request === sequence.current) {
        setStatus(null)
        setConfirmation(null)
        toast(t('Browser User 操作未确认完成。请刷新状态后再决定是否重试。'), 'error')
      }
    } finally {
      lock.current = false
      if (mounted.current) setBusy(null)
    }
  }
  function ask(action: Exclude<BrowserUserAction, 'diagnose'>) {
    if (lock.current || !coreReady || !status) return
    if ((action === 'enable' || action === 'repair') && !validBrowserExtensionId(extensionId)) {
      const message = t('请输入由 32 个小写字母 a–p 组成的 Chrome 扩展 ID。')
      setError(message)
      toast(message, 'error')
      input.current?.focus()
      return
    }
    setError('')
    setConfirmation({ action, extensionId: extensionId.trim() })
  }
  return (
    <section className="settings-row" aria-labelledby="browser-user-title">
      <div className="settings-row-label">
        <h2 id="browser-user-title">Browser User</h2>
        <p className="settings-service-note">{browserUserStateLabel(status, coreReady)}</p>
      </div>
      <div className="settings-row-controls">
        <Button
          className="settings-button"
          onClick={(event) => {
            trigger.current = event.currentTarget
            dirty.current = false
            setExtensionId(status?.extensionId ?? '')
            setError('')
            setOpen(true)
            void refresh()
          }}
        >
          {t('管理浏览器连接')}
        </Button>
      </div>
      {open && (
        <Modal
          title="Browser User"
          returnFocus={trigger.current}
          onClose={() => {
            if (!confirmation) setOpen(false)
          }}
          busy={busy !== null || confirmation !== null}
          actions={(close) => (
            <>
              <Button
                disabled={busy !== null || loading || !coreReady}
                onClick={() => void refresh(true)}
              >
                {t('刷新状态')}
              </Button>
              <Button disabled={busy !== null || confirmation !== null} onClick={close}>
                {t('关闭')}
              </Button>
            </>
          )}
        >
          <div className="browser-user-fields" aria-busy={loading || busy !== null}>
            <BrowserUserSummary status={status} coreReady={coreReady} />
            <Field
              label={t('Chrome 扩展 ID')}
              error={error}
              description={t(
                '在 chrome://extensions 加载 Lumi 扩展后，复制其扩展 ID。注册不会自动授予标签页控制权。',
              )}
            >
              <Input
                ref={input}
                value={extensionId}
                maxLength={32}
                spellCheck={false}
                autoComplete="off"
                disabled={busy !== null || !coreReady}
                onChange={(event) => {
                  dirty.current = true
                  setExtensionId(event.target.value)
                  setError('')
                }}
              />
            </Field>
            <div className="settings-row-controls">
              <Button
                variant="primary"
                disabled={
                  !coreReady ||
                  !status ||
                  status.enabled ||
                  !status.registration.supported ||
                  busy !== null
                }
                onClick={() => ask('enable')}
              >
                {browserUserActionLabel('enable')}
              </Button>
              <Button
                disabled={!coreReady || !status || !status.registration.supported || busy !== null}
                onClick={() => ask('repair')}
              >
                {browserUserActionLabel('repair')}
              </Button>
              <Button
                disabled={!coreReady || !status?.enabled || busy !== null}
                onClick={() => ask('disable')}
              >
                {browserUserActionLabel('disable')}
              </Button>
              <Button
                loading={busy === 'diagnose'}
                disabled={!coreReady || busy !== null}
                onClick={() => void perform('diagnose', '', false)}
              >
                {browserUserActionLabel('diagnose')}
              </Button>
              <Button
                variant="danger"
                disabled={
                  !coreReady ||
                  !status ||
                  (!status.enabled && !status.registration.registered && !status.extensionId) ||
                  busy !== null
                }
                onClick={() => ask('remove')}
              >
                {browserUserActionLabel('remove')}
              </Button>
            </div>
            <p>
              {t(
                '请在 Chrome 中手动加载扩展并授权当前标签页。跨站跳转、断线或接管后，需要重新授权；Agent 不能通过 MCP 启用此功能。',
              )}
            </p>
            <p>
              {t(
                '当前所有 Lumi MCP 客户端共享一个浏览器控制域，操作串行执行，并非多 Agent 身份隔离。请勿让互不信任的 Agent 同时控制浏览器。',
              )}
            </p>
          </div>
        </Modal>
      )}
      {confirmation && (
        <ConfirmationDialog
          title={browserUserActionLabel(confirmation.action)}
          confirmLabel={browserUserActionLabel(confirmation.action)}
          busy={busy !== null}
          disabled={!coreReady}
          danger={confirmation.action === 'remove' || confirmation.action === 'disable'}
          cancel={() => {
            if (!lock.current) setConfirmation(null)
          }}
          confirm={() => void perform(confirmation.action, confirmation.extensionId, true)}
        >
          <p>
            {confirmation.action === 'enable' || confirmation.action === 'repair'
              ? t(
                  '此操作将保存扩展 ID 并注册或修复本用户的 Chrome 本机通信连接。只有你在 Chrome 中授权的标签页可被操作。',
                )
              : confirmation.action === 'disable'
                ? t(
                    '停用将阻止新的浏览器操作并撤销当前 Lumi 浏览器连接。已发出的网页动作无法撤回。',
                  )
                : t(
                    '移除将撤销 Lumi 浏览器连接并移除本安装的注册；不会卸载 Chrome 扩展或清除浏览器数据。',
                  )}
          </p>
          <p>{t('所有 Lumi MCP 客户端共享此控制域。你确认继续吗？')}</p>
        </ConfirmationDialog>
      )}
    </section>
  )
}
