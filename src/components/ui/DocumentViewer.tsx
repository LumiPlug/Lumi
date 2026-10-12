// SPDX-License-Identifier: MPL-2.0
import Markdown from 'react-markdown'
import { useState } from 'react'
import type { Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import { FileSearch } from 'lucide-react'
import { Button } from './controls'

function omitRepeatedTitle({ title }: { title: string }) {
  return (tree: Root) => {
    const first = tree.children[0]
    const plainText = (node: RootContent): string =>
      'value' in node
        ? node.value
        : 'children' in node
          ? node.children.map((child) => plainText(child as RootContent)).join('')
          : ''
    if (first?.type === 'heading' && plainText(first).trim() === title.trim()) tree.children.shift()
  }
}

export function DocumentViewer({
  title,
  markdown,
  citationIds = [],
  onCitation,
}: {
  title: string
  markdown: string
  citationIds?: string[]
  onCitation?: (id: string) => void
}) {
  return (
    <article className="ui-document">
      <h2 className="ui-document-title" tabIndex={-1}>
        {title}
      </h2>
      <div className="ui-reading-content">
        <Markdown
          skipHtml
          remarkPlugins={[remarkGfm, [omitRepeatedTitle, { title }]]}
          components={{
            a: ({ href, children }) => {
              const citationId = href?.startsWith('#citation-') ? href.slice(10) : null
              if (citationId && citationIds.includes(citationId) && onCitation)
                return (
                  <Button variant="text" onClick={() => onCitation(citationId)}>
                    {children}
                  </Button>
                )
              return <span title={href}>{children}</span>
            },
            img: ({ alt }) => <span className="ui-document-image-label">{alt || '图片'}</span>,
            table: ({ children }) => (
              <div className="ui-document-table">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {markdown}
        </Markdown>
      </div>
      {citationIds.length > 0 && (
        <footer className="ui-document-citations">
          <h3>来源证据</h3>
          <div>
            {citationIds.map((id, index) => (
              <Button
                key={id}
                variant="ghost"
                icon={<FileSearch size={16} />}
                onClick={() => onCitation?.(id)}
              >
                来源 {index + 1}
              </Button>
            ))}
          </div>
        </footer>
      )}
    </article>
  )
}
export function SourceViewer({
  text,
  startLine,
  endLine,
}: {
  text: string
  startLine: number
  endLine: number
}) {
  const lines = text.split('\n')
  const [offset, setOffset] = useState(Math.max(0, startLine - 51))
  return (
    <div>
      <div className="ui-source-toolbar">
        <span>
          第 {offset + 1}–{Math.min(lines.length, offset + 300)} 行 / 共 {lines.length} 行
        </span>
        <Button
          variant="ghost"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 300))}
        >
          上一段
        </Button>
        <Button
          variant="ghost"
          disabled={offset + 300 >= lines.length}
          onClick={() => setOffset(offset + 300)}
        >
          下一段
        </Button>
      </div>
      <pre className="ui-source" aria-label={`来源快照，第 ${startLine} 至 ${endLine} 行`}>
        <code>
          {lines.slice(offset, offset + 300).map((line, index) => (
            <span
              key={offset + index}
              className="ui-source-line"
              data-highlight={
                (offset + index + 1 >= startLine && offset + index + 1 <= endLine) || undefined
              }
            >
              <span aria-hidden="true" className="ui-source-number">
                {offset + index + 1}
              </span>
              <span>{line || ' '}</span>
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
