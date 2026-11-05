// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanSkillRoots, skillRoots, type ScanRoot } from './scanner'
import { CoreDatabase } from '../db/database'
import { SkillsRepository } from './repository'

const temporary: string[] = []
async function tempHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-skill-sources-'))
  temporary.push(home)
  return home
}
async function skill(directory: string, name: string) {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test workflow\n---\n`,
  )
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporary.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })))
})

describe('Additional Skills sources', () => {
  it('discovers Doubao desktop skills and replaces the candidate with an explicit Lumi directory', async () => {
    const home = await tempHome()
    const project = path.join(home, 'project')
    const custom = path.join(home, '自定义工作区', 'skills')
    await skill(path.join(home, 'Doubao/skills/default'), 'doubao-desktop')
    await skill(path.join(home, '.doubao/skills/tui'), 'unrelated-tui')
    await skill(path.join(home, 'Doubao/.skills/internal'), 'unrelated-internal')
    await skill(path.join(project, '.doubao/skills/project'), 'unrelated-project')
    await skill(path.join(custom, 'custom'), 'doubao-custom')
    const defaults = skillRoots([project], home, {}, 'darwin').filter(
      (r) => r.client === '豆包桌面版',
    )
    expect(defaults).toEqual([
      { client: '豆包桌面版', scope: 'personal', path: path.join(home, 'Doubao/skills') },
    ])
    expect((await scanSkillRoots(defaults)).skills.map((s) => s.name)).toEqual(['doubao-desktop'])
    const customRoots = skillRoots([project], home, { LUMI_DOUBAO_SKILLS_DIR: custom }).filter(
      (r) => r.client === '豆包桌面版',
    )
    const result = await scanSkillRoots(customRoots)
    expect(result.skills.map((s) => s.name)).toEqual(['doubao-custom'])
    expect(result.skills[0]?.sources[0]).toMatchObject({
      client: '豆包桌面版',
      scope: 'personal',
      root: custom,
    })
    expect(
      skillRoots([], home, { LUMI_DOUBAO_SKILLS_DIR: 'relative' }).filter(
        (r) => r.client === '豆包桌面版',
      ),
    ).toEqual(defaults)
    const absent = await scanSkillRoots(
      skillRoots([], home, {
        LUMI_DOUBAO_SKILLS_DIR: path.join(home, 'missing-skills'),
      }).filter((r) => r.client === '豆包桌面版'),
    )
    expect(absent.issues).toEqual([])
    expect(absent.locations[0]?.status).toBe('missing')
  })

  it('discovers Reasonix conventions, respects isolated homes and resolves the Windows native root', async () => {
    const home = await tempHome()
    const project = path.join(home, 'project')
    const isolated = path.join(home, 'isolated-reasonix')
    await skill(path.join(home, '.reasonix/skills/native'), 'reasonix-native')
    await skill(path.join(home, '.agents/skills/shared'), 'reasonix-shared')
    await skill(path.join(home, '.agent/skills/legacy'), 'reasonix-legacy')
    await skill(path.join(home, '.claude/skills/compatible'), 'reasonix-compatible')
    await skill(path.join(project, '.reasonix/skills/local'), 'reasonix-project')
    await skill(path.join(project, '.agents/skills/shared-project'), 'reasonix-shared-project')
    await skill(path.join(isolated, 'skills/isolation'), 'reasonix-isolated')
    const onlyReasonix = (
      environment: NodeJS.ProcessEnv = {},
      platform: NodeJS.Platform = 'linux',
    ) => skillRoots([project], home, environment, platform).filter((r) => r.client === 'Reasonix')
    const normal = await scanSkillRoots(onlyReasonix())
    expect(normal.issues).toEqual([])
    expect(normal.skills.map((s) => s.name).sort()).toEqual([
      'reasonix-compatible',
      'reasonix-legacy',
      'reasonix-native',
      'reasonix-project',
      'reasonix-shared',
      'reasonix-shared-project',
    ])
    expect(normal.skills.find((s) => s.name === 'reasonix-project')?.sources[0]?.scope).toBe(
      'project',
    )
    const isolatedRoots = onlyReasonix({ REASONIX_HOME: isolated })
    expect(isolatedRoots.filter((r) => r.scope === 'personal')).toEqual([
      { client: 'Reasonix', scope: 'personal', path: path.join(isolated, 'skills') },
    ])
    expect((await scanSkillRoots(isolatedRoots)).skills.map((s) => s.name).sort()).toEqual([
      'reasonix-isolated',
      'reasonix-project',
      'reasonix-shared-project',
    ])
    expect(onlyReasonix({ REASONIX_HOME: 'relative' })).toEqual(onlyReasonix())
    const roaming = path.join(home, 'roaming')
    await skill(path.join(roaming, 'reasonix/skills/windows'), 'reasonix-windows')
    const windows = await scanSkillRoots(onlyReasonix({ APPDATA: roaming }, 'win32'))
    expect(windows.skills.some((s) => s.name === 'reasonix-windows')).toBe(true)
    expect(windows.locations.some((r) => r.path === path.join(roaming, 'reasonix/skills'))).toBe(
      true,
    )
  })

  it('discovers documented dedicated roots, keeps namesakes and exposes all compatible source labels', async () => {
    const home = await tempHome()
    const project = path.join(home, 'project')
    // Independent examples from the source matrix, including current and legacy product names.
    const cases = [
      ['Cline', '.cline/skills'],
      ['Cline CLI', '.cline/skills'],
      ['CodeWhale', '.codewhale/skills'],
      ['Copilot', '.copilot/skills'],
      ['Devin', '.config/devin/skills'],
      ['Droid', '.factory/skills'],
      ['DeepSeek Harness', '.dsh/skills'],
      ['Hermes Agent', '.hermes/skills'],
      ['IBM Bob', '.bob/skills'],
      ['KiloCode', '.kilo/skills'],
      ['Kiro', '.kiro/skills'],
      ['Kimi', '.kimi/skills'],
      ['Kimi Code', '.kimi-code/skills'],
      ['LingTai TUI', '.lingtai-tui/utilities'],
      ['Mistral Vibe', '.vibe/skills'],
      ['Mux', '.xum/skills'],
      ['Mux', '.mux/skills'],
      ['OpenClaw', '.openclaw/skills'],
      ['OpenClaw', '.openclaw/workspace/skills'],
      ['OpenClaude', '.openclaude/skills'],
      ['Pi', '.pi/agent/skills'],
      ['OMP', '.omp/agent/skills'],
      ['OMP', '.omp/agent/managed-skills'],
      ['Qwen', '.qwen/skills'],
      ['Grok Build', '.grok/skills'],
      ['Amp', '.config/agents/skills'],
      ['Command Code', '.commandcode/skills'],
      ['Antigravity', '.gemini/config/skills'],
      ['Antigravity', '.gemini/antigravity/skills'],
      ['Forge', 'forge/skills'],
      ['Goose', '.config/goose/skills'],
      ['OpenCode', '.config/opencode/skills'],
      ['Crush', '.config/crush/skills'],
      ['Warp', '.warp/skills'],
      ['ZCode', '.zcode/skills'],
      ['WorkBuddy', '.workbuddy/skills'],
      ['千问办公', '.qwenworkcn/skills'],
      ['Qoder', '.qoder-cn/skills'],
    ] as const
    for (const directory of new Set(cases.map(([, directory]) => directory)))
      await skill(path.join(home, directory, 'same-name'), 'same-name')
    await skill(path.join(home, '.agents/skills/shared'), 'shared')
    await skill(path.join(project, '.github/skills/project-only'), 'project-only')
    await skill(path.join(project, '.xum/skills/project-mux'), 'project-mux')
    await skill(path.join(project, '.dsh/skills/project-dsh'), 'project-dsh')
    await skill(path.join(project, 'skills/workspace-claw'), 'workspace-claw')
    await skill(path.join(home, 'random/hidden'), 'do-not-scan')
    const result = await scanSkillRoots(skillRoots([project], home, {}, 'linux'))
    expect(result.issues).toEqual([])
    for (const [client, directory] of cases) {
      const filename = await fs.realpath(path.join(home, directory, 'same-name/SKILL.md'))
      expect(result.skills.find((s) => s.path === filename)?.sources).toEqual(
        expect.arrayContaining([expect.objectContaining({ client, scope: 'personal' })]),
      )
    }
    expect(result.skills.filter((s) => s.name === 'same-name')).toHaveLength(
      new Set(cases.map(([, d]) => d)).size,
    )
    expect(result.skills.find((s) => s.name === 'shared')?.sources.map((s) => s.client)).toEqual(
      expect.arrayContaining(['Codebuff', 'Copilot', 'Zed', 'Pi', 'OpenCode']),
    )
    for (const [name, client] of [
      ['project-only', 'Copilot'],
      ['project-mux', 'Mux'],
      ['project-dsh', 'DeepSeek Harness'],
      ['workspace-claw', 'OpenClaw'],
    ])
      expect(result.skills.find((s) => s.name === name)?.sources).toEqual(
        expect.arrayContaining([expect.objectContaining({ client, scope: 'project' })]),
      )
    expect(result.skills.some((s) => s.name === 'do-not-scan')).toBe(false)
    expect(
      result.locations.some((s) =>
        ['Zerostack', 'Grok Bot', 'Vercel AI Gateway'].includes(s.client),
      ),
    ).toBe(false)
  })

  it('honors absolute client and XDG overrides without scanning accidental relative environment paths', async () => {
    const home = await tempHome()
    const config = path.join(home, 'custom-config')
    const data = path.join(home, 'od-data')
    const environment = {
      XDG_CONFIG_HOME: config,
      HERMES_HOME: path.join(home, 'hermes'),
      VIBE_HOME: path.join(home, 'vibe'),
      KIMI_CODE_HOME: path.join(home, 'kimi-code'),
      GROK_HOME: path.join(home, 'grok'),
      DSH_HOME: path.join(home, 'dsh'),
      DSH_AGENTS_HOME: path.join(home, 'dsh-agents'),
      OD_DATA_DIR: data,
      CRUSH_SKILLS_DIR: path.join(home, 'crush-extra'),
    }
    for (const [name, directory] of Object.entries(environment))
      await skill(
        path.join(
          directory,
          name === 'OD_DATA_DIR' ? 'user-skills' : name === 'CRUSH_SKILLS_DIR' ? '' : 'skills',
          name,
        ),
        name,
      )
    await skill(path.join(config, 'opencode/skills/xdg-code'), 'xdg-code')
    const result = await scanSkillRoots(skillRoots([], home, environment, 'linux'))
    for (const name of Object.keys(environment).filter((name) => name !== 'XDG_CONFIG_HOME'))
      expect(result.skills.some((s) => s.name === name)).toBe(true)
    expect(result.skills.find((s) => s.name === 'xdg-code')?.sources[0]?.client).toBe('OpenCode')
    const relative = skillRoots([], home, {
      XDG_CONFIG_HOME: 'relative',
      OD_DATA_DIR: 'relative',
      HERMES_HOME: 'relative',
    })
    expect(relative.some((r) => r.client === 'Open Design')).toBe(false)
    expect(relative.find((r) => r.client === 'Hermes Agent')?.path).toBe(
      path.join(home, '.hermes/skills'),
    )
    const windows = skillRoots(
      [],
      home,
      { APPDATA: path.join(home, 'roaming'), LOCALAPPDATA: path.join(home, 'local') },
      'win32',
    )
    expect(windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: 'Devin', path: path.join(home, 'roaming/devin/skills') }),
        expect.objectContaining({ client: 'Goose', path: path.join(home, 'roaming/goose/skills') }),
        expect.objectContaining({ client: 'Crush', path: path.join(home, 'local/crush/skills') }),
      ]),
    )
  })

  it('reads a shared root only once and propagates errors to every alias', async () => {
    const home = await tempHome()
    const root = path.join(home, 'shared')
    await skill(path.join(root, 'example'), 'shared')
    const roots: ScanRoot[] = ['Codebuff', 'Copilot', 'Zed'].map((client) => ({
      client,
      scope: 'personal',
      path: root,
    }))
    const open = vi.spyOn(fs, 'open')
    const result = await scanSkillRoots(roots)
    expect(open).toHaveBeenCalledTimes(1)
    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]?.sources.map((s) => s.client)).toEqual(['Codebuff', 'Copilot', 'Zed'])
    await fs.symlink(path.join(home, 'missing'), path.join(root, 'broken'), 'junction')
    const broken = await scanSkillRoots(roots)
    expect(broken.locations.every((s) => s.status === 'error')).toBe(true)
    expect(broken.issues).toHaveLength(1)
  })

  it('only reads Quick profile skills, skips profile links, rejects linked skill roots and preserves archives', async () => {
    const home = await tempHome()
    const profiles = path.join(home, '.quickwork/profiles')
    await skill(path.join(profiles, 'one/skills/example'), 'quick-one')
    await skill(path.join(profiles, 'two/skills/example'), 'quick-two')
    await skill(path.join(profiles, 'one/sessions/hidden'), 'never-session')
    await fs.symlink(
      path.join(profiles, 'one/sessions'),
      path.join(profiles, 'one/skills/session-link'),
      'junction',
    )
    await skill(path.join(home, 'outside/skills/example'), 'never-outside')
    await fs.symlink(path.join(home, 'outside'), path.join(profiles, 'linked-profile'), 'junction')
    await fs.mkdir(path.join(profiles, 'three'), { recursive: true })
    await fs.symlink(path.join(home, 'outside'), path.join(profiles, 'three/skills'), 'junction')
    const database = new CoreDatabase(':memory:')
    try {
      const repository = new SkillsRepository(database.raw, home, {})
      const first = await repository.scan()
      expect(first.skills.map((s) => s.name).sort()).toEqual(['quick-one', 'quick-two'])
      expect(first.locations.find((l) => l.client === 'Quick Desktop')?.status).toBe('error')
      const selected = first.skills.find((s) => s.name === 'quick-one')!
      repository.archive(selected.id, true)
      await fs.rm(path.join(profiles, 'one'), { recursive: true })
      expect((await repository.scan()).skills.find((s) => s.id === selected.id)?.archived).toBe(
        true,
      )
      expect(
        await fs.readFile(path.join(profiles, 'two/skills/example/SKILL.md'), 'utf8'),
      ).toContain('quick-two')
    } finally {
      database.close()
    }
  })

  it('bounds Quick profile discovery and reports incomplete coverage', async () => {
    const home = await tempHome()
    const profiles = path.join(home, '.quickwork/profiles')
    for (let index = 0; index < 65; index++)
      await skill(path.join(profiles, String(index), 'skills/example'), `profile-${index}`)
    const result = await scanSkillRoots(skillRoots([], home, {}))
    expect(result.skills).toHaveLength(64)
    expect(result.locations.find((l) => l.client === 'Quick Desktop')?.status).toBe('error')
    expect(result.issues).toEqual([expect.objectContaining({ path: profiles })])
  })
})
