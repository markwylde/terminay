export type TerminalScrollbackShortcutEvent = {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly repeat: boolean
  readonly shiftKey: boolean
}

export type TerminalScrollbackAction = 'page-down' | 'page-up' | 'bottom' | 'top'

/**
 * Keep scrollback navigation inside the xterm viewport. These are deliberate
 * view-only shortcuts: they never write terminal input or ask the host to
 * mutate a server-owned session. Extra modifiers and auto-repeat remain with
 * the shell/host so split panels cannot unexpectedly consume their shortcuts.
 */
export function getTerminalScrollbackAction(
  event: TerminalScrollbackShortcutEvent,
): TerminalScrollbackAction | null {
  if (
    event.repeat ||
    !event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null
  }

  switch (event.key.toLowerCase()) {
    case 'pageup':
      return 'page-up'
    case 'pagedown':
      return 'page-down'
    case 'home':
      return 'top'
    case 'end':
      return 'bottom'
    default:
      return null
  }
}
