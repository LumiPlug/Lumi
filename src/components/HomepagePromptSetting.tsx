// SPDX-License-Identifier: MPL-2.0
import { Select, Button, Textarea } from './ui'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { buildWorkbenchPrompt } from '../lib/mcp'
import {
  readSavedWorkbenchSetup,
  selectWorkbenchTemplate,
  workbenchTemplates,
} from '../lib/workbench'
import type { WorkbenchTemplate } from '../lib/workbench'
import SettingsPreviewDialog from './SettingsPreviewDialog'
import { useToast } from './ToastProvider'

export default function HomepagePromptSetting() {
  const [template, setTemplate] = useState<WorkbenchTemplate>(
    () => readSavedWorkbenchSetup().selected ?? 'assistant',
  )
  const [preview, setPreview] = useState<WorkbenchTemplate | null>(null)
  const [copying, setCopying] = useState(false)
  const [fallback, setFallback] = useState(0)
  const copyingRef = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const showToast = useToast()

  useEffect(() => {
    if (preview && fallback) {
      field.current?.focus()
      field.current?.select()
    }
  }, [preview, fallback])

  async function copy(selected: WorkbenchTemplate) {
    if (copyingRef.current) return
    copyingRef.current = true
    setCopying(true)
    try {
      const copied = await copyText(buildWorkbenchPrompt(selected, null))
      showToast(
        copied ? '已复制首页搭建提示词' : '未能自动复制，请选中提示词手动复制。',
        copied ? 'success' : 'error',
      )
      if (!copied) {
        setPreview(selected)
        setFallback((current) => current + 1)
      }
    } finally {
      copyingRef.current = false
      setCopying(false)
    }
  }

  return (
    <section className="settings-row" aria-labelledby="homepage-prompt-title">
      <h2 id="homepage-prompt-title">首页搭建提示词</h2>
      <div className="settings-row-controls">
        <Select
          aria-label="首页搭建模板"
          value={template}
          disabled={copying}
          onChange={(event) => {
            const selected = event.target.value as WorkbenchTemplate
            setTemplate(selected)
            selectWorkbenchTemplate(selected)
          }}
        >
          {workbenchTemplates.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button
          variant="primary"
          type="button"
          className="settings-button"
          loading={copying}
          loadingLabel="复制中…"
          onClick={(event) => {
            trigger.current = event.currentTarget
            setFallback(0)
            selectWorkbenchTemplate(template)
            setPreview(template)
            void copy(template)
          }}
        >
          复制提示词
        </Button>
      </div>
      {preview && (
        <SettingsPreviewDialog
          title={`首页搭建提示词 · ${workbenchTemplates.find((option) => option.id === preview)?.label}`}
          returnFocus={trigger.current}
          close={() => setPreview(null)}
          actions={
            <Button
              variant="primary"
              type="button"
              className="settings-button"
              loading={copying}
              loadingLabel="复制中…"
              onClick={() => void copy(preview)}
            >
              再次复制
            </Button>
          }
        >
          <Textarea
            ref={field}
            className="settings-code-preview settings-prompt-preview"
            aria-label="首页搭建提示词正文"
            value={buildWorkbenchPrompt(preview, null)}
            readOnly
            spellCheck={false}
            rows={14}
          />
        </SettingsPreviewDialog>
      )}
    </section>
  )
}
