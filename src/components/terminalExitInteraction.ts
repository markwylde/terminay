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
