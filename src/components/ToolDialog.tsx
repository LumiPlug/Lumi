// SPDX-License-Identifier: MPL-2.0
import type { ReactNode } from 'react'
import { Modal } from './ui'

export default function ToolDialog({
  children,
  close,
  busy = false,
  compact = false,
}: {
  children: ReactNode
  close: () => void
  busy?: boolean
  compact?: boolean
}) {
  return (
    <Modal
      title="工具"
      titleId="tool-dialog-title"
      header={null}
      initialFocusSelector="#tool-dialog-title"
      className={`tools-dialog tools-page${compact ? ' tools-dialog--compact' : ''}`}
      bodyClassName="ui-modal-body--composed"
      busy={busy}
      onClose={close}
      requestClose={close}
    >
      {children}
    </Modal>
  )
}
