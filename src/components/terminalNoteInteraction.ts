/**
 * Terminal notes are panel metadata, never terminal input. Keep the small
 * keyboard policy separate from the xterm event hook so it can be verified
 * without Dockview, Electron, or a live terminal.
 */
export interface TerminalNoteKeyEvent {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/**
 * Escape is an intentional, unmodified way to return from the note editor to
 * its terminal. Modified Escape chords stay available to the host/platform.
 */
export function shouldReturnFocusToTerminalFromNote(event: TerminalNoteKeyEvent): boolean {
  return (
    event.key === 'Escape' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  )
}
