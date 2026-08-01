import {
  buildTerminalOptions,
  resolveTerminalTheme,
} from '../terminalSettings'
import type { TerminalSettings } from '../types/settings'
import { resolveTerminalZoomedFontSize } from './terminalZoomInteraction'

/**
 * Build the presentation-only portion of an xterm update. Keeping this
 * separate from a panel attachment makes it explicit that a theme, tab colour,
 * or host zoom change never needs to recreate, resize, or write to the PTY.
 */
export function buildTerminalPresentationOptions(
  settings: TerminalSettings,
  tabColor: string | undefined,
  zoomLevel: number | undefined,
) {
  return {
    ...buildTerminalOptions(settings),
    fontSize: resolveTerminalZoomedFontSize(settings.fontSize, zoomLevel),
    theme: resolveTerminalTheme(settings, tabColor),
  }
}
