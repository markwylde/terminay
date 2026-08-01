/**
 * Clearing xterm is strictly viewport presentation.  It must be scoped to the
 * exact terminal panel and must never become terminal input, a PTY reset, or a
 * host IPC request.
 */
export function shouldClearTerminalForSession(
  eventSessionId: unknown,
  terminalSessionId: string,
): boolean {
  return typeof eventSessionId === 'string' && eventSessionId === terminalSessionId
}

/**
 * Keep the imperative xterm work in one small, transport-neutral operation so
 * callers cannot accidentally clear a different panel or skip restoring focus.
 */
export function clearTerminalViewport(actions: {
  readonly clear: () => void
  readonly focus: () => void
  readonly announceFocus: () => void
}): void {
  actions.clear()
  actions.focus()
  actions.announceFocus()
}
