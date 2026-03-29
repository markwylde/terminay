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

export type SettingsChangeMessage = {
  settings: import('./settings').TerminalSettings
}

export interface TermideApi {
  quitApp: () => Promise<void>
  createTerminal: () => Promise<{ id: string }>
  writeTerminal: (id: string, data: string) => void
  resizeTerminal: (id: string, cols: number, rows: number) => void
  killTerminal: (id: string) => void
  getTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  updateTerminalSettings: (
    settings: import('./settings').TerminalSettings,
  ) => Promise<import('./settings').TerminalSettings>
  resetTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  onTerminalData: (listener: (message: TerminalDataMessage) => void) => () => void
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => () => void
  onAppCommand: (listener: (command: AppCommand) => void) => () => void
  onTerminalSettingsChanged: (listener: (message: SettingsChangeMessage) => void) => () => void
}
