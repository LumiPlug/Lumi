// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoreDatabase } from '../db/database'
import { scanSkillRoots, skillMetadata, skillRoots } from './scanner'
import { SkillsRepository } from './repository'
import * as scanner from './scanner'

const temporary: string[] = []
async function tempHome() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-skills-test-'))
  temporary.push(directory)
  return directory
}
async function writeSkill(directory: string, name = 'shared-skill') {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: >-\n  A repeatable workflow\n  with multiple lines.\n---\nDo not execute this body.\n`,
  )
}
function mockFileBirthtimes(times: Record<string, number>) {
  const originalOpen = fs.open
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args)
    const time = times[path.basename(path.dirname(String(args[0])))]
    if (time !== undefined) {
      const stat = await handle.stat()
      stat.birthtimeMs = time
      vi.spyOn(handle, 'stat').mockResolvedValue(stat)
    }
    return handle
  })
}
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('Skills discovery', () => {
  it('parses YAML scalars and rejects broken metadata without interpreting the body', () => {
    expect(
      skillMetadata(
        '---\nname: "quoted"\ndescription: |\n  one\n  two\nmetadata:\n  version: 1\n---\nname: malicious-body',
        'fallback',
      ),
    ).toEqual({ name: 'quoted', description: 'one\ntwo', metadataValid: true })
    expect(skillMetadata('---\nname: [bad\n---\n', 'fallback')).toEqual({
      name: 'fallback',
      description: '',
      metadataValid: false,
    })
    expect(skillMetadata('plain markdown', 'folder')).toEqual({
      name: 'folder',
      description: '',
      metadataValid: false,
    })
    expect(
      skillMetadata('---\nname: a\nname: b\ndescription: c\n---\n', 'folder').metadataValid,
    ).toBe(false)
  })

  it('discovers nested plugin skills, preserves namesakes and merges symbolic aliases', async () => {
    const home = await tempHome()
    const shared = path.join(home, '.agents/skills/shared')
    await writeSkill(shared)
    await writeSkill(path.join(shared, 'skills/child'), 'nested-child')
    await writeSkill(path.join(home, '.claude/skills/namesake'))
    await writeSkill(
      path.join(home, '.codex/plugins/cache/publisher/plugin/1/skills/design'),
      'design',
    )
    await fs.mkdir(path.join(home, '.qoder/skills'), { recursive: true })
    await fs.symlink(shared, path.join(home, '.qoder/skills/shared'), 'junction')
    await fs.symlink(home, path.join(home, '.qoder/skills/loop'), 'junction')
    const result = await scanSkillRoots(skillRoots([], home, {}))
    expect(result.skills.filter((skill) => skill.name === 'shared-skill')).toHaveLength(2)
    const realFile = await fs.realpath(path.join(shared, 'SKILL.md'))
    const linked = result.skills.find((skill) => skill.path === realFile)!
    expect(linked.sources.map((source) => source.client)).toEqual(
      expect.arrayContaining(['Codex', 'Gemini CLI', 'Qoder']),
    )
    const birthtime = (await fs.stat(realFile)).birthtimeMs
    expect(linked.fileCreatedAt).toBe(birthtime > 0 ? new Date(birthtime).toISOString() : null)
    expect(result.skills.some((skill) => skill.name === 'nested-child')).toBe(true)
    expect(result.skills.find((skill) => skill.name === 'design')?.sources[0]?.scope).toBe('plugin')
    expect(
      result.skills.every(
        (skill) => skill.description === 'A repeatable workflow with multiple lines.',
      ),
    ).toBe(true)
  })

  it('reports oversized files and broken links while continuing with other skills', async () => {
    const home = await tempHome()
    const root = path.join(home, '.claude/skills')
    await writeSkill(path.join(root, 'good'))
    await writeSkill(path.join(root, 'too-large'))
    await fs.writeFile(path.join(root, 'too-large/SKILL.md'), 'x'.repeat(256 * 1024 + 1))
    await fs.symlink(path.join(home, 'absent'), path.join(root, 'broken'), 'junction')
    const result = await scanSkillRoots([{ client: 'Claude Code', scope: 'personal', path: root }])
    expect(result.skills).toHaveLength(1)
    expect(result.locations[0]?.status).toBe('error')
    expect(result.issues).toHaveLength(2)
  })

  it('honors custom client homes and keeps project scans in standard subdirectories', () => {
    const project = path.resolve('/project')
    const codex = path.resolve('/custom-codex')
    const claude = path.resolve('/custom-claude')
    const roots = skillRoots([project], path.resolve('/user'), {
      CODEX_HOME: codex,
      CLAUDE_CONFIG_DIR: claude,
    })
    expect(roots.some((root) => root.path === path.join(codex, 'skills'))).toBe(true)
    expect(roots.some((root) => root.path === path.join(claude, 'skills'))).toBe(true)
    expect(
      roots
        .filter((root) => root.scope === 'project')
        .every((root) => path.relative(project, root.path).split(path.sep)[0]?.startsWith('.')),
    ).toBe(true)
  })
})

describe('Skills inventory persistence', () => {
  it('sorts a single discovery batch by file creation dates, ignoring discovery and modification times', async () => {
    const home = await tempHome()
    mockFileBirthtimes({
      a: Date.parse('2026-10-01T00:00:00Z'),
      z: Date.parse('2026-10-08T00:00:00Z'),
    })
    await writeSkill(path.join(home, '.codex/skills/a'), 'A older')
    await writeSkill(path.join(home, '.codex/skills/z'), 'Z newer')
    await fs.utimes(path.join(home, '.codex/skills/a/SKILL.md'), new Date(), new Date('2030-01-01'))
    const database = new CoreDatabase(':memory:')
    const repository = new SkillsRepository(database.raw, home, {})
    try {
      const inventory = await repository.scan()
      expect(inventory.skills.map((skill) => skill.name)).toEqual(['Z newer', 'A older'])
      expect(inventory.skills[0]?.firstSeenAt).toBe(inventory.skills[1]?.firstSeenAt)
      expect(repository.inventory().skills).toEqual(inventory.skills)
    } finally {
      database.close()
    }
  })

  it('falls back to persisted discovery dates for unsupported birthtimes and keeps unknown dates last', async () => {
    const home = await tempHome()
    mockFileBirthtimes({
      zero: 0,
      negative: -1,
      nan: NaN,
      infinite: Infinity,
      epoch: 1000,
      valid: Date.parse('2026-10-08T00:00:00Z'),
    })
    for (const name of ['zero', 'negative', 'nan', 'infinite', 'epoch', 'valid'])
      await writeSkill(path.join(home, '.codex/skills', name), name)
    const scanned = await scanSkillRoots(skillRoots([], home, {}))
    expect(scanned.issues).toEqual([])
    expect(
      scanned.skills
        .filter((skill) => skill.name !== 'valid')
        .every((skill) => skill.fileCreatedAt === null),
    ).toBe(true)
    const database = new CoreDatabase(':memory:')
    const repository = new SkillsRepository(database.raw, home, {})
    try {
      for (const skill of scanned.skills) {
        const metadata = {
          ...skill,
          firstSeenAt:
            skill.name === 'zero'
              ? '2026-10-09T00:00:00Z'
              : skill.name === 'epoch'
                ? '2026-10-10T00:00:00Z'
                : null,
          // Old caches must be corrected on read, without waiting for a scan.
          fileCreatedAt:
            skill.name === 'nan'
              ? 'invalid'
              : skill.name === 'epoch'
                ? '1970-01-01T00:00:01Z'
                : skill.fileCreatedAt,
        }
        database.raw
          .prepare('INSERT INTO skill_inventory (id, metadata_json, archived) VALUES (?, ?, 0)')
          .run(skill.id, JSON.stringify(metadata))
      }
      expect(repository.inventory().skills.map((skill) => skill.name)).toEqual([
        'epoch',
        'zero',
        'valid',
        'infinite',
        'nan',
        'negative',
      ])
      const next = await repository.scan()
      expect(next.skills.map((skill) => skill.name)).toEqual([
        'epoch',
        'zero',
        'valid',
        'infinite',
        'nan',
        'negative',
      ])
      expect(next.skills.find((skill) => skill.name === 'nan')).toMatchObject({
        firstSeenAt: null,
        fileCreatedAt: null,
      })
    } finally {
      database.close()
    }
  })

  it('orders by file creation time and updates recreated files while preserving first-discovery dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T01:00:00Z'))
    const home = await tempHome()
    const oldDirectory = path.join(home, '.codex/skills/old')
    const birthtimes = {
      old: Date.parse('2026-10-07T01:00:00Z'),
      new: Date.parse('2026-10-08T01:00:00Z'),
    }
    mockFileBirthtimes(birthtimes)
    await writeSkill(oldDirectory, 'A old')
    const filename = path.join(home, 'inventory.sqlite')
    let database = new CoreDatabase(filename)
    let repository = new SkillsRepository(database.raw, home, {})
    try {
      const old = (await repository.scan()).skills[0]!
      expect(old.firstSeenAt).toBe('2026-10-09T01:00:00.000Z')
      expect(old.fileCreatedAt).toBe('2026-10-07T01:00:00.000Z')
      vi.setSystemTime(new Date('2026-10-10T01:00:00Z'))
      await writeSkill(path.join(home, '.agents/skills/new'), 'Z new')
      await writeSkill(oldDirectory, 'A edited')
      // A modified file timestamp must not affect creation-time order.
      await fs.utimes(
        path.join(oldDirectory, 'SKILL.md'),
        new Date('2030-01-01'),
        new Date('2030-01-01'),
      )
      const scan = repository.scan()
      expect(repository.scan()).toBe(scan)
      const next = await scan
      expect(next.skills.map((item) => item.name)).toEqual(['Z new', 'A edited'])
      expect(next.skills[0]?.firstSeenAt).toBe('2026-10-10T01:00:00.000Z')
      expect(next.skills[0]?.sources.map((source) => source.client)).toEqual([
        'Codex',
        'Gemini CLI',
      ])
      expect(next.skills[1]?.firstSeenAt).toBe(old.firstSeenAt)
      expect(next.skills[1]?.fileCreatedAt).toBe(old.fileCreatedAt)
      repository.archive(old.id, true)
      await fs.rm(oldDirectory, { recursive: true })
      expect((await repository.scan()).skills[1]).toMatchObject({
        firstSeenAt: old.firstSeenAt,
        fileCreatedAt: old.fileCreatedAt,
        present: false,
        archived: true,
      })
      database.close()
      database = new CoreDatabase(filename)
      repository = new SkillsRepository(database.raw, home, {})
      vi.setSystemTime(new Date('2026-10-11T01:00:00Z'))
      birthtimes.old = Date.parse('2026-10-11T00:00:00Z')
      await writeSkill(oldDirectory, 'A restored')
      repository.archive(old.id, false)
      expect((await repository.scan()).skills.map((item) => [item.name, item.firstSeenAt])).toEqual(
        [
          ['A restored', old.firstSeenAt],
          ['Z new', '2026-10-10T01:00:00.000Z'],
        ],
      )
      expect(repository.inventory().skills[0]?.fileCreatedAt).toBe('2026-10-11T00:00:00.000Z')
    } finally {
      database.close()
    }
  })

  it('preserves an earlier persisted date when a slower repository scan started from an empty inventory', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T01:00:00Z'))
    const home = await tempHome()
    await writeSkill(path.join(home, '.codex/skills/sample'))
    const database = new CoreDatabase(':memory:')
    const slow = new SkillsRepository(database.raw, home, {})
    const fast = new SkillsRepository(database.raw, home, {})
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const originalScan = scanSkillRoots
    vi.spyOn(scanner, 'scanSkillRoots').mockImplementationOnce(async (roots) => {
      await blocked
      return originalScan(roots)
    })
    try {
      const pending = slow.scan()
      const first = (await fast.scan()).skills[0]!
      vi.setSystemTime(new Date('2026-10-10T01:00:00Z'))
      release()
      expect((await pending).skills[0]?.firstSeenAt).toBe(first.firstSeenAt)
      expect(slow.inventory().skills).toEqual(fast.inventory().skills)
    } finally {
      release()
      database.close()
    }
  })

  it('backfills historical creation dates and uses stable name/path order for timestamp ties', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T01:00:00Z'))
    const home = await tempHome()
    mockFileBirthtimes({
      legacy: Date.parse('2026-10-07T01:00:00Z'),
      a: Date.parse('2026-10-08T01:00:00Z'),
      b: Date.parse('2026-10-08T01:00:00Z'),
      c: Date.parse('2026-10-08T01:00:00Z'),
    })
    await writeSkill(path.join(home, '.codex/skills/legacy'), 'A legacy')
    const legacy = (await scanSkillRoots(skillRoots([], home, {}))).skills[0]!
    const metadata: Partial<typeof legacy> = { ...legacy }
    delete metadata.firstSeenAt // Existing on-disk records predate the new field.
    delete metadata.fileCreatedAt
    const filename = path.join(home, 'inventory.sqlite')
    let database = new CoreDatabase(filename)
    let repository = new SkillsRepository(database.raw, home, {})
    try {
      database.raw
        .prepare('INSERT INTO skill_inventory (id, metadata_json, archived) VALUES (?, ?, 1)')
        .run(legacy.id, JSON.stringify(metadata))
      expect(repository.inventory().skills[0]).toMatchObject({
        firstSeenAt: null,
        fileCreatedAt: null,
        archived: true,
      })
      for (const directory of ['b', 'a'])
        await writeSkill(path.join(home, '.codex/skills', directory), 'Z namesake')
      await writeSkill(path.join(home, '.codex/skills/c'), 'B same-time')
      const initial = await repository.scan()
      expect(initial.skills.map((item) => item.name)).toEqual([
        'B same-time',
        'Z namesake',
        'Z namesake',
        'A legacy',
      ])
      expect(initial.skills[1]!.path.localeCompare(initial.skills[2]!.path)).toBeLessThan(0)
      expect(new Set(initial.skills.map((item) => item.id)).size).toBe(4)
      expect(
        initial.skills.slice(0, 3).every((item) => item.firstSeenAt === initial.scannedAt),
      ).toBe(true)
      expect(initial.skills[3]).toMatchObject({
        firstSeenAt: null,
        fileCreatedAt: '2026-10-07T01:00:00.000Z',
        archived: true,
      })
      database.close()
      database = new CoreDatabase(filename)
      repository = new SkillsRepository(database.raw, home, {})
      vi.setSystemTime(new Date('2026-10-10T01:00:00Z'))
      expect((await repository.scan()).skills).toEqual(initial.skills)
      expect(new SkillsRepository(database.raw, home, {}).inventory().skills).toEqual(
        initial.skills,
      )
    } finally {
      database.close()
    }
  })

  it('preserves archives over scans and restarts, retains missing archived metadata, and restores without changing files', async () => {
    const home = await tempHome()
    const directory = path.join(home, '.codex/skills/sample')
    await writeSkill(directory, 'sample')
    const filename = path.join(home, 'inventory.sqlite')
    let database = new CoreDatabase(filename)
    let repository = new SkillsRepository(database.raw, home, {})
    const first = await repository.scan()
    expect(first.skills).toHaveLength(1)
    const id = first.skills[0]!.id
    repository.archive(id, true)
    expect((await repository.scan()).skills[0]?.archived).toBe(true)
    expect(await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8')).toContain('name: sample')
    database.close()
    database = new CoreDatabase(filename)
    repository = new SkillsRepository(database.raw, home, {})
    try {
      expect(repository.inventory().skills[0]?.archived).toBe(true)
      await fs.rm(directory, { recursive: true })
      const missing = await repository.scan()
      expect(missing.skills[0]).toMatchObject({
        id,
        present: false,
        archived: true,
        name: 'sample',
      })
      repository.archive(id, false)
      await writeSkill(directory, 'sample-v2')
      expect((await repository.scan()).skills[0]).toMatchObject({
        id,
        present: true,
        archived: false,
        name: 'sample-v2',
      })
      expect(() => repository.archive('not-an-id', true)).toThrow('invalid_skill')
    } finally {
      database.close()
    }
  })

  it('retains cached data on an incomplete root scan and coalesces concurrent scans', async () => {
    const home = await tempHome()
    const root = path.join(home, '.codex/skills')
    await writeSkill(path.join(root, 'sample'))
    const database = new CoreDatabase(':memory:')
    const repository = new SkillsRepository(database.raw, home, {})
    try {
      await repository.scan()
      await fs.rm(path.join(root, 'sample'), { recursive: true })
      await fs.symlink(path.join(home, 'missing'), path.join(root, 'broken'), 'junction')
      const scan = repository.scan()
      expect(repository.scan()).toBe(scan)
      const next = await scan
      expect(next.skills[0]?.present).toBe(true)
      expect(next.issues.length).toBeGreaterThan(0)
    } finally {
      database.close()
    }
  })

  it('adds explicit project roots and rejects invalid directories', async () => {
    const home = await tempHome()
    const project = path.join(home, 'project')
    await writeSkill(path.join(project, '.qoder/skills/project-skill'), 'project-skill')
    const database = new CoreDatabase(':memory:')
    const repository = new SkillsRepository(database.raw, home, {})
    try {
      await expect(repository.addProject('relative')).rejects.toThrow()
      await expect(repository.addProject(path.join(home, 'missing'))).rejects.toThrow()
      await repository.addProject(project)
      await repository.addProject(project)
      const inventory = await repository.scan()
      expect(inventory.projects).toEqual([await fs.realpath(project)])
      expect(inventory.skills[0]?.sources[0]).toMatchObject({ client: 'Qoder', scope: 'project' })
    } finally {
      database.close()
    }
  })
})

describe('Skill files read boundary', () => {
  it('lists nested resources and reads selected Markdown, code and raster files without execution', async () => {
    const home = await tempHome()
    const root = path.join(home, '.codex/skills/sample')
    await writeSkill(root)
    await fs.mkdir(path.join(root, 'references'), { recursive: true })
    await fs.writeFile(path.join(root, 'references/guide.md'), '# Guide\n\n**Bold**')
    await fs.writeFile(path.join(root, 'script.sh'), 'touch SHOULD_NEVER_EXIST')
    await fs.writeFile(path.join(root, 'image.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const database = new CoreDatabase(':memory:')
    const repository = new SkillsRepository(database.raw, home, {})
    try {
      const id = (await repository.scan()).skills[0]!.id
      const directory = await repository.directory(id)
      expect(directory.entries[0]?.path).toBe('SKILL.md')
      expect(
        directory.entries.find((entry) => entry.name === 'references')?.children,
      ).toMatchObject([{ path: 'references/guide.md' }])
      expect(await repository.file(id, 'references/guide.md')).toMatchObject({
        kind: 'markdown',
        content: '# Guide\n\n**Bold**',
      })
      expect(await repository.file(id, 'script.sh')).toMatchObject({
        kind: 'text',
        content: 'touch SHOULD_NEVER_EXIST',
      })
      expect(await repository.file(id, 'image.png')).toMatchObject({
        kind: 'image',
        content: expect.stringContaining('data:image/png;base64,'),
      })
      await expect(fs.stat(path.join(root, 'SHOULD_NEVER_EXIST'))).rejects.toThrow()
    } finally {
      database.close()
    }
  })
  it('rejects forged IDs, traversal, file/directory links and a redirected source root', async () => {
    const home = await tempHome()
    const root = path.join(home, '.codex/skills/sample')
    await writeSkill(root)
    await fs.writeFile(path.join(home, 'outside.txt'), 'private')
    await fs.symlink(path.join(home, 'outside.txt'), path.join(root, 'outside-link.txt'))
    await fs.symlink(home, path.join(root, 'outside-directory'))
    const database = new CoreDatabase(':memory:')
    const repository = new SkillsRepository(database.raw, home, {})
    try {
      const id = (await repository.scan()).skills[0]!.id
      const tree = await repository.directory(id)
      expect(tree.entries.find((entry) => entry.name === 'outside-link.txt')?.kind).toBe(
        'unavailable',
      )
      for (const file of [
        '../outside.txt',
        '/etc/passwd',
        'outside-link.txt',
        'outside-directory/outside.txt',
        'SKILL.md/child',
        '',
      ])
        await expect(repository.file(id, file)).rejects.toThrow()
      await expect(repository.file('f'.repeat(64), 'SKILL.md')).rejects.toThrow('skill_not_found')
      await expect(repository.directory('../invalid')).rejects.toThrow('invalid_skill_file')
      await fs.rename(root, root + '-moved')
      await fs.symlink(root + '-moved', root)
      await expect(repository.file(id, 'SKILL.md')).rejects.toThrow('skill_source_changed')
    } finally {
      database.close()
    }
  })
  it('bounds tree enumeration and file bytes, and reports missing and binary files', async () => {
    const home = await tempHome()
    const root = path.join(home, '.codex/skills/sample')
    await writeSkill(root)
    await fs.writeFile(path.join(root, 'large.md'), 'x'.repeat(256 * 1024 + 1))
    await fs.writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 255, 0]))
    await fs.mkdir(path.join(root, 'many'))
    await Promise.all(
      Array.from({ length: 810 }, (_, index) =>
        fs.writeFile(path.join(root, 'many', `${index}.txt`), 'x'),
      ),
    )
    const database = new CoreDatabase(':memory:')
    const repository = new SkillsRepository(database.raw, home, {})
    try {
      const id = (await repository.scan()).skills[0]!.id
      expect((await repository.directory(id)).truncated).toBe(true)
      expect(await repository.file(id, 'large.md')).toMatchObject({ kind: 'too-large' })
      expect(await repository.file(id, 'binary.dat')).toMatchObject({ kind: 'unsupported' })
      await expect(repository.file(id, 'missing.md')).rejects.toThrow('skill_file_unavailable')
    } finally {
      database.close()
    }
  })
})
