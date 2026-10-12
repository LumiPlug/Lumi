// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest'
import { parseConfig } from './index'

const token = '0123456789abcdef0123456789abcdef'

describe('stdio proxy connection configuration', () => {
  it('accepts the shared session token via environment and canonicalizes the loopback origin', () => {
    expect(
      parseConfig(['--core-url', 'http://127.0.0.1:34567/'], { LUMIPLUG_SESSION_TOKEN: token }),
    ).toEqual({ coreUrl: 'http://127.0.0.1:34567', sessionToken: token, requestTimeoutMs: 310000 })
  })

  it.each([
    'http://remote.example:34567',
    'https://127.0.0.1:34567',
    'http://user:password@127.0.0.1:34567',
    'http://127.0.0.1:34567/mcp',
    'http://127.0.0.1:34567?token=private',
    'http://127.0.0.1:34567/#fragment',
  ])('rejects invalid Core destinations: %s', (url) => {
    expect(() => parseConfig(['--core-url', url], { LUMIPLUG_SESSION_TOKEN: token })).toThrow(
      'proxy_requires_loopback_url',
    )
  })

  it('does not report credentials when configuration is missing or malformed', () => {
    expect(() => parseConfig([], {})).toThrow('proxy_configuration_missing')
    expect(() =>
      parseConfig(['--core-url', 'http://127.0.0.1:34567'], {
        LUMIPLUG_SESSION_TOKEN: `${token}\r\nsecret`,
      }),
    ).toThrow('proxy_configuration_missing')
  })
})
