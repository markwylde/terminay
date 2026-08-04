export type TerminalPresentationMetadata = Readonly<{
  title?: string
  emoji?: string
  color?: string
  inheritsProjectColor?: boolean
  viewportWidth?: number
  viewportHeight?: number
  projectId?: string
  projectTitle?: string
  projectEmoji?: string
  projectColor?: string
}>

/** Native terminal presentation is optional in the static web host. */
export function publishTerminalPresentationMetadata(
  sessionId: string,
  metadata: TerminalPresentationMetadata,
): void {
  window.terminayTerminalPresentationHost?.updateMetadata(sessionId, metadata)
}
