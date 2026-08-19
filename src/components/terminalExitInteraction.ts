/**
 * Terminal exits are transport events, but their presentation belongs to the
 * terminal surface. Keep the decision small and renderer-neutral so a bad
 * runtime payload cannot leave an xterm panel with an ambiguous or malformed
 * exit line.
 */
export type TerminalExitPresentation = {
  readonly autoCloseOnSuccessfulExit: boolean
  readonly exitCode: number
  readonly signal: number | null
}

function formatExitValue(value: number): string {
  return Number.isInteger(value) ? String(value) : 'unknown'
}

/**
 * A successful normal exit is handled by the terminal-tab lifecycle setting;
 * it must not also leave a stale red error line in a panel that is closing.
 */
export function shouldSuppressTerminalExitNotice(exit: TerminalExitPresentation): boolean {
  return exit.autoCloseOnSuccessfulExit && exit.exitCode === 0 && exit.signal === null
}

/** Return the exact ANSI-safe notice for an exit that remains visible. */
export function formatTerminalExitNotice(exit: TerminalExitPresentation): string | null {
  if (shouldSuppressTerminalExitNotice(exit)) {
    return null
  }

  const exitDescription =
    exit.signal === null
      ? `code ${formatExitValue(exit.exitCode)}`
      : `signal ${formatExitValue(exit.signal)} (code ${formatExitValue(exit.exitCode)})`

  return `\r\n\x1b[31m[process exited with ${exitDescription}]\x1b[0m\r\n`
}

/** Attach/input failures that mean the PTY is gone, not that the workspace
 * transport needs replacement. */
export function isTerminalSessionEndedError(error: unknown): boolean {
  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message)
      current = current.cause
      continue
    }
    messages.push(String(current))
    break
  }
  return messages.some((message) =>
    /session has exited|session_exited|session was interrupted|session_interrupted|session_not_found|terminal session not found/iu.test(
      message,
    ),
  )
}
