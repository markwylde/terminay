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

/**
 * The same zoom step expressed as a scale, for surfaces (documentation) whose
 * base size differs from the terminal's. One step grows text by the same
 * proportion it grows a default-sized terminal.
 */
export function resolveTerminalZoomScale(zoomLevel: number | undefined): number {
  return resolveTerminalZoomedFontSize(13, zoomLevel) / 13
}
