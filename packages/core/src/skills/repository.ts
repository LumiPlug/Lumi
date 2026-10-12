// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { InstalledSkill, SkillInventory } from '@lumiplug/shared'
import { normalizeSkillTimestamp } from '@lumiplug/shared'
import { scanSkillRoots, skillRoots } from './scanner'
import { SkillFileError, skillDirectoryRoot, listSkillDirectory, readSkillFile } from './files'

export class SkillProjectValidationError extends Error {}

function compareSkills(a: InstalledSkill, b: InstalledSkill): number {
  const aDate = a.fileCreatedAt ?? a.firstSeenAt
  const bDate = b.fileCreatedAt ?? b.firstSeenAt
  const aTime = aDate === null ? -Infinity : Date.parse(aDate)
  const bTime = bDate === null ? -Infinity : Date.parse(bDate)
  if (aTime !== bTime) return aTime > bTime ? -1 : 1
  return a.name.localeCompare(b.name) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
}

export class SkillsRepository {
  private scanning: Promise<SkillInventory> | null = null
  public constructor(
    private readonly database: DatabaseSync,
    private readonly home?: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  public inventory(): SkillInventory {
    const row = this.database
      .prepare("SELECT value_json FROM skill_state WHERE key = 'scan'")
      .get() as { value_json: string } | undefined
    const report = row
      ? (JSON.parse(row.value_json) as Omit<SkillInventory, 'skills' | 'projects'>)
      : { locations: [], issues: [], scannedAt: null }
    const skills = (
      this.database.prepare('SELECT metadata_json, archived FROM skill_inventory').all() as {
        metadata_json: string
        archived: number
      }[]
    )
      .map((item) => {
        const skill = JSON.parse(item.metadata_json) as InstalledSkill
        return {
          ...skill,
          archived: item.archived === 1,
          firstSeenAt: normalizeSkillTimestamp(skill.firstSeenAt),
          fileCreatedAt: normalizeSkillTimestamp(skill.fileCreatedAt),
        }
      })
      .sort(compareSkills)
    const projects = (
      this.database.prepare('SELECT path FROM skill_projects ORDER BY path').all() as {
        path: string
      }[]
    ).map((item) => item.path)
    return { ...report, skills, projects }
  }

  public scan(): Promise<SkillInventory> {
    if (this.scanning) return this.scanning
    this.scanning = this.performScan().finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  private async performScan(): Promise<SkillInventory> {
    const previous = this.inventory()
    const result = await scanSkillRoots(skillRoots(previous.projects, this.home, this.environment))
    const failedRoots = new Set(
      result.locations.filter((item) => item.status === 'error').map((item) => item.path),
    )
    const skills = new Map(result.skills.map((item) => [item.id, item]))
    for (const old of previous.skills) {
      const retained = old.sources.filter((source) => failedRoots.has(source.root))
      const fresh = skills.get(old.id)
      if (fresh) {
        for (const source of retained) {
          if (
            !fresh.sources.some(
              (item) => item.client === source.client && item.path === source.path,
            )
          )
            fresh.sources.push(source)
        }
      } else {
        skills.set(old.id, {
          ...old,
          present: retained.length > 0 && old.present,
          sources: retained.length ? retained : old.sources,
        })
      }
    }
    const scannedAt = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const upsert = this.database
        .prepare(`INSERT INTO skill_inventory (id, metadata_json, archived) VALUES (?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET metadata_json = excluded.metadata_json`)
      const existing = this.database.prepare(
        'SELECT metadata_json FROM skill_inventory WHERE id = ?',
      )
      for (const skill of skills.values()) {
        // Read inside the write transaction so overlapping repository instances preserve
        // the persisted date. Existing records without dates remain historical unknowns.
        const row = existing.get(skill.id) as { metadata_json: string } | undefined
        skill.firstSeenAt = row
          ? normalizeSkillTimestamp((JSON.parse(row.metadata_json) as InstalledSkill).firstSeenAt)
          : scannedAt
        upsert.run(skill.id, JSON.stringify(skill))
      }
      this.database
        .prepare(
          "INSERT INTO skill_state (key, value_json) VALUES ('scan', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        )
        .run(
          JSON.stringify({
            locations: result.locations,
            issues: result.issues,
            scannedAt,
          }),
        )
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.inventory()
  }

  public archive(id: string, archived: boolean): SkillInventory {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid_skill')
    const changed = this.database
      .prepare('UPDATE skill_inventory SET archived = ? WHERE id = ?')
      .run(archived ? 1 : 0, id)
    if (!changed.changes) throw new Error('skill_not_found')
    return this.inventory()
  }

  private async fileRoot(id: string): Promise<{ root: string; mainFile: string }> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new SkillFileError('invalid_skill_file')
    const row = this.database
      .prepare('SELECT metadata_json FROM skill_inventory WHERE id = ?')
      .get(id) as { metadata_json: string } | undefined
    if (!row) throw new SkillFileError('skill_not_found')
    const skill = JSON.parse(row.metadata_json) as InstalledSkill
    return { root: await skillDirectoryRoot(skill.path), mainFile: path.basename(skill.path) }
  }

  public async directory(id: string) {
    const { root, mainFile } = await this.fileRoot(id)
    return listSkillDirectory(root, mainFile)
  }

  public async file(id: string, relativePath: string) {
    return readSkillFile((await this.fileRoot(id)).root, relativePath)
  }

  public async addProject(directory: string): Promise<void> {
    if (this.scanning) await this.scanning
    if (!path.isAbsolute(directory) || directory.includes('\0'))
      throw new SkillProjectValidationError('invalid_project')
    let project: string
    try {
      project = await fs.realpath(directory)
      if (!(await fs.stat(project)).isDirectory())
        throw new SkillProjectValidationError('invalid_project')
    } catch {
      throw new SkillProjectValidationError('invalid_project')
    }
    const count = this.inventory().projects.length
    if (count >= 32 && !this.inventory().projects.includes(project))
      throw new SkillProjectValidationError('project_limit')
    this.database.prepare('INSERT OR IGNORE INTO skill_projects (path) VALUES (?)').run(project)
  }
}
