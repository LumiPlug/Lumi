// SPDX-License-Identifier: MPL-2.0
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BrowserPageRule,
  BrowserUserActionRequest,
  BrowserUserStatus,
  UiCoreStatus,
} from '@lumiplug/shared'
import { OFFICIAL_BROWSER_EXTENSION_ID } from '@lumiplug/shared'
import { t, useLocale } from '../i18n'
import { Badge, Button, DataText, FieldGroup, Input, Select, Modal, Tooltip } from './ui'
import ConfirmationDialog from './ConfirmationDialog'
import { useToast } from './ToastProvider'
import {
  browserUserConnectionActive,
  browserUserErrorHint,
  browserUserIssueHint,
  browserUserRequest,
  browserUserRuleUpdate,
  browserUserStateLabel,
  getBrowserUserStatus,
  openBrowserExtensionStore,
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
  const issueHint = status ? status.issues.map(browserUserIssueHint).find(Boolean) : null
  return (
    <div className="browser-user-fields" role="status" aria-live="polite">
      <Badge
        tone={
          coreReady && status?.enabled && status.connectedHosts > 0 && !status.requiresAuthorization
            ? 'success'
            : 'neutral'
        }
      >
        {browserUserStateLabel(status, coreReady)}
      </Badge>
      {coreReady && (errorHint || issueHint) && (
        <div id="browser-user-error">
          <DataText muted>{errorHint || issueHint}</DataText>
        </div>
      )}
    </div>
  )
}

export function BrowserUserPrimaryActions({
  status,
  coreReady,
  busy,
  connecting = false,
  closing = false,
  onInstall,
  onCheck,
  onDisable,
}: {
  status: BrowserUserStatus | null
  coreReady: boolean
  busy: boolean
  connecting?: boolean
  closing?: boolean
  onInstall: () => void
  onCheck: () => void
  onDisable: () => void
}) {
  useLocale()
  const active = browserUserConnectionActive(status, connecting)
  return (
    <div className="settings-row-controls">
      <Button onClick={onInstall}>{t('安装插件')}</Button>
      <Tooltip label={t('安装插件')} icon="help">
        {t(
          '在默认浏览器中打开官方 Chrome 扩展商店页。若尚未发布，商店可能显示不可用；Lumi 不会自动安装插件。',
        )}
      </Tooltip>
      {active ? (
        <Button disabled={!coreReady || closing} onClick={onDisable}>
          {t('关闭连接')}
        </Button>
      ) : (
        <Button variant="primary" disabled={!coreReady || busy} onClick={onCheck}>
          {t('检查连接')}
        </Button>
      )}
      <Tooltip label={t('浏览器控制')} icon="help">
        {t(
          '点击检查连接即允许控制普通 HTTP(S) 网页，禁止项除外。首次连接自动记住本机对端；请在可信环境中连接。Chrome 权限仍需批准。',
        )}
      </Tooltip>
    </div>
  )
}

export function BrowserPageRuleRow({
  rule,
  disabled,
  changed,
  invalid = false,
  onChange,
  onSave,
  onRemove,
}: {
  rule: BrowserPageRule
  disabled: boolean
  changed: boolean
  invalid?: boolean
  onChange: (rule: BrowserPageRule) => void
  onSave: () => void
  onRemove: () => void
}) {
  useLocale()
  return (
    <div className="browser-page-rule-row" data-editing={changed || undefined}>
      <Input
        aria-label={t('网页标签')}
        maxLength={120}
        value={rule.label}
        disabled={disabled}
        onChange={(event) => onChange({ ...rule, label: event.target.value })}
        placeholder={t('标签')}
      />
      <Input
        aria-label={t('网页链接')}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'browser-user-error' : undefined}
        maxLength={2048}
        value={rule.url}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange({ ...rule, url: event.target.value })}
        placeholder="https://example.com/page"
      />
      <Select
        aria-label={t('网页权限')}
        value={rule.permission}
        disabled={disabled}
        onChange={(event) =>
          onChange({ ...rule, permission: event.target.value as BrowserPageRule['permission'] })
        }
      >
        <option value="allow">{t('允许')}</option>
        <option value="block">{t('禁止')}</option>
      </Select>
      <Button disabled={disabled || !changed} onClick={onSave}>
        {t('保存')}
      </Button>
      <Button disabled={disabled} onClick={onRemove}>
        {t('删除')}
      </Button>
    </div>
  )
}

type RuleEdit = {
  base: BrowserPageRule[]
  revision: number
  index: number | null
  draft: BrowserPageRule
}
type Pending = {
  request: BrowserUserActionRequest
}
export default function BrowserUserSetting({ coreStatus }: { coreStatus: UiCoreStatus }) {
  useLocale()
  const toast = useToast()
  const coreReady = coreStatus.state === 'ready'
  const [status, setStatus] = useState<BrowserUserStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [errorHint, setErrorHint] = useState<string | null>(null)
  const [edit, setEdit] = useState<RuleEdit | null>(null)
  const [ruleInvalid, setRuleInvalid] = useState(false)
  const [loading, setLoading] = useState(false)
  const [connectionIntent, setConnectionIntent] = useState(false)
  const [busy, setBusy] = useState<BrowserUserActionRequest['action'] | null>(null)
  const [confirmation, setConfirmation] = useState<Pending | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const reading = useRef(false)
  const lock = useRef(false)
  const sequence = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      sequence.current++
    }
  }, [])
  const refresh = useCallback(async () => {
    if (!coreReady || lock.current || reading.current) return
    reading.current = true
    const request = ++sequence.current
    setLoading(true)
    try {
      const next = await getBrowserUserStatus()
      if (!mounted.current || request !== sequence.current) return
      setStatus(next)
      setConnectionIntent(false)
    } catch (error) {
      if (!mounted.current || request !== sequence.current) return
      setStatus(null)
      setErrorHint(browserUserErrorHint(error))
    } finally {
      reading.current = false
      if (mounted.current && request === sequence.current) setLoading(false)
    }
  }, [coreReady])
  useEffect(() => {
    if (!coreReady) {
      sequence.current++
      lock.current = false
      setBusy(null)
      setConnectionIntent(false)
      setStatus(null)
      setConfirmation(null)
      setLoading(false)
    } else if (open) void refresh()
  }, [coreReady, open, refresh])
  // Only read while waiting for the extension; opening the panel never enables it.
  useEffect(() => {
    if (!open || !coreReady || !status?.enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [open, coreReady, status?.enabled, refresh])

  async function perform(request: BrowserUserActionRequest) {
    if ((lock.current && request.action !== 'disable') || !coreReady) return
    lock.current = true
    const current = ++sequence.current
    setBusy(request.action)
    if (request.action === 'enable') setConnectionIntent(true)
    setLoading(false)
    try {
      const next = await performBrowserUserAction(request)
      if (!mounted.current || current !== sequence.current) return
      setStatus(next)
      setConnectionIntent(false)
      setErrorHint(null)
      if (request.action === 'setPageRules') {
        setEdit(null)
        setRuleInvalid(false)
      }
      setConfirmation(null)
      toast(browserUserStateLabel(next, true), 'info')
    } catch (error) {
      if (!mounted.current || current !== sequence.current) return
      // Keep the persisted rules and local draft; a failed save never changes policy locally.
      const hint = browserUserErrorHint(error)
      setErrorHint(hint)
      setConfirmation(null)
      toast(hint, 'error')
    } finally {
      if (current === sequence.current) {
        lock.current = false
        if (mounted.current) setBusy(null)
      }
    }
  }
  async function connect() {
    if (!coreReady || lock.current || reading.current) return
    // Refresh before choosing consent so stale status never implicitly widens scope.
    reading.current = true
    const current = ++sequence.current
    setLoading(true)
    try {
      const next = await getBrowserUserStatus()
      if (!mounted.current || current !== sequence.current) return
      setStatus(next)
      // The click is the explicit product-level scope consent; opening this
      // panel or polling status never sends an enable request.
      void perform(
        browserUserRequest('enable', OFFICIAL_BROWSER_EXTENSION_ID, true, { scopeConfirmed: true }),
      )
    } catch (error) {
      if (mounted.current && current === sequence.current) {
        const hint = browserUserErrorHint(error)
        setErrorHint(hint)
        toast(hint, 'error')
      }
    } finally {
      reading.current = false
      if (mounted.current && current === sequence.current) setLoading(false)
    }
  }
  function closeConnection() {
    // Immediate explicitly clicked stop, even while enable is awaiting the Core listener.
    void perform(browserUserRequest('disable', undefined, true))
  }
  async function installPlugin() {
    try {
      await openBrowserExtensionStore()
      toast(t('已请求打开商店页；插件是否可安装以商店页面为准。'), 'info')
    } catch (error) {
      const hint = browserUserErrorHint(error)
      setErrorHint(hint)
      toast(hint, 'error')
    }
  }
  function startEdit(index: number | null) {
    if (!status || lock.current) return
    setEdit({
      base: status.pageRules.map((rule) => ({ ...rule })),
      revision: status.rulesRevision,
      index,
      draft:
        index === null
          ? { label: '', url: '', permission: 'block' }
          : { ...status.pageRules[index]! },
    })
    setErrorHint(null)
    setRuleInvalid(false)
  }
  function saveRule(remove = false) {
    if (!edit || lock.current) return
    try {
      const request = browserUserRuleUpdate(
        edit.base,
        edit.revision,
        edit.index,
        remove ? null : edit.draft,
      )
      setConfirmation({ request })
    } catch {
      const hint = t('请输入有效的 HTTP(S) 链接；链接不能重复，标签最多 120 字符。')
      setErrorHint(hint)
      setRuleInvalid(true)
      toast(hint, 'error')
      listRef.current?.querySelectorAll<HTMLInputElement>('[data-editing] input')[1]?.focus()
    }
  }
  async function reloadRules() {
    if (!edit || lock.current || reading.current) return
    // Conflict recovery explicitly reloads the base but preserves the entered draft.
    reading.current = true
    const current = ++sequence.current
    setLoading(true)
    try {
      const next = await getBrowserUserStatus()
      if (!mounted.current || current !== sequence.current) return
      const oldUrl = edit.index === null ? null : edit.base[edit.index]?.url
      const nextIndex =
        oldUrl === null ? null : next.pageRules.findIndex((rule) => rule.url === oldUrl)
      setStatus(next)
      setEdit({
        ...edit,
        base: next.pageRules,
        revision: next.rulesRevision,
        index: nextIndex === -1 ? null : nextIndex,
      })
      setErrorHint(t('已更新规则，请核对草稿后重新保存。'))
    } catch (error) {
      if (mounted.current && current === sequence.current) setErrorHint(browserUserErrorHint(error))
    } finally {
      reading.current = false
      if (mounted.current && current === sequence.current) setLoading(false)
    }
  }
  const displayed = edit?.base ?? status?.pageRules ?? []
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
            setOpen(true)
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
              connecting={busy === 'enable' || connectionIntent}
              closing={busy === 'disable'}
              onInstall={() => void installPlugin()}
              onCheck={() => void connect()}
              onDisable={closeConnection}
            />
            <FieldGroup label={t('网页权限')}>
              <div className="browser-user-status">
                <Button
                  disabled={
                    !coreReady || !status || busy !== null || !!edit || displayed.length >= 100
                  }
                  onClick={() => startEdit(null)}
                >
                  {t('添加网页')}
                </Button>
                <Tooltip label={t('网页权限')} icon="help">
                  {t(
                    '未列出的普通网页默认允许。链接忽略参数和片段，保留尾斜杠。修改后保存才生效；暂停和接管始终优先。',
                  )}
                </Tooltip>
              </div>
              <div
                className="browser-page-rules"
                ref={listRef}
                tabIndex={0}
                aria-label={t('网页权限列表')}
              >
                {displayed.map((rule, index) => (
                  <BrowserPageRuleRow
                    key={rule.url}
                    rule={edit?.index === index ? edit.draft : rule}
                    disabled={
                      !coreReady || loading || busy !== null || (!!edit && edit.index !== index)
                    }
                    changed={edit?.index === index}
                    invalid={edit?.index === index && ruleInvalid}
                    onChange={(draft) => {
                      setRuleInvalid(false)
                      if (!edit) {
                        startEdit(index)
                        setEdit({
                          base: displayed.map((row) => ({ ...row })),
                          revision: status!.rulesRevision,
                          index,
                          draft,
                        })
                      } else setEdit({ ...edit, draft })
                    }}
                    onSave={() => saveRule()}
                    onRemove={() => {
                      if (edit?.index === index) saveRule(true)
                      else {
                        setEdit({
                          base: displayed.map((row) => ({ ...row })),
                          revision: status!.rulesRevision,
                          index,
                          draft: { ...rule },
                        })
                        const request = browserUserRuleUpdate(
                          displayed,
                          status!.rulesRevision,
                          index,
                          null,
                        )
                        setConfirmation({ request })
                      }
                    }}
                  />
                ))}
                {edit?.index === null && (
                  <BrowserPageRuleRow
                    rule={edit.draft}
                    disabled={busy !== null || loading || !coreReady}
                    changed
                    invalid={ruleInvalid}
                    onChange={(draft) => {
                      setRuleInvalid(false)
                      setEdit({ ...edit, draft })
                    }}
                    onSave={() => saveRule()}
                    onRemove={() => setEdit(null)}
                  />
                )}
                {!displayed.length && edit?.index !== null && (
                  <DataText muted>{t('暂无网页规则')}</DataText>
                )}
              </div>
              {edit && (
                <div className="settings-row-controls">
                  <Button disabled={busy !== null || loading} onClick={() => setEdit(null)}>
                    {t('取消编辑')}
                  </Button>
                  <Button
                    disabled={busy !== null || loading || !coreReady}
                    onClick={() => void reloadRules()}
                  >
                    {t('重新检查规则')}
                  </Button>
                </div>
              )}
            </FieldGroup>
          </div>
        </Modal>
      )}
      {confirmation && (
        <ConfirmationDialog
          title={confirmation.request.action === 'resetPairing' ? t('重新配对') : t('保存网页规则')}
          confirmLabel={t('确认')}
          busy={busy !== null}
          disabled={!coreReady}
          cancel={() => {
            if (!lock.current) setConfirmation(null)
          }}
          confirm={() => {
            const request = {
              ...confirmation.request,
            }
            setConfirmation(null)
            void perform(request)
          }}
        >
          {confirmation.request.action === 'resetPairing' ? (
            <p>{t('撤销此 Lumi 的已保存连接信任并关闭连接。之后请在可信环境中重新检查连接。')}</p>
          ) : (
            <p>{t('保存后立即生效，禁止的网页操作将停止。')}</p>
          )}
        </ConfirmationDialog>
      )}
    </section>
  )
}
