export type TerminalSwitcherShortcutEvent = {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly repeat: boolean
  readonly shiftKey: boolean
}

/**
 * Keep terminal switching a host-level navigation gesture rather than terminal
 * input. Only the unmodified Alt+Tab chord is claimed, so browser/desktop
 * accelerators and shell chords with additional modifiers remain available.
 */
export function getTerminalSwitcherDirection(
  event: TerminalSwitcherShortcutEvent,
): -1 | 1 | null {
  if (
    event.repeat ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.key.toLowerCase() !== 'tab'
  ) {
    return null
  }

  return event.shiftKey ? -1 : 1
}
