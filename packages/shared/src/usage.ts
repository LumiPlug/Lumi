// SPDX-License-Identifier: MPL-2.0
export const usageSoftwareNames = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  cline: 'Cline',
  'cline-cli': 'Cline CLI',
  codewhale: 'CodeWhale',
  codebuff: 'Codebuff',
  copilot: 'Copilot',
  devin: 'Devin',
  droid: 'Droid',
  dsh: 'DeepSeek Harness',
  gemini: 'Gemini',
  hermes: 'Hermes Agent',
  'ibm-bob': 'IBM Bob',
  'kilo-code': 'KiloCode',
  kiro: 'Kiro',
  kimi: 'Kimi',
  kimicode: 'Kimi Code',
  'lingtai-tui': 'LingTai TUI',
  'mistral-vibe': 'Mistral Vibe',
  mux: 'Mux',
  openclaw: 'OpenClaw',
  openclaude: 'OpenClaude',
  'open-design': 'Open Design',
  pi: 'Pi',
  omp: 'OMP',
  qwen: 'Qwen',
  quickdesk: 'Quick Desktop',
  zerostack: 'Zerostack',
  grok: 'Grok Build',
  grokbot: 'Grok Bot',
  amp: 'Amp',
  'command-code': 'Command Code',
  antigravity: 'Antigravity',
  forge: 'Forge',
  goose: 'Goose',
  opencode: 'OpenCode',
  'cursor-agent': 'Cursor Agent',
  crush: 'Crush',
  warp: 'Warp',
  'vercel-gateway': 'Vercel AI Gateway',
  zcode: 'ZCode',
  zed: 'Zed',
  qoder: 'Qoder',
  qoderwork: 'QoderWork',
  workbuddy: 'WorkBuddy',
  qwenwork: '千问办公',
} as const
/** Lumi-owned readers supplement the fixed upstream CodeBurn registry. */
export const nativeUsageSoftwareIds = ['qoder', 'qoderwork', 'workbuddy', 'qwenwork'] as const
export type NativeUsageSoftware = (typeof nativeUsageSoftwareIds)[number]
export type UsageSoftware = keyof typeof usageSoftwareNames
/** Complete Lumi registry, including both upstream and native readers. */
export const allUsageSoftwareIds = Object.keys(usageSoftwareNames) as UsageSoftware[]
/** Original CodeBurn registry; retained for upstream adapters and existing consumers. */
export const usageSoftwareIds = allUsageSoftwareIds.filter(
  (software) => !(nativeUsageSoftwareIds as readonly string[]).includes(software),
)
export type UsageQuality = 'reported' | 'estimated' | 'missing' | 'context_snapshot'
/** input includes cache for Codex; excludes cache for Claude; unknown for Cursor. */
export interface UsageRecord {
  id: string
  reader?: 'codeburn' | 'native'
  /** Older unmarked native Qoder records came from SQLite. */
  qoderFormat?: 'jsonl' | 'sqlite'
  /** Hashed explicit session/request pair; absent for rowid and old unverified records. */
  qoderRequest?: string
  requestCount?: number
  counterBasis?: 'initial' | 'delta' | 'reset' | 'response' | 'last'
  software: UsageSoftware
  time: string
  model: string | null
  session: string
  /** Optional local display metadata; session identity and token accounting stay unchanged. */
  sessionName?: string
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  total: number | null
  inputIncludesCache: boolean | null
  quality: UsageQuality
}
export interface UsageSource {
  software: UsageSoftware
  state: 'ready' | 'absent' | 'empty' | 'denied' | 'incompatible' | 'partial' | 'missing_usage'
  files: number
  records: number
  issues: number
  experimental: boolean
  problems?: Array<'denied' | 'incompatible' | 'limit' | 'missing_usage' | 'identity_unverified'>
}
export interface UsageSnapshot {
  records: UsageRecord[]
  sources: UsageSource[]
  paused: boolean
  updatedAt: string | null
  truncated: boolean
}
export interface UsageFilter {
  start: string
  end: string
  software?: UsageSoftware
  model?: string
  session?: string
}
export interface UsageTotals {
  /** Optional for legacy records; new CodeBurn records use uncached input. */
  inputIncludesCache?: boolean | null
  estimatedCount?: number
  total: number | null
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  count: number
}
export interface UsageGroup extends UsageTotals {
  key: string
}
export interface UsageSession extends UsageTotals {
  key: string
  software: UsageSoftware
  session: string
  sessionName?: string
  latestTime: string
  models?: Array<string | null>
}
export interface UsageSessionPage {
  sessions: UsageSession[]
  /** Session count across the complete filtered range, before pagination. */
  matched: number
  truncated: boolean
}
export interface UsageReport extends UsageSnapshot {
  totals: UsageTotals
  daily: Array<UsageGroup & { software: UsageSoftware }>
  /** UTC bucket starts, anchored at the selected local midnight; requested with granularity=hour. */
  hourly?: Array<UsageGroup & { software: UsageSoftware }>
  software: UsageGroup[]
  models: Array<UsageGroup & { software: UsageSoftware; model: string | null }>
  matched: number
}
