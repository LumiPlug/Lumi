// SPDX-License-Identifier: MPL-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import zhCN from '../i18n/zh-CN.json'
import en from '../i18n/en.json'
import {
  applyLocale,
  formatMonth,
  formatNumber,
  getLocale,
  subscribeLocale,
  t,
  translateKnown,
} from '../i18n'
import SettingsPage from '../components/SettingsPage'
import KnowledgePage from '../components/KnowledgePage'
import ToolsPage from '../components/ToolsPage'
import { DateRangeCalendar, Pagination, ThemePicker } from '../components/ui'
import { disconnectedStatus } from './tauri'
import { toolErrorMessage } from './tools'
import { buildWorkbenchPrompt } from './mcp'

vi.mock('../components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastViewport: () => {},
}))
const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled, invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))
import { connectLocale, saveLocale } from '../i18n/preferences'

beforeEach(() => {
  applyLocale('zh-CN')
  native.enabled = false
  vi.clearAllMocks()
})
afterEach(() => {
  applyLocale('zh-CN')
  vi.unstubAllGlobals()
})

describe('typed interface translations', () => {
  it('has matching resource keys and interpolation arguments', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort())
    const tokens = (text: string) =>
      [...new Set([...text.matchAll(/\{(v\d+)(?:\||\})/g)].map((match) => match[1]))].sort()
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim().length, key).toBeGreaterThan(0)
      expect(tokens(value), key).toEqual(tokens(key))
      expect(/[\u3400-\u9fff]/.test(value), key).toBe(false)
    }
  })
  it('subscribes without remounting and rejects unsupported locale values', () => {
    const listener = vi.fn(),
      dispose = subscribeLocale(listener)
    applyLocale('fr')
    expect(getLocale()).toBe('zh-CN')
    applyLocale('en')
    expect(t('设置')).toBe('Settings')
    applyLocale('en')
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    applyLocale('zh-CN')
    expect(listener).toHaveBeenCalledTimes(1)
  })
  it('formats language-aware dates, numbers, plural counts, and safe interpolations', () => {
    applyLocale('en')
    expect(formatMonth(new Date(2026, 9, 1))).toBe('October 2026')
    expect(formatNumber(12345.6)).toBe('12,345.6')
    expect(t('{v0}，{v1} 个工具', { v0: 'All', v1: 1 })).toBe('All, 1 tool')
    expect(t('{v0}，{v1} 个工具', { v0: 'All', v1: 2 })).toBe('All, 2 tools')
    expect(t('配置 {v0}', { v0: '<script>{v1}</script>' })).toBe('Configure <script>{v1}</script>')
    expect(translateKnown('my user data: 设置')).toBe('my user data: 设置')
    const stored = t('配置 {v0}', { v0: '用户工具' })
    applyLocale('zh-CN')
    expect(translateKnown(stored)).toBe('配置 用户工具')
  })
  it('updates imported status labels, common components, and protocol error messages', () => {
    const settings = () =>
      renderToStaticMarkup(
        <SettingsPage
          coreStatus={disconnectedStatus}
          mcpConnection={null}
          onMcpConnectionChange={() => {}}
          theme="dark"
          onThemeChange={() => {}}
          openComponents={() => {}}
        />,
      )
    expect(settings()).toContain('调整外观')
    applyLocale('en')
    const html = settings()
    expect(html).toContain('Language')
    expect(html).toContain('Disconnected')
    expect(html).toContain('value="en" lang="en" selected=""')
    expect(html).not.toContain('调整外观')
    expect(renderToStaticMarkup(<ThemePicker value="dark" onValueChange={() => {}} />)).toContain(
      'Dark theme',
    )
    expect(
      renderToStaticMarkup(
        <Pagination page={1} pageSize={10} total={123} onPageChange={() => {}} />,
      ),
    ).toContain('123 items · Page 1 / 13')
    expect(toolErrorMessage('tool_config_invalid')).toContain('Invalid configuration')
    expect(buildWorkbenchPrompt('assistant', null)).toContain('personal workbench')
    expect(
      renderToStaticMarkup(
        <KnowledgePage
          active
          coreStatus={disconnectedStatus}
          coreStatusLoaded
          openSettings={() => {}}
        />,
      ),
    ).toContain('Core is disconnected')
    expect(
      renderToStaticMarkup(
        <ToolsPage active coreReady={false} registerLeave={() => {}} openSettings={() => {}} />,
      ),
    ).toContain('Tools')
    applyLocale('zh-CN')
    expect(settings()).toContain('未连接')
    // Calendar has a real DOM portal, exercised in browser QA instead of SSR.
    expect(DateRangeCalendar).toBeTypeOf('function')
  })
  it('does not introduce untranslated Chinese interface literals outside resources', () => {
    const violations: string[] = []
    for (const root of ['src/components', 'src/lib', 'src/App.tsx']) {
      const files = root.endsWith('.tsx')
        ? [root]
        : readdirSync(root, { recursive: true })
            .map((file) => join(root, String(file)))
            .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
      for (const file of files) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        )
        function visit(node: ts.Node) {
          if (
            (ts.isStringLiteral(node) ||
              ts.isNoSubstitutionTemplateLiteral(node) ||
              ts.isJsxText(node)) &&
            /[\u3400-\u9fff]/.test(node.text)
          ) {
            const parent = node.parent
            const translated =
              ts.isCallExpression(parent) &&
              (parent.expression.getText(source) === 't' ||
                parent.expression.getText(source) === 'translateKnown')
            // The bilingual discovery label and endonym deliberately stay readable in either language.
            const endonym =
              node.text.trim() === '语言 / Language' || node.text.trim() === '简体中文'
            if (!translated && !endonym)
              violations.push(
                `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
              )
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
    expect(violations).toEqual([])
  })
})

function browserWindow() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
  }
  const win = Object.assign(new EventTarget(), { localStorage: storage })
  vi.stubGlobal('window', win)
  return { win, storage }
}
describe('language preference persistence and synchronization', () => {
  it('saves before applying; failed persistence retains the previous language', async () => {
    const { storage } = browserWindow()
    await saveLocale('en')
    expect(storage.getItem('lumi.locale')).toBe('en')
    expect(getLocale()).toBe('en')
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await expect(saveLocale('zh-CN')).rejects.toThrow('disk full')
    expect(getLocale()).toBe('en')
  })
  it('synchronizes browser windows and removes its listener on disposal', async () => {
    const { win, storage } = browserWindow()
    const dispose = await connectLocale(vi.fn())
    const send = (value: string | null) =>
      win.dispatchEvent(
        Object.assign(new Event('storage'), {
          key: 'lumi.locale',
          newValue: value,
          storageArea: storage,
        }),
      )
    send('en')
    expect(getLocale()).toBe('en')
    send(null)
    expect(getLocale()).toBe('zh-CN')
    dispose()
    send('en')
    expect(getLocale()).toBe('zh-CN')
  })
  it('does not let an older native read overwrite a newer event', async () => {
    browserWindow()
    native.enabled = true
    let event: ((event: { payload: string }) => void) | undefined
    const dispose = vi.fn()
    native.listen.mockImplementation(async (_name, callback) => {
      event = callback
      return dispose
    })
    native.invoke.mockImplementation(async () => {
      event?.({ payload: 'en' })
      return 'zh-CN'
    })
    const disconnect = await connectLocale(vi.fn())
    expect(getLocale()).toBe('en')
    disconnect()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('does not change language after native save rejection', async () => {
    native.enabled = true
    browserWindow()
    native.invoke.mockRejectedValueOnce(new Error('locale_save_failed'))
    await expect(saveLocale('en')).rejects.toThrow('locale_save_failed')
    expect(getLocale()).toBe('zh-CN')
  })
})
