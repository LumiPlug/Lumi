// SPDX-License-Identifier: MPL-2.0

/** Resolve document links inside a skill without allowing traversal outside its root. */
export function resolveSkillDocumentLink(
  current: string,
  href: string,
): { path: string; fragment: string } | null {
  try {
    const hash = href.indexOf('#')
    const target = (hash < 0 ? href : href.slice(0, hash)).split('?')[0] ?? ''
    const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1))
    if (!target) return { path: current, fragment }
    const decoded = decodeURIComponent(target)
    if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('/') || /[\\\0]/.test(decoded))
      return null
    const parts = current.split('/').slice(0, -1)
    for (const part of decoded.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!parts.length) return null
        parts.pop()
      } else parts.push(part)
    }
    return parts.length ? { path: parts.join('/'), fragment } : null
  } catch {
    return null
  }
}

export function splitSkillMarkdown(content: string): { header: string; body: string } {
  const match = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(content)
  return match
    ? { header: match[1] ?? '', body: content.slice(match[0].length) }
    : { header: '', body: content }
}

export function skillFileFailure(error: unknown): string {
  const code = error instanceof Error ? error.message : error
  if (code === 'invalid_skill_file') return '此文件无法预览，请选择技能目录中的普通文件'
  if (code === 'skill_source_changed') return '技能源目录已变化，请关闭详情并重新扫描'
  if (code === 'skill_not_found') return '技能记录已失效，请重新扫描'
  return '无法读取技能文件，请检查文件及目录权限后重试'
}
