export type AppCommand =
  | 'new-terminal'
  | 'new-project'
  | 'save-active'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'
  | 'open-command-bar'
  | 'clear-terminal'
  | 'set-project-root-folder-to-working-directory'

export type FileViewerTextEncoding = 'utf8' | 'utf-8' | 'utf16le' | 'utf-16le' | 'latin1' | 'ascii'

export type FileViewerFileInfo = {
  birthtimeMs: number | null
  ctimeMs: number | null
  exists: boolean
  extension: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
  mtimeMs: number | null
  name: string
  path: string
  size: number
}

export type FileViewerByteRange = {
  dataBase64: string
  eof: boolean
  length: number
  path: string
  start: number
  totalSize: number
}

export type FileViewerTextRange = {
  encoding: FileViewerTextEncoding
  eof: boolean
  length: number
  path: string
  start: number
  text: string
  totalSize: number
}

export type FileViewerSaveRequest =
  | {
      data: string
      encoding?: FileViewerTextEncoding
      kind: 'text'
      path: string
    }
  | {
      dataBase64: string
      kind: 'base64'
      path: string
    }

export type FileViewerSaveResult = {
  byteLength: number
  path: string
  savedAt: string
  size: number
}

export type FileViewerWatchEvent = {
  event: 'changed' | 'deleted' | 'error' | 'renamed'
  exists: boolean
  info: FileViewerFileInfo | null
  message?: string
  path: string
}

export type FileViewerPreviewSource = {
  mimeType: string | null
  path: string
  url: string
}

export type FileViewerGitRepoInfo = {
  canDiff: boolean
  gitAvailable: boolean
  isTracked: boolean
  path: string
  relativePath: string | null
  repoRoot: string | null
}

export type FileViewerGitDiff = {
  compareTarget: 'HEAD'
  gitAvailable: boolean
  hasDiff: boolean
  isBinary: boolean
  path: string
  patch: string
  relativePath: string | null
  repoRoot: string | null
}

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

export type FileExplorerWatchEvent = {
  entryName?: string | null
  event: 'changed' | 'error'
  message?: string
  path: string
}

export type FileSearchResult = {
  isDirectory: boolean
  path: string
  relativePath: string
}

export type FileExplorerGitStatus = 'modified' | 'new'

export type FileExplorerGitStatuses = {
  gitAvailable: boolean
  repoRoot: string | null
  statuses: Record<string, FileExplorerGitStatus>
}

export type TerminalZoomMessage = {
  zoomLevel: number
}

export type AppUpdateStatus = {
  checkedAt: string | null
  currentVersion: string
  errorMessage: string | null
  hasUpdate: boolean
  latestVersion: string | null
  releaseUrl: string | null
}

export type AiTabMetadataProvider = 'claudeCode' | 'codex'

export type AiTabMetadataTarget = 'title' | 'note'

export type AiTabMetadataModel = {
  id: string
  label: string
}

export type AiTabMetadataContext = {
  currentTitle: string
  existingNote?: string
  projectRoot: string
  projectTitle: string
  recentOutput: string
  sessionId: string
}

export type AiTabMetadataGenerateRequest = {
  context: AiTabMetadataContext
  model: string
  provider: AiTabMetadataProvider
  target: AiTabMetadataTarget
}

export type AiTabMetadataGenerateResult = {
  text: string
}

export type ProjectEditWindowDraft = {
  color: string
  emoji: string
  rootFolder: string
  title: string
}

export type ProjectEditWindowResult = ProjectEditWindowDraft

export type TerminalEditWindowDraft = {
  activityIndicatorsEnabled: boolean
  color: string
  emoji: string
  inheritsProjectColor: boolean
  projectColor: string
  title: string
}

export type TerminalEditWindowResult = TerminalEditWindowDraft

export type EditWindowState =
  | {
      draft: ProjectEditWindowDraft
      kind: 'project'
    }
  | {
      draft: TerminalEditWindowDraft
      kind: 'terminal'
    }

export type EditWindowResult =
  | {
      result: ProjectEditWindowResult
      kind: 'project'
    }
  | {
      result: TerminalEditWindowResult
      kind: 'terminal'
    }

export interface TerminayApi {
  getHomePath: () => Promise<string>
  listDirectory: (dirPath: string) => Promise<FileExplorerEntry[]>
  searchFiles: (options: { rootPath: string; query: string; limit?: number }) => Promise<FileSearchResult[]>
  getFileExplorerGitStatuses: (dirPath: string) => Promise<FileExplorerGitStatuses>
  getFileInfo: (filePath: string) => Promise<FileViewerFileInfo>
  readFileBytes: (options: { path: string; start: number; length: number }) => Promise<FileViewerByteRange>
  readFileText: (options: {
    path: string
    start: number
    length: number
    encoding?: FileViewerTextEncoding
  }) => Promise<FileViewerTextRange>
  saveFile: (payload: FileViewerSaveRequest) => Promise<FileViewerSaveResult>
  renameEntry: (oldPath: string, newPath: string) => Promise<void>
  deleteEntry: (path: string) => Promise<void>
  mkdir: (path: string) => Promise<void>
  watchDirectory: (dirPath: string) => Promise<void>
  unwatchDirectory: (dirPath: string) => Promise<void>
  watchFile: (filePath: string) => Promise<void>
  unwatchFile: (filePath: string) => Promise<void>
  getFilePreviewSource: (filePath: string) => Promise<FileViewerPreviewSource>
  getGitRepoInfo: (filePath: string) => Promise<FileViewerGitRepoInfo>
  getGitDiff: (filePath: string) => Promise<FileViewerGitDiff>
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
      inheritsProjectColor?: boolean
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
  listAiTabMetadataModels: (provider: AiTabMetadataProvider) => Promise<AiTabMetadataModel[]>
  generateAiTabMetadata: (payload: AiTabMetadataGenerateRequest) => Promise<AiTabMetadataGenerateResult>
  getMacros: () => Promise<import('./macros').MacroDefinition[]>
  updateMacros: (macros: import('./macros').MacroDefinition[]) => Promise<import('./macros').MacroDefinition[]>
  resetMacros: () => Promise<import('./macros').MacroDefinition[]>
  getSecrets: () => Promise<import('./macros').SecretDefinition[]>
  saveSecret: (name: string, value: string) => Promise<import('./macros').SecretDefinition>
  deleteSecret: (id: string) => Promise<void>
  getDecryptedSecret: (id: string) => Promise<string>
  waitForTerminalInactivity: (id: string, durationMs: number) => Promise<void>
  smartPasteClipboard: () => Promise<string>
  writeClipboardText: (text: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  getAppUpdateStatus: (options?: { force?: boolean }) => Promise<AppUpdateStatus>
  openProjectEditWindow: (draft: ProjectEditWindowDraft) => Promise<ProjectEditWindowResult | null>
  openTerminalEditWindow: (draft: TerminalEditWindowDraft) => Promise<TerminalEditWindowResult | null>
  getEditWindowState: () => Promise<EditWindowState | null>
  submitEditWindowResult: (result: EditWindowResult) => Promise<void>
  openSettingsWindow: (options?: { sectionId?: string }) => Promise<void>
  getRemoteAccessStatus: () => Promise<RemoteAccessStatus>
  toggleRemoteAccessServer: () => Promise<RemoteAccessStatus>
  revokeRemoteAccessDevice: (deviceId: string) => Promise<RemoteAccessStatus>
  closeRemoteAccessConnection: (connectionId: string) => Promise<RemoteAccessStatus>
  setRemoteAccessPairingAddress: (address: string) => Promise<RemoteAccessStatus>
  openMacrosWindow: () => Promise<void>
  onTerminalData: (listener: (message: TerminalDataMessage) => void) => () => void
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => () => void
  onAppCommand: (listener: (command: AppCommand) => void) => () => void
  onFileExplorerWatchEvent: (listener: (message: FileExplorerWatchEvent) => void) => () => void
  onFileWatchEvent: (listener: (message: FileViewerWatchEvent) => void) => () => void
  onTerminalSettingsChanged: (listener: (message: SettingsChangeMessage) => void) => () => void
  onMacrosChanged: (listener: (message: MacrosChangeMessage) => void) => () => void
  onRemoteAccessStatusChanged: (listener: (status: RemoteAccessStatus) => void) => () => void
  onTerminalZoomChanged: (listener: (message: TerminalZoomMessage) => void) => () => void
  onTerminalCopyRequested: (listener: () => void) => () => void
  onSettingsFocusSection: (listener: (message: { sectionId: string }) => void) => () => void
}

export interface TerminayTestApi {
  sendAppCommand: (command: AppCommand) => Promise<void>
  setAiTabMetadataMock: (mock: {
    error?: string | null
    models?: AiTabMetadataModel[]
    noteResult?: string
    titleResult?: string
  }) => Promise<void>
}
