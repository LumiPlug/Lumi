// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest'
import { terminalOutputText, terminalOutputRuns, terminalOutputLines } from './terminal-output'

describe('terminal output text', () => {
  it('interprets SGR colors, independent resets and styles across line boundaries', () => {
    const runs = terminalOutputRuns(
      '\u001b[1;31;44m红色\n仍然红色\u001b[39;22m只保留背景\u001b[0m默认',
    )
    expect(runs).toEqual([
      {
        text: '红色\n仍然红色',
        style: {
          bold: true,
          foreground: 'var(--lumi-terminal-1)',
          background: 'var(--lumi-terminal-4)',
        },
      },
      { text: '只保留背景', style: { background: 'var(--lumi-terminal-4)' } },
      { text: '默认', style: {} },
    ])
    expect(terminalOutputLines('\u001b[32m第一行\n第二行\n')).toEqual([
      [{ text: '第一行', style: { foreground: 'var(--lumi-terminal-2)' } }],
      [{ text: '第二行', style: { foreground: 'var(--lumi-terminal-2)' } }],
    ])
  })
  it('supports bright, 256-color, RGB and common text attributes', () => {
    expect(terminalOutputRuns('\u001b[91;104;2;3;4;7;9m样式')[0]?.style).toEqual({
      foreground: 'var(--lumi-terminal-9)',
      background: 'var(--lumi-terminal-12)',
      dim: true,
      italic: true,
      underline: true,
      inverse: true,
      strike: true,
    })
    expect(terminalOutputRuns('\u001b[38;5;208;48;5;244m色彩')[0]?.style).toEqual({
      foreground: 'rgb(255, 135, 0)',
      background: 'rgb(128, 128, 128)',
    })
    expect(terminalOutputRuns('\u001b[38;2;12;34;56;48;2;78;90;123mRGB')[0]?.style).toEqual({
      foreground: 'rgb(12, 34, 56)',
      background: 'rgb(78, 90, 123)',
    })
    expect(terminalOutputRuns('\u001b[38:2::12:34:56mRGB')[0]?.style).toEqual({
      foreground: 'rgb(12, 34, 56)',
    })
    expect(terminalOutputRuns('\u001b[38;5;999m无效')[0]?.style).toEqual({})
    expect(terminalOutputRuns('\u001b[2;3;4;7;9;22;23;24;27;29m重置')[0]?.style).toEqual({})
  })
  it('removes the color controls in actual server output without removing Unicode', () => {
    const content = '中文 ✓ 🚀 👩🏽‍💻 ❤️ 🇨🇳 e\u0301'
    expect(terminalOutputText(`\u001b[32mINFO\u001b[39m \u001b[36m${content}\u001b[0m`)).toBe(
      `INFO ${content}`,
    )
  })
  it('preserves hyperlink labels and removes OSC payloads with either terminator', () => {
    expect(
      terminalOutputText(
        '\u001b]0;窗口标题\u0007\u001b]8;;https://example.com\u001b\\查看日志🔍\u001b]8;;\u0007',
      ),
    ).toBe('查看日志🔍')
    expect(terminalOutputText('\u009d8;;https://example.com\u009c链接\u009d8;;\u009c')).toBe('链接')
  })
  it('hides partial streamed controls and shows the next complete snapshot correctly', () => {
    for (const partial of [
      '\u001b',
      '\u001b[',
      '\u001b[38;2;12',
      '\u001b]8;;url',
      '\u001bPpayload',
    ])
      expect(terminalOutputText(`已启动🚀${partial}`)).toBe('已启动🚀')
    expect(terminalOutputText('已启动🚀\u001b[38;2;12;34;56m继续输出')).toBe('已启动🚀继续输出')
  })
  it('omits cursor and non-printing controls while keeping tabs and line boundaries', () => {
    expect(terminalOutputText('a\u001b[2K\u001b[1G\u0007\u0000\u007fb\r\n\t中文\rnext')).toBe(
      'ab\n\t中文\nnext',
    )
    expect(terminalOutputText('\u001b(B普通文本\u001b7')).toBe('普通文本')
    expect(terminalOutputText('文字\u001bP隐藏\u001b\\结束')).toBe('文字结束')
  })
})
