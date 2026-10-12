// SPDX-License-Identifier: MPL-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resolveSkillDocumentLink, splitSkillMarkdown } from './skill-files'
import { SkillMarkdown } from '../components/SkillDetailPage'

describe('Skill document preview', () => {
  it('resolves local links while rejecting outside paths and encoded traversal', () => {
    expect(resolveSkillDocumentLink('SKILL.md', 'references/guide.md#example')).toEqual({
      path: 'references/guide.md',
      fragment: 'example',
    })
    expect(resolveSkillDocumentLink('references/guide.md', '../SKILL.md')).toEqual({
      path: 'SKILL.md',
      fragment: '',
    })
    expect(resolveSkillDocumentLink('SKILL.md', '#标题')).toEqual({
      path: 'SKILL.md',
      fragment: '标题',
    })
    for (const link of [
      '../outside.md',
      '%2e%2e/outside.md',
      '/etc/passwd',
      'file:///etc/passwd',
      'javascript:alert(1)',
      '\\outside',
      '%00',
    ])
      expect(resolveSkillDocumentLink('SKILL.md', link)).toBeNull()
  })
  it('preserves frontmatter separately without treating body separators as metadata', () => {
    expect(splitSkillMarkdown('---\r\nname: sample\r\n---\r\n# Guide')).toEqual({
      header: 'name: sample',
      body: '# Guide',
    })
    expect(splitSkillMarkdown('# Guide\n\n---')).toEqual({ header: '', body: '# Guide\n\n---' })
  })
  it('renders Markdown and GFM without raw HTML, executable links or remote image loading', () => {
    const html = renderToStaticMarkup(
      <SkillMarkdown
        current="SKILL.md"
        onLink={() => {}}
        content={
          '# Guide\n\n**Bold** and `code`\n\n| A | B |\n| - | - |\n| x | y |\n\n- [x] Done\n\n```js\nconsole.log(1)\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n![remote](https://example.com/track.png)'
        }
      />,
    )
    expect(html).toContain('<h1>Guide</h1>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('language-js')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<img')
  })
})
