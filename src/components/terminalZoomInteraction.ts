/**
 * Terminal zoom is host presentation state, but it must never be allowed to
 * turn an xterm font size into NaN/Infinity. Keep the policy independent of
 * Electron and xterm so every terminal surface applies the same safe value.
 */
export function resolveTerminalZoomedFontSize(
  baseFontSize: number | undefined,
  zoomLevel: number | undefined,
): number {
  const base =
    typeof baseFontSize === 'number' && Number.isFinite(baseFontSize)
      ? baseFontSize
      : 13
  const zoom =
    typeof zoomLevel === 'number' && Number.isFinite(zoomLevel)
      ? zoomLevel
      : 0

  return Math.max(6, base + zoom)
}
