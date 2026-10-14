// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { SESSION_TOKEN_HEADER } from '@lumiplug/shared'
import { CoreDatabase } from '../db/database'
import { CoreService } from '../service'
import { SkillsRepository } from './repository'
import * as scanner from './scanner'

let home: string
let database: CoreDatabase
let repository: SkillsRepository
let managedRoot: string
const body =
  '---\nname: local-guide\ndescription: Review local code changes\n---\nRead references/guide.md; scripts/check.sh is not automatically executed.\n'
async function skill(directory: string) {
  await fs.mkdir(path.join(directory, 'references'), { recursive: true })
  await fs.mkdir(path.join(directory, 'scripts'))
  await fs.writeFile(path.join(directory, 'SKILL.md'), body)
  await fs.writeFile(path.join(directory, 'references/guide.md'), '# Review guide')
  await fs.writeFile(path.join(directory, 'scripts/check.sh'), 'touch MUST_NOT_EXIST', {
    mode: 0o755,
  })
  return directory
}
beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-managed-test-')))
  managedRoot = path.join(home, 'lumi/skills')
  database = new CoreDatabase(path.join(home, 'test.sqlite'))
  repository = new SkillsRepository(database.raw, home, {}, managedRoot)
})
afterEach(async () => {
  vi.restoreAllMocks()
  database.close()
  await fs.rm(home, { recursive: true, force: true })
})

describe('Lumi managed skill installation', () => {
  it('imports scanned packages without modifying sources and survives restart and source removal', async () => {
    const source = await skill(path.join(home, '.agents/skills/local-guide'))
    await fs.mkdir(path.join(source, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(source, 'node_modules/dependency.txt'), 'not bundled')
    await fs.writeFile(path.join(source, 'references/binary.dat'), Buffer.from([0, 1, 255]))
    const scanned = (await repository.scan()).skills[0]!
    expect(scanned.managed).toBe(false)
    expect((await repository.searchSkills()).skills).toEqual([])
    await expect(repository.getSkill(scanned.id)).rejects.toThrow('skill_not_available')
    const imported = await repository.importSkill({ id: scanned.id })
    const managed = imported.skills.find((item) => item.managed)!
    expect(await fs.readdir(path.dirname(managed.path))).not.toContain('node_modules')
    expect(
      await fs.readFile(path.join(path.dirname(managed.path), 'references/binary.dat')),
    ).toEqual(Buffer.from([0, 1, 255]))
    expect(managed).toMatchObject({ present: true, archived: false, name: 'local-guide' })
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe(body)
    expect(
      await fs.readFile(path.join(path.dirname(managed.path), 'scripts/check.sh'), 'utf8'),
    ).toContain('touch')
    if (process.platform !== 'win32') {
      expect(
        (await fs.stat(path.join(path.dirname(managed.path), 'scripts/check.sh'))).mode & 0o111,
      ).toBeTruthy()
    }
    expect(await fs.readdir(home)).not.toContain('MUST_NOT_EXIST')
    await fs.rm(source, { recursive: true })
    repository = new SkillsRepository(database.raw, home, {}, managedRoot)
    await repository.scan()
    expect(await repository.searchSkills('review code')).toMatchObject({
      skills: [{ id: managed.id }],
      total: 1,
      nextOffset: null,
    })
    expect(await repository.getSkill(managed.id)).toMatchObject({ instructions: body })
    expect(await repository.readManagedFile(managed.id, 'references/guide.md')).toMatchObject({
      file: { content: '# Review guide' },
    })
    repository.archive(managed.id, true)
    expect((await repository.searchSkills()).total).toBe(0)
    await expect(repository.getSkill(managed.id)).rejects.toThrow('skill_not_available')
    await expect(repository.readManagedFile(managed.id, 'SKILL.md')).rejects.toThrow(
      'skill_not_available',
    )
    repository.archive(managed.id, false)
    expect((await repository.searchSkills()).total).toBe(1)
  })

  it('waits for an active installation when scanning and rejects overlapping imports', async () => {
    const source = await skill(path.join(home, 'source'))
    const installation = repository.importSkill({ directory: source })
    const scan = repository.scan()
    await expect(repository.importSkill({ directory: source })).rejects.toThrow(
      'skill_import_unavailable',
    )
    expect((await scan).skills.filter((item) => item.managed)).toHaveLength(1)
    expect((await installation).skills.filter((item) => item.managed)).toHaveLength(1)
    const id = (await repository.searchSkills()).skills[0]!.id
    const original = repository.file.bind(repository)
    vi.spyOn(repository, 'file').mockImplementationOnce(async (...args) => {
      const file = await original(...args)
      repository.archive(id, true)
      return file
    })
    await expect(repository.readManagedFile(id, 'SKILL.md')).rejects.toThrow('skill_not_available')
  })

  it('rejects duplicate installs without overwriting and keeps namesakes independent and paginated', async () => {
    const first = await skill(path.join(home, 'a/local-guide'))
    const second = await skill(path.join(home, 'b/local-guide'))
    await repository.importSkill({ directory: first })
    const installed = (await repository.searchSkills()).skills[0]!
    await fs.writeFile(path.join(first, 'references/guide.md'), 'changed original')
    await expect(repository.importSkill({ directory: first })).rejects.toThrow(
      'skill_already_imported',
    )
    expect(await repository.readManagedFile(installed.id, 'references/guide.md')).toMatchObject({
      file: { content: '# Review guide' },
    })
    await repository.importSkill({ directory: second })
    expect(await repository.searchSkills('', 0, 1)).toMatchObject({
      skills: [expect.anything()],
      total: 2,
      nextOffset: 1,
    })
    expect(await repository.searchSkills('', 1, 1)).toMatchObject({ total: 2, nextOffset: null })
    expect(new Set((await repository.searchSkills()).skills.map((item) => item.id)).size).toBe(2)
    expect(await repository.searchSkills('does-not-match')).toMatchObject({ total: 0 })
    const managed = repository.inventory().skills.find((item) => item.managed)!
    await expect(repository.importSkill({ directory: path.dirname(managed.path) })).rejects.toThrow(
      'skill_import_invalid',
    )
  })

  it('rejects malformed packages, links, oversized files and deep trees and cleans staging', async () => {
    await expect(repository.importSkill({ directory: 'relative' })).rejects.toThrow(
      'skill_import_invalid',
    )
    const source = await skill(path.join(home, 'source'))
    await fs.writeFile(path.join(source, 'SKILL.md'), '# No metadata')
    await expect(repository.importSkill({ directory: source })).rejects.toThrow(
      'skill_import_invalid',
    )
    await fs.writeFile(path.join(source, 'SKILL.md'), body)
    await fs.symlink(path.join(source, 'SKILL.md'), path.join(source, 'link'))
    await expect(repository.importSkill({ directory: source })).rejects.toThrow('skill_import_link')
    await fs.unlink(path.join(source, 'link'))
    const huge = await fs.open(path.join(source, 'huge'), 'w')
    await huge.truncate(33 * 1024 * 1024)
    await huge.close()
    await expect(repository.importSkill({ directory: source })).rejects.toThrow(
      'skill_import_limit',
    )
    await fs.unlink(path.join(source, 'huge'))
    await fs.mkdir(path.join(source, ...Array<string>(14).fill('deep')), { recursive: true })
    await expect(repository.importSkill({ directory: source })).rejects.toThrow(
      'skill_import_limit',
    )
    expect(await fs.readdir(managedRoot)).toEqual([])
    expect(await fs.readdir(path.dirname(managedRoot))).toEqual(['skills'])
  })

  it('enforces managed read boundaries and hides missing packages and escaping links during discovery', async () => {
    await repository.importSkill({ directory: await skill(path.join(home, 'source')) })
    const installed = (await repository.searchSkills()).skills[0]!
    await expect(repository.readManagedFile(installed.id, '../test.sqlite')).rejects.toThrow(
      'invalid_skill_file',
    )
    await expect(repository.readManagedFile(installed.id, '/etc/hosts')).rejects.toThrow(
      'invalid_skill_file',
    )
    const file = repository.inventory().skills.find((item) => item.id === installed.id)!.path
    await fs.symlink(path.join(home, 'test.sqlite'), path.join(path.dirname(file), 'escape'))
    await expect(repository.readManagedFile(installed.id, 'escape')).rejects.toThrow(
      'invalid_skill_file',
    )
    await fs.writeFile(path.join(path.dirname(file), 'large.txt'), 'x'.repeat(256 * 1024 + 1))
    expect(await repository.readManagedFile(installed.id, 'large.txt')).toMatchObject({
      file: { kind: 'too-large' },
    })
    await fs.rm(path.dirname(file), { recursive: true })
    expect((await repository.searchSkills()).total).toBe(0)
    await expect(repository.getSkill(installed.id)).rejects.toThrow('skill_file_unavailable')
    await fs.symlink(await skill(path.join(home, 'outside')), path.join(managedRoot, 'external'))
    await repository.scan()
    expect((await repository.searchSkills()).total).toBe(0)
  })
})

describe('managed skills over authenticated HTTP and real MCP', () => {
  it('restricts installation to the host and supports discovery, activation and reads through MCP', async () => {
    // Keep this integration test independent from the developer machine's installed skills.
    vi.spyOn(scanner, 'skillRoots').mockReturnValue([])
    const token = 'skill-mcp-test-session-0123456789abcdef'
    const hostToken = 'skill-host-only-test-0123456789abcdef'
    const service = new CoreService({
      host: '127.0.0.1',
      port: 0,
      userDataDir: path.join(home, 'service'),
      sessionToken: token,
      hostToken,
    })
    const client = new Client({ name: 'skills integration test', version: '1.0.0' })
    try {
      await service.start()
      const base = `http://127.0.0.1:${service.port}`
      const source = await skill(path.join(home, 'source'))
      const request = {
        method: 'POST',
        headers: { [SESSION_TOKEN_HEADER]: token, 'content-type': 'application/json' },
        body: JSON.stringify({ directory: source }),
      }
      expect((await fetch(`${base}/app/skills/import`, { ...request, headers: {} })).status).toBe(
        401,
      )
      expect((await fetch(`${base}/app/skills/import`, request)).status).toBe(403)
      const installed = await fetch(`${base}/app/skills/import`, {
        ...request,
        headers: { ...request.headers, 'x-lumiplug-host-token': hostToken },
      })
      expect(installed.status).toBe(200)
      const inventory = (await installed.json()).data
      const id = inventory.skills.find((item: { managed: boolean }) => item.managed).id as string
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { [SESSION_TOKEN_HEADER]: token } },
        }),
      )
      const tools = await client.listTools()
      for (const name of ['Lumi.search_skills', 'Lumi.get_skill', 'Lumi.read_skill_file']) {
        expect(tools.tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
          readOnlyHint: true,
        })
      }
      expect(tools.tools.some((tool) => tool.name.includes('import_skill'))).toBe(false)
      expect(
        (await client.callTool({ name: 'Lumi.get_context', arguments: {} })).structuredContent,
      ).toMatchObject({ features: { skills: true } })
      const search = await client.callTool({
        name: 'Lumi.search_skills',
        arguments: { query: 'review' },
      })
      expect(search.structuredContent).toMatchObject({
        skills: [{ id, name: 'local-guide' }],
        total: 1,
      })
      expect(JSON.stringify(search)).not.toContain(source)
      expect(JSON.stringify(search)).not.toContain(body)
      expect(
        (await client.callTool({ name: 'Lumi.get_skill', arguments: { id } })).structuredContent,
      ).toMatchObject({ instructions: body, files: expect.any(Array) })
      expect(
        (
          await client.callTool({
            name: 'Lumi.read_skill_file',
            arguments: { id, path: 'references/guide.md' },
          })
        ).structuredContent,
      ).toMatchObject({ file: { content: '# Review guide' } })
      const badPath = await client.callTool({
        name: 'Lumi.read_skill_file',
        arguments: { id, path: '../lumiplug.sqlite' },
      })
      expect(badPath).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'invalid_skill_file' } },
      })
      const badArgs = await client.callTool({
        name: 'Lumi.search_skills',
        arguments: { limit: 500 },
      })
      expect(badArgs.isError).toBe(true)
      service.skills.archive(id, true)
      expect(await client.callTool({ name: 'Lumi.get_skill', arguments: { id } })).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'skill_not_available' } },
      })
      expect(
        (await client.callTool({ name: 'Lumi.search_skills', arguments: {} })).structuredContent,
      ).toMatchObject({ total: 0 })
    } finally {
      await client.close()
      await service.stop()
    }
  })
})
