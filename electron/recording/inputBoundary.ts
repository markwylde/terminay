export type TerminalInputRecordingBoundary = {
  appendInput: (sessionId: string, data: string) => void
}

/**
 * The single privileged boundary for data entering a PTY.
 *
 * Renderer IPC, macros, dictation, MCP requests, and authenticated remote input
 * all terminate here so capture policy is applied once before the PTY write.
 */
export function writeRecordedTerminalInput(
  recorder: TerminalInputRecordingBoundary,
  sessionId: string,
  data: string,
  writeToPty: (data: string) => void,
): void {
  recorder.appendInput(sessionId, data)
  writeToPty(data)
}
