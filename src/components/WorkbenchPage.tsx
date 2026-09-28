// SPDX-License-Identifier: MPL-2.0

import { useRef, useState } from 'react'
import type { McpConnectionInfo } from '@lumiplug/shared'
import { copyText } from '../lib/clipboard'
import { buildWorkbenchPrompt, type PromptType } from '../lib/mcp'
import './workbench.css'

const storageKey = 'lumi.workbench.prompt-types'
const promptTypes: { id: PromptType; label: string }[] = [
  { id: 'connection', label: '仅连接' },
  { id: 'assistant', label: '工作助手' },
  { id: 'features', label: '功能入口' },
]

type Setup = { selected: PromptType }

function readSetup(): Setup {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<Setup> | null
    const selected = value?.selected
    return {
      selected:
        selected === 'connection' || selected === 'assistant' || selected === 'features'
          ? selected
          : 'connection',
    }
  } catch {
    return { selected: 'connection' }
  }
}

function persistSetup(setup: Setup): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(setup))
    return true
  } catch {
    return false
  }
}

export default function WorkbenchPage({
  connection = null,
}: {
  connection?: McpConnectionInfo | null
}) {
  const [setup, setSetup] = useState<Setup>(readSetup)
  const [copying, setCopying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const promptField = useRef<HTMLTextAreaElement>(null)
  const prompt = buildWorkbenchPrompt(setup.selected, connection)

  function updateSetup(next: Setup) {
    setSetup(next)
    setNotice(persistSetup(next) ? null : '未能保存到本机，本次仍可继续使用。')
  }

  async function handleCopy() {
    setCopying(true)
    try {
      const copied = await copyText(prompt.trim())
      setNotice(copied ? '已复制' : '未能自动复制，请选中提示词手动复制。')
      if (!copied) {
        promptField.current?.focus()
        promptField.current?.select()
      }
    } finally {
      setCopying(false)
    }
  }

  return (
    <section className="workbench-start" aria-labelledby="workbench-title">
      <h1 id="workbench-title">你的工作台，由你来设计</h1>
      <section className="workbench-prompt" aria-labelledby="workbench-prompt-title">
        <h2 id="workbench-prompt-title">复制系统提示词开始</h2>
        <div className="workbench-prompt-types" role="group" aria-label="提示词类型">
          {promptTypes.map((type) => (
            <button
              type="button"
              key={type.id}
              aria-pressed={setup.selected === type.id}
              onClick={() => updateSetup({ ...setup, selected: type.id })}
            >
              {type.label}
            </button>
          ))}
        </div>
        <textarea
          id="workbench-system-prompt"
          ref={promptField}
          aria-label="系统提示词"
          value={prompt}
          readOnly
          rows={10}
          maxLength={10000}
        />
        <div className="workbench-prompt-actions">
          <button
            type="button"
            className="primary-button"
            disabled={copying || !prompt.trim()}
            onClick={() => void handleCopy()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M16 8V4H4v12h4" />
            </svg>
            {copying ? '复制中…' : '复制系统提示词'}
          </button>
          <span className="workbench-copy-note" role="status" aria-live="polite">
            {notice}
          </span>
        </div>
      </section>
    </section>
  )
}
