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

export type RemoteAccessStatus = {
  activeConnectionCount: number
  auditEvents: Array<{
    action:
      | 'pairing-completed'
      | 'auth-verified'
      | 'device-revoked'
      | 'connection-opened'
      | 'connection-closed'
      | 'connection-revoked'
    connectionId: string | null
    deviceId: string | null
    deviceName: string | null
    occurredAt: string
  }>
  connections: Array<{
    attachedSessionCount: number
    connectionId: string
    deviceId: string
    deviceName: string
  }>
  availableAddresses: string[]
  configurationIssue: string | null
  configurationPath: string
  errorMessage: string | null
  isRunning: boolean
  origin: string | null
  pairedDeviceCount: number
  pairedDevices: Array<{
    addedAt: string
    deviceId: string
    lastSeenAt: string | null
    name: string
    origin: string
  }>
  pairingExpiresAt: string | null
  pairingQrCodeDataUrl: string | null
  pairingQrCodePath: string | null
  pairingUrl: string | null
}

export type FileExplorerEntry = {
  isDirectory: boolean
  isSymbolicLink: boolean
  name: string
  path: string
}

export type TerminalZoomMessage = {
  zoomLevel: number
}

export interface TermideApi {
  getHomePath: () => Promise<string>
  listDirectory: (dirPath: string) => Promise<FileExplorerEntry[]>
  quitApp: () => Promise<void>
  createTerminal: (options?: { cwd?: string }) => Promise<{ id: string }>
  getTerminalCwd: (id: string) => Promise<string | null>
  getPathForFile: (file: File) => string
  writeTerminal: (id: string, data: string) => void
  resizeTerminal: (id: string, cols: number, rows: number) => void
  killTerminal: (id: string) => void
  updateTerminalRemoteMetadata: (
    id: string,
    metadata: {
      title?: string
      emoji?: string
      color?: string
      viewportWidth?: number
      viewportHeight?: number
      projectId?: string
      projectTitle?: string
      projectEmoji?: string
      projectColor?: string
    },
  ) => void
  getTerminalZoom: () => Promise<number>
  getTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  updateTerminalSettings: (
    settings: import('./settings').TerminalSettings,
  ) => Promise<import('./settings').TerminalSettings>
  resetTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  getMacros: () => Promise<import('./macros').MacroDefinition[]>
  updateMacros: (macros: import('./macros').MacroDefinition[]) => Promise<import('./macros').MacroDefinition[]>
  resetMacros: () => Promise<import('./macros').MacroDefinition[]>
  getSecrets: () => Promise<import('./macros').SecretDefinition[]>
  saveSecret: (name: string, value: string) => Promise<import('./macros').SecretDefinition>
  deleteSecret: (id: string) => Promise<void>
  getDecryptedSecret: (id: string) => Promise<string>
  waitForTerminalInactivity: (id: string, durationMs: number) => Promise<void>
  smartPasteClipboard: () => Promise<string>
  openExternal: (url: string) => Promise<void>
  openSettingsWindow: (options?: { sectionId?: string }) => Promise<void>
  getRemoteAccessStatus: () => Promise<RemoteAccessStatus>
  toggleRemoteAccessServer: () => Promise<RemoteAccessStatus>
  revokeRemoteAccessDevice: (deviceId: string) => Promise<RemoteAccessStatus>
  closeRemoteAccessConnection: (connectionId: string) => Promise<RemoteAccessStatus>
  setRemoteAccessPairingAddress: (address: string) => Promise<RemoteAccessStatus>
  onTerminalData: (listener: (message: TerminalDataMessage) => void) => () => void
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => () => void
  onAppCommand: (listener: (command: AppCommand) => void) => () => void
  onTerminalSettingsChanged: (listener: (message: SettingsChangeMessage) => void) => () => void
  onMacrosChanged: (listener: (message: MacrosChangeMessage) => void) => () => void
  onRemoteAccessStatusChanged: (listener: (status: RemoteAccessStatus) => void) => () => void
  onTerminalZoomChanged: (listener: (message: TerminalZoomMessage) => void) => () => void
  onSettingsFocusSection: (listener: (message: { sectionId: string }) => void) => () => void
}
