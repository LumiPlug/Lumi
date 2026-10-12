// SPDX-License-Identifier: MPL-2.0
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from './ui'
export default function ConfirmationDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = '取消',
  busy = false,
  disabled = false,
  danger = false,
  confirm,
  cancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  disabled?: boolean
  danger?: boolean
  confirm: () => void
  cancel: () => void
}) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      title={title}
      confirmation
      busy={busy}
      onClose={cancel}
      initialFocus={cancelButton}
      actions={(close) => (
        <>
          <Button
            ref={cancelButton}
            variant={danger ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={close}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={disabled}
            loading={busy}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {children}
    </Modal>
  )
}
