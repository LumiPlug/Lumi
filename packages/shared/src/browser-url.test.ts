// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest'
import { normalizeBrowserUrl, normalizeBrowserBlockedUrls } from './browser-url'

describe('exact Browser User URL policy identity', () => {
  it.each([
    ['https://EXAMPLE.com:443/a?private=1#fragment', 'https://example.com/a'],
    ['http://example.com:80/a/?x=1', 'http://example.com/a/'],
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/a/../b?x=1', 'https://example.com/b'],
    ['https://example.com/%2F?q=1', 'https://example.com/%2F'],
    ['https://例子.测试/中文?x=1', 'https://xn--fsqu00a.xn--0zwm56d/%E4%B8%AD%E6%96%87'],
  ])('normalizes %s without query or fragment', (value, expected) => {
    expect(normalizeBrowserUrl(value)).toBe(expected)
  })
  it.each([
    'https://user:secret@example.com/a',
    'ftp://example.com/a',
    'file:///tmp/example',
    'javascript:alert(1)',
    'chrome://settings',
    '/relative',
    '',
  ])('rejects %s', (value) => {
    expect(() => normalizeBrowserUrl(value)).toThrow('browser_url_invalid')
  })
  it('keeps trailing slash, scheme and path case distinct; deduplicates only exact links', () => {
    expect(
      normalizeBrowserBlockedUrls([
        'https://example.com/a?one=1',
        'https://example.com/a#two',
        'https://example.com/a/',
        'http://example.com/a',
        'https://example.com/A',
      ]),
    ).toEqual([
      'http://example.com/a',
      'https://example.com/A',
      'https://example.com/a',
      'https://example.com/a/',
    ])
  })
  it('bounds entries and canonicalized URL length', () => {
    expect(() => normalizeBrowserBlockedUrls(Array(101).fill('https://example.test'))).toThrow()
    expect(() =>
      normalizeBrowserBlockedUrls(['https://example.test/' + 'x'.repeat(2048)]),
    ).toThrow()
    expect(() =>
      normalizeBrowserBlockedUrls(['https://example.test/' + '中'.repeat(250)]),
    ).toThrow()
  })
})
