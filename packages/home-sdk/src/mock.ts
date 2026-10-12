// SPDX-License-Identifier: MPL-2.0

import { LumiError } from './protocol'
import type { HostInfo, Json, Theme } from './protocol'
import { SDK_CONTRACT } from './version'

export function createMock() {
  const theme: Theme = {
    mode: 'dark',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    tokens: {},
  }
  const info: HostInfo = {
    lumiVersion: SDK_CONTRACT.lumiVersion,
    sdkVersion: SDK_CONTRACT.sdkVersion,
    bridgeVersion: 1,
    projectId: 'mock',
    mode: 'mock',
  }
  const storage = new Map<string, Json>()
  return {
    theme,
    info,
    async request(method: string, args: Record<string, Json>): Promise<Json> {
      if (method === 'context.get')
        return {
          name: 'Lumi 本地模拟器',
          version: SDK_CONTRACT.lumiVersion,
          features: { capabilityDrafts: true, runnerExecution: false },
          mock: true,
        }
      if (method === 'capabilities.list') return []
      if (method === 'tools.list')
        return [
          {
            name: 'Lumi.create_capability_draft',
            description: '模拟创建草稿，不写入 Lumi',
            inputSchema: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['terminal', 'http', 'mcp'] },
                name: { type: 'string' },
              },
              required: ['kind', 'name'],
            },
            outputSchema: { type: 'object' },
          },
        ]
      if (method === 'tools.call') {
        if (args.name !== 'Lumi.create_capability_draft')
          throw new LumiError(
            'runner_execution_not_implemented_until_m4_m6',
            '模拟器未执行此工具。',
          )
        return { capability: { id: 'mock-draft', status: 'draft', enabled: false }, mock: true }
      }
      const key = String(args.key)
      if (method === 'storage.get') return storage.get(key) ?? null
      if (method === 'storage.set') {
        storage.set(key, args.value ?? null)
        return args.value ?? null
      }
      if (method === 'storage.delete') {
        storage.delete(key)
        return null
      }
      if (method === 'toast.show') {
        window.dispatchEvent(new CustomEvent('lumi:mock-toast', { detail: args }))
        return null
      }
      throw new LumiError('method_unavailable', '模拟器未实现此 SDK 方法。')
    },
  }
}
