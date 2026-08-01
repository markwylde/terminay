/**
 * Keep the terminal's in-buffer search shortcut out of the shell on every
 * supported desktop platform. TerminalPanel's keyboard hook receives a
 * browser KeyboardEvent, but this deliberately small shape makes the policy
 * directly testable without xterm or Electron.
 */
export interface TerminalSearchShortcutEvent {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export function isTerminalSearchShortcut(
  event: TerminalSearchShortcutEvent,
  options: { readonly isMac: boolean },
): boolean {
  if (event.key.toLowerCase() !== 'f' || event.altKey || event.shiftKey) {
    return false
  }

  // Avoid accepting mixed Ctrl+Cmd chords: those are application shortcuts,
  // not a portable request to intercept terminal input.
  return options.isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}
