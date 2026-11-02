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
  browserUserErrorHint,
  browserUserNextStep,
  browserUserRequest,
  browserUserStateLabel,
  getBrowserUserStatus,
  performBrowserUserAction,
} from '../lib/browser-user'

export function BrowserUserSummary({
  status,
  coreReady,
  errorHint,
}: {
  status: BrowserUserStatus | null
  coreReady: boolean
  errorHint?: string | null
}) {
  useLocale()
  const active = status?.sessions.filter((session) => session.state === 'active').length ?? 0
  return (
    <div className="browser-user-fields">
      <div className="browser-user-status" role="status" aria-live="polite">
        <Badge
          tone={
            coreReady &&
            status?.enabled &&
            !status.requiresAuthorization &&
            !status.migrationRequired &&
            active > 0 &&
            status.connectedHosts > 0 &&
            status.registration.registered
              ? 'success'
              : 'neutral'
          }
        >
          {browserUserStateLabel(status, coreReady)}
        </Badge>
      </div>
      <DataText muted>
        {coreReady && errorHint ? errorHint : browserUserNextStep(status, coreReady)}
      </DataText>
    </div>
  )
}

export function BrowserUserPrimaryActions({
  status,
  coreReady,
  busy,
  onInstall,
  onCheck,
  closing = false,
  onDisable,
}: {
  status: BrowserUserStatus | null
  coreReady: boolean
  busy: boolean
  closing?: boolean
  onInstall: () => void
  onCheck: () => void
  onDisable: () => void
}) {
  useLocale()
  return (
    <div className="settings-row-controls">
      <Button
        variant="primary"
        disabled={!coreReady || !status || !status.registration.supported || busy}
        onClick={onInstall}
      >
        {t('安装')}
      </Button>
      <Button disabled={!coreReady || busy} onClick={onCheck}>
        {t('检查连接')}
      </Button>
      <Button disabled={!coreReady || closing} onClick={onDisable}>
        {t('关闭')}
      </Button>
    </div>
  )
}

export default function BrowserUserSetting({ coreStatus }: { coreStatus: UiCoreStatus }) {
  useLocale()
  const toast = useToast()
  const coreReady = coreStatus.state === 'ready'
  const [status, setStatus] = useState<BrowserUserStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [errorHint, setErrorHint] = useState<string | null>(null)
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
        if (notify) toast(browserUserStateLabel(next, true), 'info')
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
      lock.current = false
      setBusy(null)
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
    if ((lock.current && action !== 'disable') || !coreReady) return
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
      setErrorHint(null)
      setConfirmation((pending) =>
        pending?.action === 'disable' && action !== 'disable' ? pending : null,
      )
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
      toast(browserUserStateLabel(next, true), 'info')
    } catch (error) {
      if (mounted.current && request === sequence.current) {
        setStatus(null)
        setConfirmation((pending) =>
          pending?.action === 'disable' && action !== 'disable' ? pending : null,
        )
        const hint = browserUserErrorHint(error)
        setErrorHint(hint)
        toast(hint, 'error')
      }
    } finally {
      if (request === sequence.current) {
        lock.current = false
        if (mounted.current) setBusy(null)
      }
    }
  }
  function ask(action: Exclude<BrowserUserAction, 'diagnose'>) {
    if ((lock.current && action !== 'disable') || !coreReady || (!status && action !== 'disable'))
      return
    setMigrateConfirmed(false)
    setConfirmation({
      action,
      autoRepair,
      migrationRequired:
        !!status?.migrationRequired && (action === 'enable' || action === 'repair'),
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
        >
          <div className="browser-user-fields" aria-busy={loading || busy !== null}>
            <BrowserUserSummary status={status} coreReady={coreReady} errorHint={errorHint} />
            <BrowserUserPrimaryActions
              status={status}
              coreReady={coreReady}
              busy={busy !== null || loading}
              closing={busy === 'disable'}
              onInstall={() => ask('enable')}
              onCheck={() => void perform('diagnose', false)}
              onDisable={() => ask('disable')}
            />
            <FieldGroup label={t('禁止的单个链接')}>
              <Field
                label={t('链接')}
                error={blockedError}
                description={t(
                  '只禁止这个链接，忽略问号后的参数和片段；不影响同网站其他页面。尾斜杠不同的链接需分别添加。',
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
          </div>
        </Modal>
      )}
      {confirmation && (
        <ConfirmationDialog
          title={browserUserActionLabel(confirmation.action)}
          confirmLabel={browserUserActionLabel(confirmation.action)}
          busy={busy !== null && (confirmation.action !== 'disable' || busy === 'disable')}
          disabled={!coreReady || (confirmation.migrationRequired && !migrateConfirmed)}
          danger={confirmation.action === 'disable'}
          cancel={() => {
            if (!lock.current || (confirmation.action === 'disable' && busy !== 'disable'))
              setConfirmation(null)
          }}
          confirm={confirmPending}
        >
          <p>
            {confirmation.action === 'setBlockedUrls'
              ? confirmation.blocking
                ? t('确认禁止此精确链接的所有参数和片段变体；相关操作将立即取消。')
                : t('确认移除此禁止项；此链接将回到默认允许范围，但不会恢复暂停或接管状态。')
              : confirmation.action === 'enable' || confirmation.action === 'repair'
                ? t('安装 Lumi 的浏览器连接。Chrome 扩展仍需你在浏览器中安装并确认权限。')
                : t('关闭后停止浏览器控制，但保留安装。已执行的网页操作无法撤回。')}
          </p>
          {confirmation.changedUrl && (
            <div className="browser-user-fields">
              <DataText mono>{confirmation.changedUrl}</DataText>
            </div>
          )}
          {confirmation.action === 'enable' && (
            <p>{t('允许 Lumi 控制所有普通 HTTP(S) 网页，禁止列表除外。暂停和接管始终优先。')}</p>
          )}
          {(confirmation.action === 'enable' || confirmation.action === 'repair') && (
            <Checkbox
              label={t('允许 Lumi 更新或移动后自动保持连接（仅本安装和同一官方扩展）')}
              checked={confirmation.autoRepair}
              disabled={busy !== null}
              onChange={(event) =>
                setConfirmation({ ...confirmation, autoRepair: event.target.checked })
              }
            />
          )}
          {confirmation.migrationRequired && (
            <Checkbox
              label={t('我确认将旧版连接切换到官方扩展；仍需在 Chrome 中确认权限。')}
              checked={migrateConfirmed}
              disabled={busy !== null}
              onChange={(event) => setMigrateConfirmed(event.target.checked)}
            />
          )}
          <p>{t('所有连接到 Lumi 的 Agent 共享浏览器控制。')}</p>
        </ConfirmationDialog>
      )}
    </section>
  )
}
