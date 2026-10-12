// SPDX-License-Identifier: MPL-2.0
import type { ReactNode } from 'react'
import { Modal } from './ui'
export default function SettingsPreviewDialog({
  title,
  children,
  actions,
  returnFocus,
  close,
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  returnFocus: HTMLElement | null
  close: () => void
}) {
  return (
    <Modal title={title} actions={actions} returnFocus={returnFocus} onClose={close}>
      {children}
    </Modal>
  )
}
