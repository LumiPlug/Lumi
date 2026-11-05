// SPDX-License-Identifier: MPL-2.0

import os from 'node:os'
import path from 'node:path'
import type { SkillSource } from '@lumiplug/shared'

export interface ScanRoot {
  client: string
  scope: SkillSource['scope']
  path: string
  /** Enumerate only direct profile directories, then enter their skills child. */
  layout?: 'profiles'
}

/** Verified directory candidates, not a claim that a client is installed or enabled.
 * Sources and intentionally uncovered formats/configuration: docs/SKILL_SOURCES.md.
 */
export function skillRoots(
  projects: string[],
  home = os.homedir(),
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ScanRoot[] {
  const user = (relative: string) => path.join(home, relative)
  const absolute = (name: string, fallback: string) => {
    const value = environment[name]?.trim()
    return value && path.isAbsolute(value) ? path.normalize(value) : fallback
  }
  const config = absolute('XDG_CONFIG_HOME', user('.config'))
  // Preserve the original Codex/Claude override semantics.
  const codex = environment.CODEX_HOME ? path.resolve(environment.CODEX_HOME) : user('.codex')
  const claude = environment.CLAUDE_CONFIG_DIR
    ? path.resolve(environment.CLAUDE_CONFIG_DIR)
    : user('.claude')
  const agents = user('.agents/skills')
  const claudeSkills = user('.claude/skills')
  const configAgents = path.join(config, 'agents/skills')
  const roots: ScanRoot[] = []
  const add = (client: string, personal: string[], project: string[] = []) => {
    for (const directory of personal) roots.push({ client, scope: 'personal', path: directory })
    for (const directory of projects)
      for (const relative of project)
        roots.push({ client, scope: 'project', path: path.join(directory, relative) })
  }
  const plugin = (client: string, directory: string) =>
    roots.push({ client, scope: 'plugin', path: directory })
  const sharedProject = '.agents/skills'
  const claudeProject = '.claude/skills'

  add('Codex', [path.join(codex, 'skills'), agents], [sharedProject, '.codex/skills'])
  plugin('Codex', path.join(codex, 'plugins/cache'))
  add('Claude Code', [path.join(claude, 'skills')], [claudeProject])
  plugin('Claude Code', path.join(claude, 'plugins/cache'))
  add('Qoder', [user('.qoder/skills'), user('.qoder-cn/skills')], ['.qoder/skills'])
  add('QoderWork', [user('.qoderwork/skills')])
  // Cursor Agent shares Cursor's inventory rather than duplicating the same product label.
  add('Cursor', [user('.cursor/skills')], ['.cursor/skills', sharedProject])
  add('Gemini CLI', [user('.gemini/skills'), agents], ['.gemini/skills', sharedProject])
  plugin('Gemini CLI', user('.gemini/extensions'))

  for (const client of ['Cline', 'Cline CLI'])
    add(client, [user('.cline/skills')], ['.cline/skills', '.clinerules/skills', claudeProject])
  add(
    'CodeWhale',
    [user('.codewhale/skills'), agents, claudeSkills, user('.deepseek/skills')],
    ['.codewhale/skills', sharedProject, claudeProject, '.opencode/skills', '.cursor/skills'],
  )
  add('Codebuff', [agents, claudeSkills], [sharedProject, claudeProject])
  add(
    'Copilot',
    [user('.copilot/skills'), agents],
    ['.github/skills', claudeProject, sharedProject],
  )
  const devinConfig = platform === 'win32' ? absolute('APPDATA', user('AppData/Roaming')) : config
  add(
    'Devin',
    [path.join(devinConfig, 'devin/skills'), agents],
    ['.devin/skills', '.windsurf/skills', sharedProject],
  )
  add('Droid', [user('.factory/skills'), agents], ['.factory/skills', sharedProject])
  add(
    'DeepSeek Harness',
    [
      path.join(absolute('DSH_HOME', user('.dsh')), 'skills'),
      path.join(absolute('DSH_AGENTS_HOME', user('.agents')), 'skills'),
    ],
    ['.dsh/skills', sharedProject],
  )
  add('Hermes Agent', [path.join(absolute('HERMES_HOME', user('.hermes')), 'skills')])
  add('IBM Bob', [user('.bob/skills')], ['.bob/skills'])
  add('KiloCode', [user('.kilo/skills'), agents], ['.kilo/skills', sharedProject])
  add('Kiro', [user('.kiro/skills')], ['.kiro/skills'])
  add(
    'Kimi',
    [user('.kimi/skills'), claudeSkills, user('.codex/skills'), configAgents, agents],
    ['.kimi/skills', claudeProject, '.codex/skills', sharedProject],
  )
  add(
    'Kimi Code',
    [path.join(absolute('KIMI_CODE_HOME', user('.kimi-code')), 'skills'), agents],
    ['.kimi-code/skills', sharedProject],
  )
  add('LingTai TUI', [user('.lingtai-tui/utilities')])
  add(
    'Mistral Vibe',
    [path.join(absolute('VIBE_HOME', user('.vibe')), 'skills')],
    ['.vibe/skills', sharedProject],
  )
  add(
    'Mux',
    [user('.xum/skills'), user('.mux/skills'), agents, claudeSkills],
    ['.xum/skills', '.mux/skills', sharedProject, claudeProject],
  )
  add('OpenClaw', [user('.openclaw/skills'), user('.openclaw/workspace/skills')], ['skills'])
  add('OpenClaude', [user('.openclaude/skills'), agents], ['.openclaude/skills'])
  // Open Design's packaged data root is channel/namespace dependent. Only explicit roots.
  const openDesign = absolute('OD_DATA_DIR', '')
  if (openDesign) add('Open Design', [path.join(openDesign, 'user-skills')])
  add('Pi', [user('.pi/agent/skills'), agents], ['.pi/skills', sharedProject])
  add(
    'OMP',
    [user('.omp/agent/skills'), user('.omp/agent/managed-skills')],
    [
      '.omp/skills',
      '.agent/skills',
      sharedProject,
      claudeProject,
      '.codex/skills',
      '.opencode/skills',
      '.github/skills',
    ],
  )
  add('Qwen', [user('.qwen/skills')], ['.qwen/skills'])
  roots.push({
    client: 'Quick Desktop',
    scope: 'personal',
    path: path.join(absolute('QUICKWORK_HOME', user('.quickwork')), 'profiles'),
    layout: 'profiles',
  })
  add('Grok Build', [path.join(absolute('GROK_HOME', user('.grok')), 'skills')], ['.grok/skills'])
  add('Amp', [configAgents, agents, claudeSkills], [sharedProject, claudeProject])
  add('Command Code', [user('.commandcode/skills')], ['.commandcode/skills'])
  add(
    'Antigravity',
    [user('.gemini/config/skills'), user('.gemini/antigravity/skills')],
    [sharedProject, '.agent/skills'],
  )
  add('Forge', [user('forge/skills'), agents], ['.forge/skills'])
  const gooseConfig = platform === 'win32' ? absolute('APPDATA', user('AppData/Roaming')) : config
  add(
    'Goose',
    [agents, configAgents, path.join(gooseConfig, 'goose/skills'), claudeSkills],
    ['.goose/skills', sharedProject, claudeProject],
  )
  add(
    'OpenCode',
    [path.join(config, 'opencode/skills'), agents, claudeSkills],
    ['.opencode/skills', sharedProject, claudeProject],
  )
  const crushSkills = [path.join(config, 'crush/skills'), configAgents, agents, claudeSkills]
  const extraCrush = absolute('CRUSH_SKILLS_DIR', '')
  if (extraCrush) crushSkills.push(extraCrush)
  if (platform === 'win32') {
    const local = absolute('LOCALAPPDATA', user('AppData/Local'))
    crushSkills.push(path.join(local, 'crush/skills'), path.join(local, 'agents/skills'))
  }
  add('Crush', crushSkills, [sharedProject, '.crush/skills', claudeProject, '.cursor/skills'])
  const warp = [
    '.agents/skills',
    '.warp/skills',
    '.claude/skills',
    '.codex/skills',
    '.cursor/skills',
    '.gemini/skills',
    '.copilot/skills',
    '.factory/skills',
    '.github/skills',
    '.opencode/skills',
  ]
  add('Warp', warp.map(user), warp)
  add('ZCode', [user('.zcode/skills')], ['.zcode/skills'])
  add('Zed', [agents], [sharedProject])
  add('WorkBuddy', [user('.workbuddy/skills')])
  add('千问办公', [user('.qwenworkcn/skills')])
  // Desktop workspace candidate; this Lumi override is not Doubao's own setting.
  add('豆包桌面版', [absolute('LUMI_DOUBAO_SKILLS_DIR', user('Doubao/skills'))])
  const isolatedReasonix = absolute('REASONIX_HOME', '')
  const reasonixDefault =
    platform === 'win32'
      ? path.join(absolute('APPDATA', user('AppData/Roaming')), 'reasonix')
      : user('.reasonix')
  add(
    'Reasonix',
    [
      path.join(isolatedReasonix || reasonixDefault, 'skills'),
      // REASONIX_HOME is a self-contained home: never attribute fallback skills to it.
      ...(!isolatedReasonix
        ? [user('.reasonix/skills'), agents, user('.agent/skills'), claudeSkills]
        : []),
    ],
    ['.reasonix/skills', sharedProject, '.agent/skills', claudeProject],
  )

  const seen = new Set<string>()
  return roots.filter((root) => {
    const key = JSON.stringify([root.client, root.scope, root.path, root.layout])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
