// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { homeBridgeRequest } from './home-bridge'
describe('homepage message boundary', () => {
  it('only accepts bounded SDK requests and rejects privileged or malformed messages', () => {
    expect(
      homeBridgeRequest({
        id: 1,
        method: 'tools.call',
        args: { name: 'Lumi.get_context', arguments: {} },
      }),
    ).not.toBeNull()
    for (const value of [
      null,
      [],
      { id: 0, method: 'context.get', args: {} },
      { id: 1, method: 'get_mcp_connection_info', args: {} },
      { id: 1, method: 'tools.call', args: [] },
      { id: 1, method: 'storage.set', args: { key: 'x', value: 'x'.repeat(70 * 1024) } },
    ])
      expect(homeBridgeRequest(value)).toBeNull()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(homeBridgeRequest({ id: 1, method: 'storage.set', args: cyclic })).toBeNull()
  })
})
