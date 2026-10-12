// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { knowledgeSearchExcerpt } from './knowledge-search'

describe('Knowledge search body excerpts', () => {
  it('uses the first body line when only a title matches, skipping Markdown headings', () => {
    expect(knowledgeSearchExcerpt('# 工具调用\n\n第一行正文。\n第二行正文。', '工具')).toBe(
      '第一行正文。',
    )
    expect(knowledgeSearchExcerpt('工具调用\n===\n\n第一行正文。', '工具')).toBe('第一行正文。')
  })
  it('prefers a body hit, ignores case, and preserves a keyword far into a long line', () => {
    expect(
      knowledgeSearchExcerpt(
        '# 概览\n\n一般说明。\n使用 **Core** 调用 [工具](#citation-a)。',
        'core',
      ),
    ).toBe('使用 Core 调用 工具。')
    const longLine = `${'前文'.repeat(100)}搜索关键词与后文`
    const excerpt = knowledgeSearchExcerpt(`首行正文\n${longLine}`, '搜索关键词')
    expect(excerpt).toContain('搜索关键词')
    expect(excerpt).toMatch(/^…/)
    expect(excerpt.length).toBeLessThan(50)
  })
  it('handles multi-word queries, code, blank bodies and image-only lines', () => {
    expect(knowledgeSearchExcerpt('# MCP Core\n\n默认介绍。\nCore 管理数据。', 'MCP Core')).toBe(
      'Core 管理数据。',
    )
    expect(knowledgeSearchExcerpt('# 例子\n```ts\nconst count = 1\n```', 'count')).toBe(
      'const count = 1',
    )
    expect(knowledgeSearchExcerpt('# 空正文\n\n![图片](local.png)', '空正文')).toBe('')
  })
})
