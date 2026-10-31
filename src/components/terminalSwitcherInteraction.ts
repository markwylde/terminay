export type TerminalSwitcherShortcutEvent = {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly repeat: boolean
  readonly shiftKey: boolean
}

/** The modifier held with Tab to switch terminals. Windows and most Linux
 * desktops take Alt+Tab for their own window switching, so a Desktop window
 * there uses Ctrl+Tab. macOS Desktop and browsers, where the browser owns
 * Ctrl+Tab, use Alt (Option) +Tab. */
export type TerminalSwitcherModifier = 'alt' | 'ctrl'

export function terminalSwitcherModifier(host: {
  readonly isDesktop: boolean
  readonly platform: string
}): TerminalSwitcherModifier {
  return host.isDesktop && !host.platform.toLowerCase().includes('mac')
    ? 'ctrl'
    : 'alt'
}

/** This document's modifier: Desktop windows carry the host bridge. */
export function currentTerminalSwitcherModifier(): TerminalSwitcherModifier {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return 'alt'
  return terminalSwitcherModifier({
    isDesktop: window.terminayHost !== undefined,
    platform: navigator.platform,
  })
}

/** The key whose release commits the switch, as `KeyboardEvent.key` names it. */
export function terminalSwitcherReleaseKey(
  modifier: TerminalSwitcherModifier,
): 'Alt' | 'Control' {
  return modifier === 'ctrl' ? 'Control' : 'Alt'
}

/** The heading's chord and hint, in the platform's own words. */
export function terminalSwitcherLabels(modifier: TerminalSwitcherModifier): {
  readonly chord: string
  readonly hint: string
} {
  return modifier === 'ctrl'
    ? { chord: 'Ctrl+Tab', hint: 'Release Ctrl to switch' }
    : { chord: 'Alt+Tab', hint: 'Release Alt to switch' }
}

/**
 * Keep terminal switching a host-level navigation gesture rather than terminal
 * input. Only the switcher modifier with Tab (and optionally Shift) is
 * claimed, so browser/desktop accelerators and shell chords with additional
 * modifiers remain available.
 */
export function getTerminalSwitcherDirection(
  event: TerminalSwitcherShortcutEvent,
  modifier: TerminalSwitcherModifier = 'alt',
): -1 | 1 | null {
  const held = modifier === 'ctrl' ? event.ctrlKey : event.altKey
  const other = modifier === 'ctrl' ? event.altKey : event.ctrlKey
  if (
    event.repeat ||
    !held ||
    other ||
    event.metaKey ||
    event.key.toLowerCase() !== 'tab'
  ) {
    return null
  }

  return event.shiftKey ? -1 : 1
}
