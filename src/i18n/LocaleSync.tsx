// SPDX-License-Identifier: MPL-2.0
import { useEffect } from 'react'
import { connectLocale } from './preferences'
import { t } from '.'
import { useToast } from '../components/ToastProvider'

export default function LocaleSync() {
  const showToast = useToast()
  useEffect(() => {
    let disposed = false
    let disconnect: (() => void) | undefined
    void connectLocale(() => {
      if (!disposed) showToast(t('无法同步界面语言，请重新打开窗口。'), 'error')
    })
      .then((cleanup) => {
        if (disposed) cleanup()
        else disconnect = cleanup
      })
      .catch(() => {
        if (!disposed) showToast(t('无法同步界面语言，请重新打开窗口。'), 'error')
      })
    return () => {
      disposed = true
      disconnect?.()
    }
  }, [showToast])
  return null
}
