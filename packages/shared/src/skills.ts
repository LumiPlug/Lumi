// SPDX-License-Identifier: MPL-2.0

/** Reject unavailable timestamps and the observed Unix-epoch placeholder (0–1000ms). */
export function normalizeSkillTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) && time > 1000 ? date.toISOString() : null
}

export interface SkillSource {
  client: string
  scope: 'personal' | 'project' | 'plugin'
  root: string
  path: string
}

export interface InstalledSkill {
  id: string
  name: string
  description: string
  path: string
  sources: SkillSource[]
  metadataValid: boolean
  present: boolean
  archived: boolean
  /** First indexed by Lumi, not file/installation time; null for historical unknown dates. */
  firstSeenAt: string | null
  /** Real SKILL.md file birth time, not guaranteed installation time; null if unavailable. */
  fileCreatedAt: string | null
}

export interface SkillScanLocation {
  client: string
  scope: SkillSource['scope']
  path: string
  status: 'scanned' | 'missing' | 'error'
}

export interface SkillScanIssue {
  path: string
  message: string
}

export interface SkillInventory {
  skills: InstalledSkill[]
  locations: SkillScanLocation[]
  issues: SkillScanIssue[]
  scannedAt: string | null
  projects: string[]
}

export interface SkillFileEntry {
  name: string
  /** Slash-separated path relative to the canonical skill directory. */
  path: string
  kind: 'directory' | 'file' | 'unavailable'
  children?: SkillFileEntry[]
  note?: string
}

export interface SkillDirectory {
  rootPath: string
  entries: SkillFileEntry[]
  truncated: boolean
}

export interface SkillFilePreview {
  path: string
  size: number
  kind: 'markdown' | 'text' | 'image' | 'unsupported' | 'too-large'
  /** UTF-8 text, or a bounded data URL for supported raster images. */
  content?: string
}
