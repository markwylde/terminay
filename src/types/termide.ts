export type AppCommand =
  | 'new-terminal'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'
  | 'open-macro-launcher'

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

export type MacrosChangeMessage = {
  macros: import('./macros').MacroDefinition[]
}

export interface TermideApi {
  quitApp: () => Promise<void>
  createTerminal: (options?: { cwd?: string }) => Promise<{ id: string }>
  getTerminalCwd: (id: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  writeTerminal: (id: string, data: string) => void
  resizeTerminal: (id: string, cols: number, rows: number) => void
  killTerminal: (id: string) => void
  getTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  updateTerminalSettings: (
    settings: import('./settings').TerminalSettings,
  ) => Promise<import('./settings').TerminalSettings>
  resetTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  getMacros: () => Promise<import('./macros').MacroDefinition[]>
  updateMacros: (macros: import('./macros').MacroDefinition[]) => Promise<import('./macros').MacroDefinition[]>
  resetMacros: () => Promise<import('./macros').MacroDefinition[]>
  onTerminalData: (listener: (message: TerminalDataMessage) => void) => () => void
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => () => void
  onAppCommand: (listener: (command: AppCommand) => void) => () => void
  onTerminalSettingsChanged: (listener: (message: SettingsChangeMessage) => void) => () => void
  onMacrosChanged: (listener: (message: MacrosChangeMessage) => void) => () => void
}
