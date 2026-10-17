// SPDX-License-Identifier: MPL-2.0
export interface Source { path: string; project: string; provider: string; sourceKind?: string }
export interface Usage { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; cachedInputTokens: number; reasoningTokens: number }
export interface Call { provider: string; model: string; timestamp: string; deduplicationKey: string; usage: Usage; isEstimated?: boolean; requestCount?: number }
export interface Turn { sessionId: string; timestamp: string; calls: Call[] }
export interface Project { sessions: Array<{ sessionId: string; title?: string; turns: Array<{ assistantCalls: Call[] }> }> }
export interface Cache { providers: Record<string, unknown>; [key: string]: unknown }
export interface Provider { name: string; displayName: string; network?: boolean; probeRoots?: () => Promise<Array<{ path: string; label: string }>>; discoverSessions: () => Promise<Source[]> }
export function getAllProviders(): Promise<Provider[]>
export function getProvider(name: string): Promise<Provider | undefined>
export function allProviderNames(): string[]
export function billableOutputTokens(provider: string, output: number, reasoning: number): number
export function parseProviderSources(provider: string, sources: Source[], seen: Set<string>, cache: Cache, dateRange?: {start: Date; end: Date}): Promise<Project[]>
export function parseClaudeFileFull(filename: string, seen: Set<string>): Promise<{ title?: string; turns: Turn[] } | null>
export function collectJsonlFiles(directory: string): Promise<string[]>
export function emptyCache(): Cache
export function providerIssues(): Array<{ provider: string; stage: string; kind: string }>
export function clearProviderIssue(provider: string, stage: 'locate' | 'parse'): void
