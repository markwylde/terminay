/** Structural boundary kept Electron-free so the sender policy is directly
 * testable. The main process supplies the BrowserWindow and navigation rules. */
export type TrustedIpcSenderEvent = Readonly<{
  sender: Readonly<{ mainFrame: unknown }>
  senderFrame: Readonly<{ url: string }> | null
}>

export function assertTrustedIpcSender(
  event: TrustedIpcSenderEvent,
  options: Readonly<{
    isKnownWindow: (sender: TrustedIpcSenderEvent['sender']) => boolean
    isAllowedNavigation: (url: string) => boolean
  }>,
): void {
  if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) throw new Error('IPC sender must be the top-level renderer frame')
  if (!options.isKnownWindow(event.sender)) throw new Error('IPC sender is not a registered BrowserWindow')
  if (!options.isAllowedNavigation(event.senderFrame.url)) throw new Error('IPC sender is not on the Terminay application origin')
}
