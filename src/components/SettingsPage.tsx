// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../i18n'
import type { McpConnectionInfo, UiCoreStatus } from '@lumiplug/shared'
import HomepagePromptSetting from './HomepagePromptSetting'
import McpConnectionCard from './McpConnectionCard'
import McpPortSetting from './McpPortSetting'
import { useLayoutEffect, useRef, useState } from 'react'
import { useToast } from './ToastProvider'
import { saveLocale } from '../i18n/preferences'
import type { Locale } from '../i18n'
import { Button, Select, ThemePicker } from './ui'
import './settings.css'

type Theme = 'dark' | 'light'
const statusLabels: Record<UiCoreStatus['state'], string> = {
  get ready() {
    return t('已连接')
  },
  get starting() {
    return t('启动中')
  },
  get restarting() {
    return t('重启中')
  },
  get stopping() {
    return t('停止中')
  },
  get error() {
    return t('连接异常')
  },
  get stopped() {
    return t('已停止')
  },
  get disconnected() {
    return t('未连接')
  },
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
  const locale = useLocale()
  const showToast = useToast()
  const [savingLanguage, setSavingLanguage] = useState(false)
  const languageLock = useRef(false)
  const languageControl = useRef<HTMLSelectElement>(null)
  const restoreLanguageFocus = useRef(false)
  useLayoutEffect(() => {
    if (savingLanguage || !restoreLanguageFocus.current) return
    restoreLanguageFocus.current = false
    const active = document.activeElement
    if (
      active === document.body ||
      active === document.documentElement ||
      active === languageControl.current
    )
      languageControl.current?.focus({ preventScroll: true })
  }, [savingLanguage])
  async function changeLanguage(value: Locale) {
    if (languageLock.current || value === locale) return
    languageLock.current = true
    restoreLanguageFocus.current = document.activeElement === languageControl.current
    setSavingLanguage(true)
    try {
      await saveLocale(value)
      showToast(t('语言已切换为简体中文。'), 'success')
    } catch {
      showToast(t('语言设置保存失败，请重试。'), 'error')
    } finally {
      languageLock.current = false
      setSavingLanguage(false)
    }
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1 className="sr-only">{t('设置')}</h1>
        <p>{t('调整外观，管理 MCP 连接与本地服务。')}</p>
      </header>
      <section className="settings-row" aria-labelledby="appearance-title">
        <h2 id="appearance-title">{t('外观')}</h2>
        <ThemePicker value={theme} onValueChange={onThemeChange} />
      </section>
      <section className="settings-row" aria-labelledby="language-title" aria-busy={savingLanguage}>
        <h2 id="language-title">
          <label htmlFor="ui-language">语言 / Language</label>
        </h2>
        <div className="settings-row-controls">
          <Select
            id="ui-language"
            ref={languageControl}
            value={locale}
            disabled={savingLanguage}
            aria-label={savingLanguage ? t('保存语言中…') : '语言 / Language'}
            onChange={(event) => {
              void changeLanguage(event.currentTarget.value as Locale)
            }}
          >
            <option value="zh-CN" lang="zh-CN">
              简体中文
            </option>
            <option value="en" lang="en">
              English
            </option>
          </Select>
        </div>
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
            <dt className="sr-only">{t('连接状态')}</dt>
            <dd className="settings-core-status" data-state={coreStatus.state}>
              {statusLabels[coreStatus.state]}
            </dd>
          </div>
          <div>
            <dt className="sr-only">{t('版本')}</dt>
            <dd className="settings-core-version">{coreStatus.coreVersion ?? t('版本未知')}</dd>
          </div>
        </dl>
      </section>
      {import.meta.env.DEV && (
        <section className="settings-row" aria-labelledby="development-title">
          <h2 id="development-title">{t('开发')}</h2>
          <div className="settings-row-controls">
            <Button id="ui-components-entry" onClick={openComponents}>
              {t('UI组件')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
