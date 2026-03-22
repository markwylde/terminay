export type AppCommand =
  | 'new-terminal'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'

export type TerminalDataMessage = {
  id: string
  data: string
}

export type TerminalExitMessage = {
  id: string
  exitCode: number
}

export interface TermideApi {
  createTerminal: () => Promise<{ id: string }>
  writeTerminal: (id: string, data: string) => void
  resizeTerminal: (id: string, cols: number, rows: number) => void
  killTerminal: (id: string) => void
  onTerminalData: (listener: (message: TerminalDataMessage) => void) => () => void
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => () => void
  onAppCommand: (listener: (command: AppCommand) => void) => () => void
}
