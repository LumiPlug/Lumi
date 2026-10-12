// SPDX-License-Identifier: MPL-2.0
import { useId } from 'react'
import type { ReactNode } from 'react'

/** Shared full-window surface: fixed header/actions, one scrollable content body. */
export function WindowPanel({
  title,
  header,
  actions,
  children,
  className = '',
  preview = false,
  bodyLayout = 'scroll',
  nativeTitlebar = false,
}: {
  title: string
  header?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  preview?: boolean
  bodyLayout?: 'scroll' | 'fill'
  nativeTitlebar?: boolean
}) {
  const titleId = useId()
  return (
    <main
      className={`ui-window-panel${preview ? ' ui-window-panel--preview' : ''}${bodyLayout === 'fill' ? ' ui-window-panel--fill' : ''} ${className}`}
      aria-label={title}
    >
      {nativeTitlebar && (
        <div className="ui-window-titlebar" aria-hidden="true">
          <div className="ui-window-drag-region" data-tauri-drag-region />
        </div>
      )}
      {header ?? (
        <header className="ui-modal-heading">
          <h2 id={titleId}>{title}</h2>
        </header>
      )}
      <div className="ui-modal-body">{children}</div>
      {actions && <footer className="ui-modal-actions">{actions}</footer>}
    </main>
  )
}
