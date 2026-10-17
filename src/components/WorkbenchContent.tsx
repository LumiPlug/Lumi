// SPDX-License-Identifier: MPL-2.0
import { Button } from './ui'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { HOME_CONTRACT } from '@lumiplug/shared'
import type { WorkbenchView } from '@lumiplug/shared'
import { workbenchRpc } from '../lib/tauri'
import { homeBridgeRequest, readHomeTheme } from '../lib/home-bridge'
import { useToast } from './ToastProvider'
import LumiLoading from './LumiLoading'

export default function WorkbenchContent({
  headingRef,
  view,
  active,
  ready,
  loadError,
  onRetry,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>
  view: WorkbenchView
  active: boolean
  ready: boolean
  loadError: boolean
  onRetry: () => void
}) {
  const [reload, setReload] = useState(0)
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'error'>('loading')
  const frame = useRef<HTMLIFrameElement>(null)
  const instance = useMemo(() => crypto.randomUUID(), [view.runtimeUrl, view.version, reload])
  const showToast = useToast()
  const current = useRef({ active, ready })
  current.current = { active, ready }
  useEffect(() => {
    setFrameState('loading')
    if (!view.runtimeUrl) {
      setFrameState('error')
      return
    }
    let disposed = false
    let connected = false
    let port: MessagePort | null = null
    const pending = new Set<number>()
    const timer = window.setTimeout(() => setFrameState('error'), 10000)
    const handle = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== 'lumi.home.ready' ||
        event.data.instance !== instance ||
        event.data.bridgeVersion !== 1 ||
        connected ||
        disposed
      )
        return
      connected = true
      const channel = new MessageChannel()
      port = channel.port1
      port.onmessage = (message) => {
        const request = homeBridgeRequest(message.data)
        if (!request || disposed || pending.has(request.id)) return
        if (pending.size >= 64) {
          port?.postMessage({
            id: request.id,
            ok: false,
            error: { code: 'too_many_requests', message: '请求过多，请稍后重试。' },
          })
          return
        }
        pending.add(request.id)
        void (async () => {
          let result
          if (!current.current.active || !current.current.ready)
            result = {
              ok: false,
              error: { code: 'home_inactive', message: '主页或服务暂不可用，请回到主页后重试。' },
            }
          else if (request.method === 'toast.show') {
            const { message: text, tone } = request.args
            if (
              typeof text !== 'string' ||
              !text.trim() ||
              text.length > 500 ||
              !['success', 'error', 'info'].includes(String(tone))
            )
              result = {
                ok: false,
                error: { code: 'invalid_toast', message: '提示内容或类型无效。' },
              }
            else {
              showToast(text, tone as 'success' | 'error' | 'info')
              result = { ok: true, data: null }
            }
          } else {
            try {
              result = await workbenchRpc({
                version: view.version,
                method: request.method,
                args: request.args,
              })
            } catch {
              result = {
                ok: false,
                error: { code: 'host_unavailable', message: 'Lumi 服务暂不可用，请重试。' },
              }
            }
          }
          pending.delete(request.id)
          if (!disposed) port?.postMessage({ id: request.id, ...result })
        })()
      }
      port.start()
      frame.current?.contentWindow?.postMessage(
        {
          type: 'lumi.home.connect',
          instance,
          info: {
            lumiVersion: HOME_CONTRACT.lumiVersion,
            sdkVersion: HOME_CONTRACT.sdkVersion,
            bridgeVersion: 1,
            projectId: view.manifest!.projectId,
            mode: 'lumi',
          },
          theme: readHomeTheme(),
        },
        '*',
        [channel.port2],
      )
      window.clearTimeout(timer)
      setFrameState('ready')
    }
    const syncTheme = () => port?.postMessage({ type: 'theme', theme: readHomeTheme() })
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    reduced.addEventListener('change', syncTheme)
    window.addEventListener('message', handle)
    return () => {
      disposed = true
      pending.clear()
      port?.close()
      observer.disconnect()
      reduced.removeEventListener('change', syncTheme)
      window.removeEventListener('message', handle)
      window.clearTimeout(timer)
    }
  }, [instance, showToast, view.runtimeUrl, view.version, view.manifest?.projectId])
  return (
    <section className="workbench-home" hidden={!active} aria-labelledby="workbench-home-title">
      <h1 id="workbench-home-title" className="sr-only" ref={headingRef} tabIndex={-1}>
        {view.manifest?.name ?? '我的工作台'}
      </h1>
      {(!ready || loadError || !view.compatible || frameState === 'error') && (
        <div className="workbench-sync-state" role="status">
          <p>
            {!ready
              ? '本地服务暂不可用，页面操作已暂停。'
              : !view.compatible
                ? '此主页的工程格式或桥接协议暂不受支持，请让 AI 按官方 HTML 工程契约迁移主页。'
                : frameState === 'error'
                  ? '主页未能连接 Lumi，请重新加载，或让 AI 通过 MCP 恢复历史版本。'
                  : '暂时无法同步主页，已有内容已保留。'}
          </p>
          {ready && view.compatible && (
            <Button
              type="button"
              className="secondary-button"
              onClick={() => {
                onRetry()
                setReload((value) => value + 1)
              }}
            >
              重新加载
            </Button>
          )}
        </div>
      )}
      {view.runtimeUrl && (
        <div className="workbench-frame-wrap" aria-busy={frameState === 'loading'}>
          {frameState === 'loading' && <LumiLoading />}
          <iframe
            key={instance}
            ref={frame}
            title={view.manifest?.name ?? 'Lumi 主页'}
            sandbox="allow-scripts"
            src={`${view.runtimeUrl}#lumi=${instance}`}
            className="workbench-frame"
            style={{ visibility: frameState === 'loading' ? 'hidden' : 'visible' }}
          />
        </div>
      )}
    </section>
  )
}
