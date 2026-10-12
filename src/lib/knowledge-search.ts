// SPDX-License-Identifier: MPL-2.0

/** Plain body lines, so title-only matches never repeat the Markdown heading. */
export function knowledgeSearchExcerpt(markdown: string, query: string): string {
  const lines = markdown.split(/\r?\n/).flatMap((line, index, all) => {
    const trimmed = line.trim()
    if (
      !trimmed ||
      /^(#{1,6}\s|`{3,}|~{3,}|[-*_]{3,}$|[=-]+$|\[.+\]:)/.test(trimmed) ||
      /^[=-]+$/.test(all[index + 1]?.trim() ?? '')
    )
      return []
    const text = trimmed
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[*`~]/g, '')
      .replace(/^\|\s*|\s*\|$/g, '')
      .replace(/\s*\|\s*/g, ' · ')
      .replace(/\s+/g, ' ')
      .trim()
    return text ? [text] : []
  })
  const keywords =
    query
      .trim()
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) ?? []
  const match = lines.find((line) =>
    keywords.some((word) => line.toLocaleLowerCase().includes(word)),
  )
  const line = match ?? lines[0] ?? ''
  if (!match) return line
  const index = Math.min(
    ...keywords.map((word) => line.toLocaleLowerCase().indexOf(word)).filter((at) => at >= 0),
  )
  const start = Math.max(0, index - 20)
  return `${start ? '…' : ''}${line.slice(start)}`
}
