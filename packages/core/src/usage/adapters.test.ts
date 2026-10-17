// SPDX-License-Identifier: MPL-2.0
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLine, cursorRecord, type ParserState } from './adapters'
function fixture(name: string) {
  return readFileSync(path.join(__dirname, `fixtures/${name}.jsonl`), 'utf8')
    .trim()
    .split('\n')
}
function parse(lines: string[], software: 'codex' | 'claude' = 'codex') {
  const state: ParserState = {}
  return lines.flatMap((line) => parseLine(software, line, state, 'file'))
}
describe('usage adapters with synthetic fixtures', () => {
  it('turns cumulative 100 → 160 into 100 + 60 with cache already in input', () => {
    const rows = parse(fixture('codex'))
    expect(rows.map((x) => x.total)).toEqual([100, 60])
    expect(rows.map((x) => x.input)).toEqual([80, 50])
    expect(rows.map((x) => x.cacheRead)).toEqual([30, 20])
  })
  it('splits counter reset into a fresh cycle and ignores unchanged counters', () => {
    const lines = fixture('codex')
    expect(
      parse([...lines, lines[3]!, lines[2]!.replace('01:00', '03:00')]).map((x) => x.total),
    ).toEqual([100, 60, 100])
  })
  it('uses stable identities across rotated copies and fork replay', () => {
    const lines = fixture('codex')
    const fork = [...lines]
    fork[0] = JSON.stringify({
      ...JSON.parse(fork[0]!),
      payload: { id: 'fork-session', forked_from_id: 'synthetic-session' },
    })
    expect(parse(lines).map((x) => x.id)).toEqual(parse(fork).map((x) => x.id))
  })
  it('does not restart a cumulative cycle when only a cache subcounter falls', () => {
    const lines = fixture('codex')
    lines[3] = lines[3]!.replace('"cached_input_tokens":50', '"cached_input_tokens":5')
    const rows = parse(lines)
    expect(rows.map((row) => row.total)).toEqual([100, 60])
    expect(rows[1]!.cacheRead).toBeNull()
  })
  it('keeps missing usage unknown and never estimates body text', () => {
    const row = parse([
      '{"type":"event_msg","timestamp":"2026-10-10T01:00:00Z","payload":{"type":"token_count","info":null}}',
    ])[0]!
    expect(row.total).toBeNull()
    expect(row.input).toBeNull()
    expect(row.quality).toBe('missing')
  })
  it('upserts Claude streaming final values; cache fields are mutually exclusive', () => {
    const rows = parse(fixture('claude'), 'claude')
    expect(rows[0]!.id).toBe(rows[1]!.id)
    expect(rows[1]!.total).toBe(100)
    expect(rows[1]!.inputIncludesCache).toBe(false)
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_CONTENT')
  })
  it('preserves absent cache as null; rejects invalid counters and timestamps', () => {
    const line = fixture('claude')[1]!.replace(
      ',"cache_read_input_tokens":30,"cache_creation_input_tokens":20',
      '',
    )
    expect(parse([line], 'claude')[0]!.total).toBeNull()
    expect(
      parse([line.replace('"input_tokens":10', '"input_tokens":-1')], 'claude')[0]!.input,
    ).toBeNull()
    expect(parse([line.replace('2026-10-10T01:00:01Z', 'invalid')], 'claude')).toEqual([])
  })
  it('ignores Codex token_count twin after authoritative response usage', () => {
    const lines = fixture('codex')
    const row = JSON.stringify({
      type: 'token_usage_record',
      timestamp: '2026-10-10T01:00:00Z',
      payload: {
        response_id: 'response-1',
        usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 },
      },
    })
    expect(parse([row, ...lines]).map((x) => x.total)).toEqual([100])
  })
  it('Cursor zero placeholders and context meters are never reported totals', () => {
    expect(
      cursorRecord({ key: 'bubbleId:s:b', time: '2026-10-10T00:00:00Z', input: 0, output: 0 })!
        .total,
    ).toBeNull()
    expect(
      cursorRecord({ key: 'composerData:s', time: '2026-10-10T00:00:00Z', context: 200 })!.quality,
    ).toBe('context_snapshot')
    expect(
      cursorRecord({ key: 'bubbleId:s:b', time: '2026-10-10T00:00:00Z', input: 12, output: 8 })!
        .total,
    ).toBe(20)
  })
})
