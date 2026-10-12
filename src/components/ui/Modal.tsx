// SPDX-License-Identifier: MPL-2.0
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useToastViewport } from '../ToastProvider'
import { IconButton } from './controls'
import { useSurfaceDepth } from './SurfaceEffects'

export function Modal({
  title,
  children,
  actions,
  onClose,
  returnFocus,
  initialFocus,
  busy = false,
  confirmation = false,
  className = '',
  bodyClassName = '',
  header,
  titleId: suppliedTitleId,
  initialFocusSelector,
  dismissOnBackdrop = false,
  requestClose,
}: {
  title: string
  children: ReactNode | ((close: () => void) => ReactNode)
  actions?: ReactNode | ((close: () => void) => ReactNode)
  onClose: () => void
  returnFocus?: HTMLElement | null
  initialFocus?: RefObject<HTMLElement | null>
  busy?: boolean
  confirmation?: boolean
  className?: string
  bodyClassName?: string
  header?:
    ReactNode | ((context: { close: () => void; titleId: string; busy: boolean }) => ReactNode)
  titleId?: string
  initialFocusSelector?: string
  dismissOnBackdrop?: boolean
  requestClose?: () => void
}) {
  const depth = useSurfaceDepth()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const origin = useRef(returnFocus)
  const generatedTitleId = useId()
  const titleId = suppliedTitleId ?? generatedTitleId
  const descriptionId = useId()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closing = useRef(false)
  const [exiting, setExiting] = useState(false)
  useToastViewport(dialog)
  useLayoutEffect(() => {
    const previous = origin.current ?? document.activeElement
    const modal = dialog.current
    modal?.showModal()
    ;(
      initialFocus?.current ??
      (initialFocusSelector ? modal?.querySelector<HTMLElement>(initialFocusSelector) : null) ??
      heading.current ??
      modal?.querySelector<HTMLElement>('[data-modal-title]')
    )?.focus({ preventScroll: true })
    return () => {
      clearTimeout(timer.current)
      modal?.close()
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true })
    }
  }, [initialFocus, initialFocusSelector])
  function close() {
    if (busy || closing.current) return
    // A guarded editor must remain interactive when the user chooses to keep editing.
    if (requestClose) {
      requestClose()
      return
    }
    closing.current = true
    setExiting(true)
    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : parseFloat(getComputedStyle(dialog.current!).getPropertyValue('--lumi-motion-exit'))
    timer.current = setTimeout(onClose, Number.isFinite(delay) ? delay : 120)
  }
  return createPortal(
    <dialog
      ref={dialog}
      className={`ui-modal${confirmation ? ' ui-modal--confirmation' : ''} ${className}`}
      data-exiting={exiting || undefined}
      data-ui-depth={depth}
      role={confirmation ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={confirmation ? descriptionId : undefined}
      aria-busy={busy || undefined}
      onClickCapture={(event) => {
        if (closing.current) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onSubmitCapture={(event) => {
        if (closing.current) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (!dismissOnBackdrop || event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close()
      }}
    >
      {header === undefined ? (
        <header className="ui-modal-heading">
          <h2 ref={heading} id={titleId} tabIndex={-1}>
            {title}
          </h2>
          {!confirmation && (
            <IconButton label="关闭预览" disabled={busy || exiting} onClick={close}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </IconButton>
          )}
        </header>
      ) : typeof header === 'function' ? (
        header({ close, titleId, busy: busy || exiting })
      ) : (
        header
      )}
      <div
        inert={exiting}
        className={`ui-modal-body ${bodyClassName}`}
        id={confirmation ? descriptionId : undefined}
      >
        {typeof children === 'function' ? children(close) : children}
      </div>
      {actions && (
        <footer inert={exiting} className="ui-modal-actions">
          {typeof actions === 'function' ? actions(close) : actions}
        </footer>
      )}
    </dialog>,
    document.body,
  )
}
