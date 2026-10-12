// SPDX-License-Identifier: MPL-2.0

export function advanceGraphFlow(
  offset: number,
  elapsedMs: number,
  screenPixelsPerSecond: number,
  zoom: number,
): number {
  if (zoom <= 0 || !Number.isFinite(zoom)) return offset
  // Cap stalled frames to avoid a visible jump when rendering resumes.
  const elapsed = Math.max(0, Math.min(elapsedMs, 100))
  return (offset - (elapsed * screenPixelsPerSecond) / (1000 * zoom)) % 24
}
