// SPDX-License-Identifier: MPL-2.0
import { t, useLocale, translateKnown } from '../i18n'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { SurfaceButton } from './ui/controls'
import './toast.css'

type ToastTone = 'success' | 'error' | 'info'
type Toast = { id: number; message: string; tone: ToastTone; closing: boolean }
type ShowToast = (message: string, tone?: ToastTone) => void

const ToastContext = createContext<ShowToast | null>(null)
const ToastViewportContext = createContext<((host: HTMLElement) => () => void) | null>(null)

// Keep the shared window-top feedback visible in a native dialog's top layer.
export function useToastViewport(host: RefObject<HTMLElement | null>): void {
  const registerViewport = useContext(ToastViewportContext)
  if (!registerViewport) throw new Error('useToastViewport must be used within ToastProvider')
  useEffect(() => {
    if (host.current) return registerViewport(host.current)
  }, [host, registerViewport])
}

export function useToast(): ShowToast {
  const showToast = useContext(ToastContext)
  if (!showToast) throw new Error('useToast must be used within ToastProvider')
  return showToast
}

export default function ToastProvider({ children }: { children: ReactNode }) {
  useLocale()

  const [viewports, setViewports] = useState<HTMLElement[]>([])
  const registerViewport = useCallback((host: HTMLElement) => {
    setViewports((current) => [...current.filter((item) => item !== host), host])
    return () => setViewports((current) => current.filter((item) => item !== host))
  }, [])
  const viewport = viewports.at(-1)
  const [toast, setToast] = useState<Toast | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const sequence = useRef(0)
  const region = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  const showToast = useCallback<ShowToast>((message, tone = 'info') => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && !region.current?.contains(activeElement)) {
      returnFocus.current = activeElement
    }
    setHovered(false)
    setFocused(false)
    setToast({ id: ++sequence.current, message, tone, closing: false })
  }, [])

  useEffect(() => {
    if (!toast) return
    if (toast.closing) {
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--lumi-motion-exit'),
          ) || 120
      const timer = window.setTimeout(() => {
        if (region.current?.contains(document.activeElement) && returnFocus.current?.isConnected) {
          returnFocus.current.focus({ preventScroll: true })
        }
        setToast((current) => (current?.id === toast.id ? null : current))
      }, duration)
      return () => window.clearTimeout(timer)
    }
    if (hovered || focused) return
    const timer = window.setTimeout(
      () => {
        setToast((current) => (current?.id === toast.id ? { ...current, closing: true } : current))
      },
      toast.tone === 'error' ? 8_000 : 4_000,
    )
    return () => window.clearTimeout(timer)
  }, [toast, hovered, focused])

  return (
    <ToastContext.Provider value={showToast}>
      <ToastViewportContext.Provider value={registerViewport}>
        {children}
        {createPortal(
          <div
            className="toast-region"
            ref={region}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {toast && (
              <div
                className={'toast-bubble toast-' + toast.tone}
                key={toast.id}
                data-closing={toast.closing || undefined}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onFocus={() => setFocused(true)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
                }}
              >
                <svg
                  className="toast-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  {toast.tone === 'success' ? (
                    <path d="m8 12 3 3 5-6" />
                  ) : (
                    <path d="M12 8v5m0 3h.01" />
                  )}
                </svg>
                <span className="toast-message">{translateKnown(toast.message)}</span>
                <SurfaceButton
                  type="button"
                  className="toast-close"
                  aria-label={t('关闭提示')}
                  onClick={() => {
                    setToast((current) =>
                      current?.id === toast.id ? { ...current, closing: true } : current,
                    )
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="m6 6 12 12M6 18 18 6" />
                  </svg>
                </SurfaceButton>
              </div>
            )}
          </div>,
          viewport ?? document.body,
        )}
      </ToastViewportContext.Provider>
    </ToastContext.Provider>
  )
}
