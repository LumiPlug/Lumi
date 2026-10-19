// SPDX-License-Identifier: MPL-2.0
import { t, useLocale } from '../i18n'
import { useState, type Ref } from 'react'
import { Button, Field, Input, InputHint } from './ui'
import { hostInvoke } from '../lib/tauri'
import { useToast } from './ToastProvider'

/** Shared business composition; directory selection and styling stay identical. */
export function TerminalWorkingDirectory({
  value,
  change,
  disabled = false,
  readOnly = false,
  error,
  inputRef,
  onPickingChange,
  inlineDescription = false,
  inputHint = false,
}: {
  value: string
  change: (value: string) => void
  disabled?: boolean
  readOnly?: boolean
  error?: string
  inputRef?: Ref<HTMLInputElement>
  onPickingChange?: (picking: boolean) => void
  inlineDescription?: boolean
  inputHint?: boolean
}) {
  useLocale()

  const [picking, setPicking] = useState(false)
  const showToast = useToast()
  async function pick() {
    setPicking(true)
    onPickingChange?.(true)
    try {
      const path = await hostInvoke<string | null>('choose_tool_directory')
      if (path) change(path)
    } catch {
      showToast(t('无法打开文件夹选择器，请手动输入目录。'), 'error')
    } finally {
      setPicking(false)
      onPickingChange?.(false)
    }
  }
  const input = (
    <Input
      ref={inputRef}
      revealEnd
      name="runner.cwd"
      data-validation="runner.settings.cwd"
      value={value}
      readOnly={readOnly}
      disabled={disabled || picking}
      placeholder={t('留空使用用户主目录')}
      onChange={(event) => change(event.target.value)}
    />
  )
  return (
    <Field
      label={t('工作目录')}
      optional
      inline
      controlWidth="wide"
      className="tool-field"
      hint={
        inlineDescription || inputHint
          ? undefined
          : t('可手动输入或选择文件夹，留空使用用户主目录。')
      }
      description={
        inlineDescription && !inputHint
          ? t('可手动输入或选择文件夹，留空使用用户主目录。')
          : undefined
      }
      error={error}
      action={
        !readOnly && (
          <Button
            disabled={disabled || picking}
            loading={picking}
            loadingLabel={t('选择中…')}
            onClick={() => void pick()}
          >
            {t('选择文件夹')}
          </Button>
        )
      }
    >
      {inputHint ? (
        <InputHint label={t('工作目录')} hint={t('可手动输入或选择文件夹，留空使用用户主目录。')}>
          {input}
        </InputHint>
      ) : (
        input
      )}
    </Field>
  )
}
