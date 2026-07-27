export type AppCommand =
  | 'new-terminal'
  | 'new-project'
  | 'save-active'
  | 'open-recordings'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'
  | 'open-command-bar'
  | 'start-dictation'
  | 'clear-terminal'
  | 'toggle-file-explorer-sidebar'
  | 'set-project-root-folder-to-working-directory'

// A project tab torn off / merged across windows. `project` is a ProjectTab and
// `terminals` are MovedTerminalTab entries (kept loose here to avoid coupling
// this shared type file to App.tsx's local definitions); the renderer casts.
export interface AdoptedProjectPayload {
  project: Record<string, unknown>
  terminals: Array<{ sessionId: string } & Record<string, unknown>>
  activeSessionId?: string | null
}

export type ProjectTabDragResult =
  | { action: 'reorder' }
  | { action: 'merge'; targetWindowId: number }
  | { action: 'popout'; x: number; y: number }

export type ProjectTabDragPreview = {
  title: string
  emoji: string
  color: string
  width: number
}

// Sent to a window while another window drags a project tab over its bar.
// `clientX` (viewport-relative) drives the in-bar insertion index.
export type ProjectTabDragHoverMessage = {
  active: boolean
  clientX?: number
  preview?: ProjectTabDragPreview | null
}

export type FileViewerTextEncoding = 'utf8' | 'utf-8' | 'utf16le' | 'utf-16le' | 'latin1' | 'ascii'

export type FileViewerFileInfo = {
  birthtimeMs: number | null
  ctimeMs: number | null
  exists: boolean
  extension: string
  ino: number | null
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

export type FileViewerTextMetadata = {
  indexedByteLength: number
  ino: number
  isComplete: boolean
  lineCount: number
  mtimeMs: number
  path: string
  size: number
}

export type FileViewerTextLine = {
  end: number
  eol: '' | '\n' | '\r\n'
  lineNumber: number
  start: number
  text: string
}

export type FileViewerTextWindow = {
  lineCount: number
  lines: FileViewerTextLine[]
  path: string
  startLine: number
}

export type FileViewerSparseFileEdit = {
  dataBase64: string
  end: number
  start: number
}

export type FileViewerSparseFileSaveRequest = {
  edits: FileViewerSparseFileEdit[]
  expectedIno: number
  expectedMtimeMs: number
  expectedSize: number
  path: string
  projectRoot: string
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
  hunks: FileViewerGitDiffHunk[]
  isBinary: boolean
  isTracked: boolean
  path: string
  relativePath: string | null
  repoRoot: string | null
  tooLarge: boolean
}

export type FileViewerGitDiffHunk = {
  header: string
  lines: FileViewerGitDiffLine[]
}

export type FileViewerGitDiffLine = {
  newLineNumber: number | null
  oldLineNumber: number | null
  type: 'add' | 'context' | 'delete'
  value: string
}

export type TerminalDataMessage = {
  id: string
  data: string
}

export type DictationKeyStatus = {
  configured: boolean
}

export type DictationMicrophonePermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'

export type DictationTranscribeRequest = {
  audioBase64: string
  fileName: string
  language?: string
  mimeType: string
  model?: import('./settings').DictationTranscriptionModel
  prompt?: string
}

export type DictationTranscribeResult = {
  model: string
  text: string
}

export type { TerminalActivityMessage, SemanticActivity } from './terminalSignals'
export type { AgentStatusSnapshot } from './agentStatus'

export type TerminalExitMessage = {
  id: string
  exitCode: number
  signal?: number | null
}

export type SettingsChangeMessage = {
  settings: import('./settings').TerminalSettings
}

export type MacrosChangeMessage = {
  macros: import('./macros').MacroDefinition[]
}

export type RemoteAccessStatus = {
  activeConnectionCount: number
  pendingWebRtcConnectionCount: number
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
    reason?: string
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
  lanPairingExpiresAt: string | null
  lanPairingQrCodeDataUrl: string | null
  lanPairingQrCodePath: string | null
  lanPairingUrl: string | null
  origin: string | null
  pairedDeviceCount: number
  pairedDevices: Array<{
    addedAt: string
    deviceId: string
    lastSeenAt: string | null
    name: string
    origin: string
    reconnectGrantExpiresAt: string | null
    reconnectGrantLastUsedAt: string | null
    reconnectGrantStatus: 'none' | 'valid' | 'expired' | 'revoked'
  }>
  pairingMode: 'lan' | 'webrtc'
  pairingExpiresAt: string | null
  pairingQrCodeDataUrl: string | null
  pairingQrCodePath: string | null
  pairingUrl: string | null
  webRtcPairingExpiresAt: string | null
  webRtcPairingQrCodeDataUrl: string | null
  webRtcPairingUrl: string | null
  webRtcRoomId: string | null
  webRtcStatus: 'error' | 'not-configured' | 'pairing-ready' | 'registering'
  webRtcStatusMessage: string | null
}

export type FileExplorerEntry = {
  createdAtMs?: number | null
  isDirectory: boolean
  isSymbolicLink: boolean
  mode?: number | null
  modifiedAtMs?: number | null
  name: string
  path: string
  size?: number
}

export type FolderSizeProgress = {
  entryCount: number
  jobId: string
  size: number
}

export type FolderSizeResult = {
  cancelled: boolean
  entryCount: number
  jobId: string
  size: number
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

export type GitFileState =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

export type GitChangeEntry = {
  /** Absolute path to the changed file. */
  path: string
  /** Path relative to the repository root, using forward slashes. */
  relativePath: string
  state: GitFileState
  /** True when the change is in the index (staged), false when in the working tree. */
  staged: boolean
  /** Absolute path of the original file for renames/copies. */
  originalPath?: string
  /** Original path relative to the repository root for renames/copies. */
  originalRelativePath?: string
}

export type GitPanelStatus = {
  gitAvailable: boolean
  repoRoot: string | null
  /** Current branch name, or a short detached-HEAD label, or null when unknown. */
  branch: string | null
  entries: GitChangeEntry[]
}

export type GitWorktreeStatus = {
  path: string
  name: string
  /** Branch name, or a short detached-HEAD label, or null when unknown. */
  branch: string | null
  head: string | null
  aheadOfMainCount: number | null
  lineAdditions: number | null
  lineDeletions: number | null
  lastChangedAt: string | null
  isDirtyBranch: boolean
  isCurrent: boolean
  isMain: boolean
  isBare: boolean
  isDetached: boolean
  isLocked: boolean
  isPrunable: boolean
  errorMessage?: string
  entries: GitChangeEntry[]
}

export type WorktreePanelStatus = {
  gitAvailable: boolean
  repoRoot: string | null
  defaultBranch: string | null
  worktrees: GitWorktreeStatus[]
}

export type TerminalZoomMessage = {
  zoomLevel: number
}

export type TerminalRemoteSizeOverrideMessage =
  | {
      active: false
      id: string
    }
  | {
      active: true
      cols: number
      id: string
      rows: number
    }

export type TerminalRecordingState = {
  bytesWritten: number
  errorMessage: string | null
  eventCount: number
  recordingId: string | null
  sessionId: string
  startedAt: string | null
  status: 'idle' | 'recording' | 'failed'
}

export type TerminalRecordingStartMetadata = {
  color?: string
  emoji?: string
  inheritsProjectColor?: boolean
  projectColor?: string
  projectEmoji?: string
  projectId?: string
  projectTitle?: string
  title?: string
}

export type TerminalRecordingMetadata = {
  version: 2
  bytesWritten: number
  castAvailable: boolean
  capturedInput: boolean
  color: string | null
  cols: number
  cwdLabel: string | null
  durationMs: number | null
  endedAt: string | null
  errorMessage?: string | null
  eventCount: number
  exitCode: number | null
  inputPolicy: 'none' | 'record-with-sensitive-filter'
  projectColor: string | null
  projectEmoji: string | null
  projectId: string | null
  projectTitle: string | null
  recordingId: string
  recordingState: 'recording' | 'completed' | 'interrupted' | 'failed'
  rows: number
  sensitiveInputPolicy: 'drop' | 'mask'
  sessionId: string
  shellName: string | null
  signal: number | null
  startedAt: string
  theme: import('./settings').TerminalThemeSettings | null
  title: string
}

export type TerminalRecordingListItem = TerminalRecordingMetadata

export type TerminalRecordingChunkRequest = {
  maxBytes?: number
  recordingId: string
  start?: number
}

/**
 * A byte-bounded sequence of complete UTF-8 asciicast NDJSON records.
 *
 * Callers continue with `nextOffset`. A non-zero `start` must be an offset
 * previously returned by this API, so chunks never split a UTF-8 code point or
 * an NDJSON record. `incompleteTail` means a trailing partial record was
 * withheld; it may become complete while an active recording is still growing.
 */
export type TerminalRecordingChunk = {
  content: string
  eof: boolean
  incompleteTail: boolean
  nextOffset: number
  recordingId: string
  start: number
  totalSize: number
}

export type TerminalRecordingChangeMessage = {
  state: TerminalRecordingState
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

export type QuickPushAction = 'current' | 'current-pr' | 'new' | 'new-pr' | 'default'

export type QuickPushCommit = {
  message: string
  files: string[]
}

export type QuickPushPullRequest = {
  title: string
  body: string
}

export type QuickPushPlan = {
  branchName: string | null
  pullRequest: QuickPushPullRequest | null
  commits: QuickPushCommit[]
  /** Changed files that the model did not assign to any commit. */
  uncoveredFiles: string[]
  /** Non-fatal notes to surface to the user (e.g. unknown files, truncated context). */
  warnings: string[]
}

export type QuickPushGenerateRequest = {
  provider: AiTabMetadataProvider
  model: string
  action: QuickPushAction
  cwd: string
}

export type QuickPushApplyRequest = {
  cwd: string
  action: QuickPushAction
  branchName: string | null
  pullRequest: QuickPushPullRequest | null
  commits: QuickPushCommit[]
}

export type QuickPushApplyStep = {
  label: string
  ok: boolean
  output?: string
}

export type QuickPushApplyResult = {
  ok: boolean
  steps: QuickPushApplyStep[]
  /** Branch the commits ultimately landed on. */
  branch: string | null
  pushed: boolean
  pullRequestUrl: string | null
  pullRequestUrlLabel?: string | null
  error: string | null
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

export type McpAgentId = 'claudeCode' | 'codex'

export interface McpAgentInstallState {
  id: McpAgentId
  label: string
  /** Whether a `terminay` MCP server entry is present in the agent's config. */
  installed: boolean
  /** Absolute path to the agent config file we read/write. */
  configPath: string
}

export interface McpInstallStatus {
  agents: McpAgentInstallState[]
}

export interface McpInstallActionResult {
  ok: boolean
  installed: boolean
  message?: string
  error?: string
}

/** main -> renderer control request, scoped to a single terminal's project. */
export interface ControlRendererRequestMessage {
  requestId: string
  scopeSessionId: string
  op: string
  params: unknown
}

/** renderer -> main control response. */
export interface ControlRendererResponseMessage {
  requestId: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string; candidates?: string[] }
}

export interface TerminayApi {
  getHomePath: () => Promise<string>
  listDirectory: (dirPath: string) => Promise<FileExplorerEntry[]>
  calculateFolderSize: (payload: { jobId: string; path: string }) => Promise<FolderSizeResult>
  cancelFolderSize: (jobId: string) => Promise<void>
  searchFiles: (options: { rootPath: string; query: string; limit?: number }) => Promise<FileSearchResult[]>
  getFileExplorerGitStatuses: (dirPath: string) => Promise<FileExplorerGitStatuses>
  getGitPanelStatus: (dirPath: string) => Promise<GitPanelStatus>
  getWorktreePanelStatus: (dirPath: string) => Promise<WorktreePanelStatus>
  moveGitWorktree: (payload: { repoPath: string; worktreePath: string; newPath: string }) => Promise<void>
  removeGitWorktree: (payload: { force?: boolean; repoPath: string; worktreePath: string }) => Promise<void>
  pullGitWorktreeFromOrigin: (worktreePath: string) => Promise<void>
  getFileInfo: (filePath: string) => Promise<FileViewerFileInfo>
  readFileBytes: (options: { path: string; start: number; length: number }) => Promise<FileViewerByteRange>
  readFileText: (options: {
    path: string
    start: number
    length: number
    encoding?: FileViewerTextEncoding
  }) => Promise<FileViewerTextRange>
  getFileTextMetadata: (options: { path: string; projectRoot: string }) => Promise<FileViewerTextMetadata>
  readFileTextLines: (options: {
    lineCount: number
    path: string
    projectRoot: string
    startLine: number
  }) => Promise<FileViewerTextWindow>
  saveSparseFile: (payload: FileViewerSparseFileSaveRequest) => Promise<FileViewerSaveResult>
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
  generateQuickPushPlan: (request: QuickPushGenerateRequest) => Promise<QuickPushPlan>
  applyQuickPush: (request: QuickPushApplyRequest) => Promise<QuickPushApplyResult>
  quitApp: () => Promise<void>
  createTerminal: (options?: { cwd?: string }) => Promise<{ id: string }>
  getAgentStatusSnapshot: () => Promise<import('./agentStatus').AgentStatusSnapshot>
  acknowledgeAgentStatus: (entryId: string) => Promise<boolean>
  acknowledgeTerminalAgentStatuses: (terminalSessionId: string) => Promise<number>
  getTerminalCwd: (id: string) => Promise<string | null>
  getTerminalBuffer: (id: string) => Promise<string | null>
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
  getTerminalRecordingState: (id: string) => Promise<TerminalRecordingState>
  startTerminalRecording: (id: string, metadata?: TerminalRecordingStartMetadata) => Promise<TerminalRecordingState>
  stopTerminalRecording: (id: string) => Promise<TerminalRecordingState>
  listTerminalRecordings: () => Promise<TerminalRecordingListItem[]>
  readTerminalRecordingChunk: (request: TerminalRecordingChunkRequest) => Promise<TerminalRecordingChunk>
  deleteTerminalRecordingById: (recordingId: string) => Promise<void>
  revealTerminalRecordingById: (recordingId: string) => Promise<void>
  getTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  updateTerminalSettings: (
    settings: import('./settings').TerminalSettings,
  ) => Promise<import('./settings').TerminalSettings>
  resetTerminalSettings: () => Promise<import('./settings').TerminalSettings>
  listAiTabMetadataModels: (provider: AiTabMetadataProvider) => Promise<AiTabMetadataModel[]>
  generateAiTabMetadata: (payload: AiTabMetadataGenerateRequest) => Promise<AiTabMetadataGenerateResult>
  getDictationOpenAiKeyStatus: () => Promise<DictationKeyStatus>
  saveDictationOpenAiKey: (apiKey: string) => Promise<DictationKeyStatus>
  clearDictationOpenAiKey: () => Promise<DictationKeyStatus>
  getDictationMicrophonePermissionStatus: () => Promise<DictationMicrophonePermissionStatus>
  requestDictationMicrophonePermission: () => Promise<DictationMicrophonePermissionStatus>
  transcribeDictation: (request: DictationTranscribeRequest) => Promise<DictationTranscribeResult>
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
  revealInOS: (path: string) => Promise<void>
  getAppUpdateStatus: (options?: { force?: boolean }) => Promise<AppUpdateStatus>
  openProjectEditWindow: (draft: ProjectEditWindowDraft) => Promise<ProjectEditWindowResult | null>
  openTerminalEditWindow: (draft: TerminalEditWindowDraft) => Promise<TerminalEditWindowResult | null>
  getEditWindowState: () => Promise<EditWindowState | null>
  submitEditWindowResult: (result: EditWindowResult) => Promise<void>
  getAdoptedProject: () => Promise<AdoptedProjectPayload | null>
  popoutProject: (payload: {
    project: AdoptedProjectPayload
    x: number
    y: number
  }) => Promise<{ ok: boolean; windowId?: number }>
  mergeProject: (payload: {
    project: AdoptedProjectPayload
    targetWindowId: number
  }) => Promise<{ ok: boolean }>
  closeThisWindow: () => void
  registerProjectTabBarRect: (
    rect: { x: number; y: number; width: number; height: number } | null,
  ) => void
  beginProjectTabDrag: (preview: ProjectTabDragPreview) => void
  endProjectTabDrag: () => Promise<ProjectTabDragResult>
  onAdoptProject: (listener: (payload: AdoptedProjectPayload) => void) => () => void
  onProjectTabDragHover: (
    listener: (message: ProjectTabDragHoverMessage) => void,
  ) => () => void
  onProjectTabTornOff: (listener: (message: { active: boolean }) => void) => () => void
  openSettingsWindow: (options?: { sectionId?: string }) => Promise<void>
  openRecordingsWindow: () => Promise<void>
  getRemoteAccessStatus: () => Promise<RemoteAccessStatus>
  toggleRemoteAccessServer: () => Promise<RemoteAccessStatus>
  revokeRemoteAccessDevice: (deviceId: string) => Promise<RemoteAccessStatus>
  closeRemoteAccessConnection: (connectionId: string) => Promise<RemoteAccessStatus>
  setRemoteAccessPairingAddress: (address: string) => Promise<RemoteAccessStatus>
  setRemoteAccessPairingPin: (pin: string) => Promise<import('./settings').TerminalSettings>
  openMacrosWindow: () => Promise<void>
  onTerminalData: (listener: (message: TerminalDataMessage) => void) => () => void
  onTerminalActivity: (
    listener: (message: import('./terminalSignals').TerminalActivityMessage) => void,
  ) => () => void
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => () => void
  onAgentStatusSnapshot: (
    listener: (snapshot: import('./agentStatus').AgentStatusSnapshot) => void,
  ) => () => void
  onAppCommand: (listener: (command: AppCommand) => void) => () => void
  onFileExplorerWatchEvent: (listener: (message: FileExplorerWatchEvent) => void) => () => void
  onFolderSizeProgress: (listener: (message: FolderSizeProgress) => void) => () => void
  onFileWatchEvent: (listener: (message: FileViewerWatchEvent) => void) => () => void
  onTerminalSettingsChanged: (listener: (message: SettingsChangeMessage) => void) => () => void
  onMacrosChanged: (listener: (message: MacrosChangeMessage) => void) => () => void
  onRemoteAccessStatusChanged: (listener: (status: RemoteAccessStatus) => void) => () => void
  onTerminalZoomChanged: (listener: (message: TerminalZoomMessage) => void) => () => void
  onTerminalRemoteSizeOverrideChanged: (listener: (message: TerminalRemoteSizeOverrideMessage) => void) => () => void
  onTerminalRecordingChanged: (listener: (message: TerminalRecordingChangeMessage) => void) => () => void
  onTerminalCopyRequested: (listener: () => void) => () => void
  onSettingsFocusSection: (listener: (message: { sectionId: string }) => void) => () => void
  getMcpInstallStatus: () => Promise<McpInstallStatus>
  installMcpAgent: (agent: McpAgentId) => Promise<McpInstallActionResult>
  uninstallMcpAgent: (agent: McpAgentId) => Promise<McpInstallActionResult>
  onControlRequest: (listener: (message: ControlRendererRequestMessage) => void) => () => void
  sendControlResponse: (message: ControlRendererResponseMessage) => void
}

export interface TerminayTestApi {
  emitAgentHook: (payload: {
    provider: import('./agentStatus').AgentProvider
    terminalSessionId: string
    nativePayload: Record<string, unknown>
  }) => Promise<number>
  getMcpControlEnvironment: (
    terminalSessionId: string,
  ) => Promise<{ socketPath: string; token: string }>
  sendAppCommand: (command: AppCommand) => Promise<void>
  setAiTabMetadataMock: (mock: {
    error?: string | null
    models?: AiTabMetadataModel[]
    noteResult?: string
    titleResult?: string
  }) => Promise<void>
}
