export type TerminalMultilineKeyEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
>

/**
 * Reserve exactly one modified Enter chord for a literal newline in the
 * current terminal command buffer.  Broader chords remain available to the
 * host, editor, and accessibility tooling rather than being silently routed
 * to a shell.
 */
export function shouldInsertTerminalMultilineNewline(
  event: TerminalMultilineKeyEvent,
): boolean {
  if (event.repeat || event.key !== 'Enter' || event.ctrlKey || event.metaKey) {
    return false
  }

  return event.shiftKey !== event.altKey
}
