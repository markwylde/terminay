/**
 * Terminal selection copies are deliberately UI-only. A clipboard denial must
 * not affect the terminal attachment or make the next copy impossible.
 */
export async function copyTerminalSelection(
  selectedText: string,
  writeClipboardText: (text: string) => Promise<void> | void,
): Promise<boolean> {
  if (selectedText.length === 0) {
    return false
  }

  try {
    await writeClipboardText(selectedText)
    return true
  } catch {
    // Clipboard permissions and platform clipboard services are independent of
    // the terminal transport. Treat a failure as recoverable so the user can
    // immediately select/copy again after correcting it.
    return false
  }
}
