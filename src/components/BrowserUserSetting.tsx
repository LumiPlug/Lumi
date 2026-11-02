// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserUserAction, BrowserUserStatus, UiCoreStatus } from '@lumiplug/shared'
import {
  OFFICIAL_BROWSER_EXTENSION_ID,
  normalizeBrowserUrl,
  normalizeBrowserBlockedUrls,
} from '@lumiplug/shared'
import { t, useLocale } from '../i18n'
import { Badge, Button, Card, DataText, Field, FieldGroup, Checkbox, Input, Modal } from './ui'
import ConfirmationDialog from './ConfirmationDialog'
import { useToast } from './ToastProvider'
import {
  browserUserActionLabel,
  browserUserRequest,
  browserUserStateLabel,
  getBrowserUserStatus,
  performBrowserUserAction,
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
            {t('连接扩展 {v0} · 可控网页 {v1}', { v0: status.connectedHosts, v1: active })}
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

export function BrowserUserIdentitySettings({
  status,
  autoRepair,
  disabled,
  onAutoRepairChange,
}: {
  status: BrowserUserStatus | null
  autoRepair: boolean
  disabled: boolean
  onAutoRepairChange: (value: boolean) => void
}) {
  useLocale()
  return (
    <>
      <Field
        label={t('官方 Chrome 扩展 ID')}
        description={t(
          '使用 Lumi 官方扩展，无需复制或填写 ID。首次启用需确认全部普通网页范围，Chrome 扩展还需你确认浏览器权限。',
        )}
      >
        <DataText mono>{OFFICIAL_BROWSER_EXTENSION_ID}</DataText>
      </Field>
      {status?.migrationRequired && (
        <Card density="compact">
          <DataText>
            {t(
              '检测到旧开发扩展身份。请重新加载官方扩展；身份迁移与网页范围授权分别确认，不会静默扩大权限。',
            )}
          </DataText>
          {status.extensionId && <DataText mono>{status.extensionId}</DataText>}
        </Card>
      )}
      <Checkbox
        label={t('允许自动维护本安装的官方扩展连接')}
        checked={autoRepair}
        disabled={disabled}
        onChange={(event) => onAutoRepairChange(event.target.checked)}
      />
      <DataText muted>
        {t(
          '仅在同一官方扩展 ID 下维护本安装升级或移动后的路径；不迁移旧 ID、不覆盖未知注册、不改变网页控制范围，也不恢复暂停或接管状态。',
        )}
      </DataText>
    </>
  )
}

export default function BrowserUserSetting({ coreStatus }: { coreStatus: UiCoreStatus }) {
  useLocale()
  const toast = useToast()
  const coreReady = coreStatus.state === 'ready'
  const [status, setStatus] = useState<BrowserUserStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [autoRepair, setAutoRepair] = useState(false)
  const [migrateConfirmed, setMigrateConfirmed] = useState(false)
  const [blockedInput, setBlockedInput] = useState('')
  const [blockedError, setBlockedError] = useState('')
  const blockedInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<BrowserUserAction | null>(null)
  const [confirmation, setConfirmation] = useState<{
    action: Exclude<BrowserUserAction, 'diagnose'>
    autoRepair: boolean
    migrationRequired: boolean
    blockedUrls?: string[]
    previousBlockedUrls?: string[]
    changedUrl?: string
    blocking?: boolean
  } | null>(null)
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
        if (!dirty.current) setAutoRepair(next.autoRepair)
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
  async function perform(
    action: BrowserUserAction,
    confirmed: boolean,
    preference?: boolean,
    migrate = false,
    blockedUrls?: string[],
  ) {
    if (lock.current || !coreReady) return
    lock.current = true
    const request = ++sequence.current
    setLoading(false)
    setBusy(action)
    try {
      const next = await performBrowserUserAction(
        browserUserRequest(
          action,
          OFFICIAL_BROWSER_EXTENSION_ID,
          confirmed,
          action === 'enable' || action === 'repair'
            ? {
                autoRepair: preference ?? autoRepair,
                migrateConfirmed: migrate,
                ...(action === 'enable' ? { scopeConfirmed: true } : {}),
              }
            : action === 'setBlockedUrls'
              ? { blockedUrls }
              : {},
        ),
      )
      if (!mounted.current || request !== sequence.current) return
      setStatus(next)
      setConfirmation(null)
      if (action === 'setBlockedUrls') {
        setBlockedInput('')
        setBlockedError('')
      }
      if (
        action === 'enable' ||
        action === 'repair' ||
        action === 'disable' ||
        action === 'remove'
      ) {
        dirty.current = false
        setAutoRepair(next.autoRepair)
      } else if (!dirty.current) setAutoRepair(next.autoRepair)
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
    setMigrateConfirmed(false)
    setConfirmation({
      action,
      autoRepair,
      migrationRequired: status.migrationRequired && (action === 'enable' || action === 'repair'),
    })
  }
  function askBlockedUrl(url?: string) {
    if (lock.current || !coreReady || !status) return
    try {
      const normalized = normalizeBrowserUrl(url ?? blockedInput)
      const blocking = url === undefined
      const existing = status.blockedUrls
      if (blocking && existing.includes(normalized)) {
        toast(t('此链接已在禁止列表中。'), 'info')
        return
      }
      const next = blocking
        ? [...existing, normalized]
        : existing.filter((value) => value !== normalized)
      const checked = normalizeBrowserBlockedUrls(next)
      setBlockedError('')
      setConfirmation({
        action: 'setBlockedUrls',
        autoRepair,
        migrationRequired: false,
        blockedUrls: checked,
        previousBlockedUrls: [...existing],
        changedUrl: normalized,
        blocking,
      })
    } catch {
      const message = t(
        '请输入不含用户名或密码的完整 HTTP(S) 链接；最多 100 条，每条规范化后不超过 2048 字符。参数和片段不会参与匹配。',
      )
      setBlockedError(message)
      toast(message, 'error')
      blockedInputRef.current?.focus()
    }
  }
  function confirmPending() {
    if (!confirmation) return
    if (
      confirmation.action === 'setBlockedUrls' &&
      JSON.stringify(confirmation.previousBlockedUrls) !== JSON.stringify(status?.blockedUrls)
    ) {
      setConfirmation(null)
      toast(t('禁止列表已变化，请检查最新列表后重新确认。'), 'info')
      return
    }
    void perform(
      confirmation.action,
      true,
      confirmation.autoRepair,
      migrateConfirmed,
      confirmation.blockedUrls,
    )
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
            setAutoRepair(status?.autoRepair ?? false)
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
            <BrowserUserIdentitySettings
              status={status}
              autoRepair={autoRepair}
              disabled={busy !== null || !coreReady || !status}
              onAutoRepairChange={(value) => {
                dirty.current = true
                setAutoRepair(value)
              }}
            />
            {status?.requiresAuthorization && (
              <Card density="compact">
                <DataText>
                  {t(
                    '首次启用或从旧版逐页授权升级，需要明确确认新的全部普通 HTTP(S) 网页范围。未确认前保持停用。',
                  )}
                </DataText>
              </Card>
            )}
            <FieldGroup label={t('禁止的单个链接')}>
              <Field
                label={t('链接')}
                error={blockedError}
                description={t(
                  '按 origin + pathname 精确匹配；忽略参数和片段，保留尾斜杠。不是整个域名或前缀规则。',
                )}
              >
                <Input
                  ref={blockedInputRef}
                  value={blockedInput}
                  maxLength={2048}
                  spellCheck={false}
                  disabled={busy !== null || !coreReady || !status}
                  onChange={(event) => {
                    setBlockedInput(event.target.value)
                    setBlockedError('')
                  }}
                  placeholder="https://example.com/private"
                />
              </Field>
              <Button
                disabled={busy !== null || !coreReady || !status || !blockedInput.trim()}
                onClick={() => askBlockedUrl()}
              >
                {t('禁止此链接')}
              </Button>
              {status?.blockedUrls.map((url) => (
                <Card key={url} density="compact">
                  <DataText mono>{url}</DataText>
                  <Button
                    aria-label={`${t('从禁止列表移除')}: ${url}`}
                    disabled={busy !== null || !coreReady}
                    onClick={() => askBlockedUrl(url)}
                  >
                    {t('从禁止列表移除')}
                  </Button>
                </Card>
              ))}
              {status?.blockedUrls.length === 0 && (
                <DataText muted>
                  {t('暂无禁止链接；已确认范围内的普通 HTTP(S) 网页默认允许。')}
                </DataText>
              )}
            </FieldGroup>
            <div className="settings-row-controls">
              <Button
                variant="primary"
                disabled={
                  !coreReady ||
                  !status ||
                  (status.enabled && !status.requiresAuthorization) ||
                  !status.registration.supported ||
                  busy !== null
                }
                onClick={() => ask('enable')}
              >
                {status?.requiresAuthorization
                  ? t('确认网页范围并启用')
                  : browserUserActionLabel('enable')}
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
                onClick={() => void perform('diagnose', false)}
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
                '请在 Chrome 中加载官方扩展并确认浏览器权限。普通 HTTP(S) 网页默认允许，禁止链接除外；暂停与接管始终优先。重新连接创建新会话，不重放先前操作。Agent 不能通过 MCP 启用此功能。',
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
          disabled={!coreReady || (confirmation.migrationRequired && !migrateConfirmed)}
          danger={confirmation.action === 'remove' || confirmation.action === 'disable'}
          cancel={() => {
            if (!lock.current) setConfirmation(null)
          }}
          confirm={confirmPending}
        >
          <p>
            {confirmation.action === 'setBlockedUrls'
              ? confirmation.blocking
                ? t('确认禁止此精确链接的所有参数和片段变体；相关操作将立即取消。')
                : t('确认移除此禁止项；此链接将回到默认允许范围，但不会恢复暂停或接管状态。')
              : confirmation.action === 'enable' || confirmation.action === 'repair'
                ? t(
                    '此操作将注册或修复 Lumi 官方扩展的本用户连接并诊断状态。修复注册不会代替首次网页范围授权。',
                  )
                : confirmation.action === 'disable'
                  ? t(
                      '停用将阻止新的浏览器操作并撤销当前 Lumi 浏览器连接。已发出的网页动作无法撤回。',
                    )
                  : t(
                      '移除将撤销 Lumi 浏览器连接并移除本安装的注册；不会卸载 Chrome 扩展或清除浏览器数据。',
                    )}
          </p>
          {confirmation.changedUrl && (
            <div className="browser-user-fields">
              <DataText mono>{confirmation.changedUrl}</DataText>
            </div>
          )}
          {confirmation.action === 'enable' && (
            <p>
              {t(
                '确认后，除禁止链接外，所有普通 HTTP(S) 网页默认允许控制。Chrome 扩展仍需你确认浏览器权限。旧版逐页授权不会自动扩大范围。',
              )}
            </p>
          )}
          {(confirmation.action === 'enable' || confirmation.action === 'repair') && (
            <p>
              {confirmation.autoRepair
                ? t('你将授权仅维护同一官方 ID、本安装升级或移动后的注册路径。')
                : t('自动维护未授权；后续路径变化需要手动确认修复。')}
            </p>
          )}
          {confirmation.migrationRequired && (
            <Checkbox
              label={t(
                '我确认将旧的本安装扩展身份迁移至官方 ID；此确认不代替网页范围或 Chrome 权限授权。',
              )}
              checked={migrateConfirmed}
              disabled={busy !== null}
              onChange={(event) => setMigrateConfirmed(event.target.checked)}
            />
          )}
          <p>{t('所有 Lumi MCP 客户端共享此控制域。你确认继续吗？')}</p>
        </ConfirmationDialog>
      )}
    </section>
  )
}
