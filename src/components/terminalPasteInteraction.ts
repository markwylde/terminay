/**
 * Clipboard paste is UI behaviour, not terminal transport authority. Keep its
 * failure handling separate so a denied or malformed clipboard read never
 * leaves a server-backed terminal input queue in an indeterminate state.
 */
export function shouldHandleTerminalPasteShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  isMac: boolean,
): boolean {
  const key = event.key.toLowerCase()
  if (key !== 'v' || event.altKey) return false

  // On macOS, leave Cmd+V to Chromium. This is the same native paste route as
  // Edit > Paste and does not depend on renderer Clipboard API permission.
  if (isMac && event.metaKey && !event.ctrlKey && !event.shiftKey) return false

  return (
    (event.ctrlKey && event.shiftKey && !event.metaKey) ||
    (!isMac && event.metaKey && !event.ctrlKey && !event.shiftKey)
  )
}

export async function pasteTerminalClipboard(
  readClipboardText: () => Promise<unknown> | unknown,
  options: {
    readonly announceInput: () => void
    readonly paste: (text: string) => void
    readonly focus: () => void
  },
): Promise<boolean> {
  try {
    const pasted = await readClipboardText()
    if (typeof pasted !== 'string' || pasted.length === 0) {
      return false
    }

    options.announceInput()
    options.paste(pasted)
    return true
  } catch {
    // Reading the system clipboard is recoverable. Refocus the xterm surface
    // and leave transport delivery entirely to xterm's ordinary onData path.
    options.focus()
    return false
  }
}
