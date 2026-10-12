// SPDX-License-Identifier: MPL-2.0
export type TerminalStyle = {
  foreground?: string
  background?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  inverse?: boolean
}
export type TerminalRun = { text: string; style: TerminalStyle }

function paletteColor(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined
  if (index < 16) return `var(--lumi-terminal-${index})`
  if (index >= 232) {
    const value = 8 + (index - 232) * 10
    return `rgb(${value}, ${value}, ${value})`
  }
  const levels = [0, 95, 135, 175, 215, 255]
  const value = index - 16
  return `rgb(${levels[Math.floor(value / 36)]}, ${levels[Math.floor(value / 6) % 6]}, ${levels[value % 6]})`
}
function applyStyle(style: TerminalStyle, parameters: string): TerminalStyle {
  // Colon-separated truecolor may include an empty color-space identifier.
  const codes = parameters.replaceAll(':2::', ':2:').split(/[;:]/).map(Number)
  let next = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) next = {}
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 7) next.inverse = true
    else if (code === 9) next.strike = true
    else if (code === 22) {
      delete next.bold
      delete next.dim
    } else if (code === 23) delete next.italic
    else if (code === 24) delete next.underline
    else if (code === 27) delete next.inverse
    else if (code === 29) delete next.strike
    else if (code === 39) delete next.foreground
    else if (code === 49) delete next.background
    else if (code >= 30 && code <= 37) next.foreground = paletteColor(code - 30)
    else if (code >= 40 && code <= 47) next.background = paletteColor(code - 40)
    else if (code >= 90 && code <= 97) next.foreground = paletteColor(code - 90 + 8)
    else if (code >= 100 && code <= 107) next.background = paletteColor(code - 100 + 8)
    else if (code === 38 || code === 48) {
      const channel = code === 38 ? 'foreground' : 'background'
      const mode = codes[++i]
      if (mode === 5) {
        const color = paletteColor(codes[++i]!)
        if (color) next[channel] = color
      } else if (mode === 2) {
        const values = codes.slice(i + 1, i + 4)
        if (values.length === 3 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
          next[channel] = `rgb(${values.join(', ')})`
        i += 3
      }
    }
  }
  return next
}

/** Parse terminal controls as text and SGR styles; no HTML or terminal side effects. */
export function terminalOutputRuns(raw: string): TerminalRun[] {
  const text = raw.replace(/\r\n?/g, '\n')
  const runs: TerminalRun[] = []
  let buffer = '',
    style: TerminalStyle = {}
  const flush = () => {
    if (buffer) runs.push({ text: buffer, style: { ...style } })
    buffer = ''
  }
  for (let i = 0; i < text.length;) {
    const code = text.charCodeAt(i++)
    let control = code
    if (code === 0x1b) {
      if (i === text.length) break
      const next = text.charCodeAt(i)
      if (next >= 0x40 && next <= 0x5f) {
        control = next + 0x40
        i++
      } else {
        while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) i++
        if (i < text.length && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x7e) i++
        continue
      }
    }
    if (control === 0x9b) {
      const start = i
      while (i < text.length) {
        const part = text.charCodeAt(i++)
        if (part >= 0x40 && part <= 0x7e) {
          if (part === 0x6d) {
            flush()
            style = applyStyle(style, text.slice(start, i - 1))
          }
          break
        }
      }
      continue
    }
    if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(control)) {
      while (i < text.length) {
        const part = text.charCodeAt(i++)
        if (part === 0x9c || (control === 0x9d && part === 7)) break
        if (part === 0x1b && text[i] === '\\') {
          i++
          break
        }
      }
      continue
    }
    if (code < 0x20 && ![9, 10, 13].includes(code)) continue
    if (control >= 0x7f && control <= 0x9f) continue
    buffer += String.fromCharCode(code)
  }
  flush()
  return runs
}
export function terminalOutputText(text: string): string {
  return terminalOutputRuns(text)
    .map((run) => run.text)
    .join('')
}
export function terminalOutputLines(text: string): TerminalRun[][] {
  const lines: TerminalRun[][] = [[]]
  for (const run of terminalOutputRuns(text)) {
    const pieces = run.text.split('\n')
    pieces.forEach((piece, index) => {
      if (index) lines.push([])
      if (piece) lines.at(-1)!.push({ text: piece, style: run.style })
    })
  }
  if (lines.length > 1 && !lines.at(-1)!.length) lines.pop()
  return lines
}
