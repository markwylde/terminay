export const BRACKETED_PASTE_START = '\x1b[200~'
export const BRACKETED_PASTE_END = '\x1b[201~'

export function formatBracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`
}

export function formatRunCommandInput(command: string): string {
  if (!/[\r\n]/.test(command)) {
    return command
  }

  return formatBracketedPaste(command)
}
