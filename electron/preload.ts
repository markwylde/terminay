import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MacroDefinition } from '../src/types/macros'
import type { TerminalSettings } from '../src/types/settings'
import type {
  AppCommand,
  AiTabMetadataGenerateRequest,
  AiTabMetadataGenerateResult,
  AiTabMetadataModel,
  AiTabMetadataProvider,
  FileExplorerEntry,
  FileSearchResult,
  FileExplorerGitStatuses,
  FileViewerByteRange,
  FileViewerFileInfo,
  FileViewerGitDiff,
  FileViewerGitRepoInfo,
  FileViewerPreviewSource,
  FileViewerSaveRequest,
  FileViewerSaveResult,
  FileViewerTextEncoding,
  FileViewerTextRange,
  FileViewerWatchEvent,
  EditWindowResult,
  EditWindowState,
  MacrosChangeMessage,
  ProjectEditWindowDraft,
  ProjectEditWindowResult,
  RemoteAccessStatus,
  SettingsChangeMessage,
  TerminalDataMessage,
  TerminalEditWindowDraft,
  TerminalEditWindowResult,
  TerminalExitMessage,
  TermideTestApi,
  TerminalZoomMessage,
} from '../src/types/termide'

type ElectronListener<T> = (_event: Electron.IpcRendererEvent, payload: T) => void

contextBridge.exposeInMainWorld('termide', {
  getHomePath: () => ipcRenderer.invoke('fs:get-home-path') as Promise<string>,
  listDirectory: (dirPath: string) => ipcRenderer.invoke('fs:list-directory', { dirPath }) as Promise<FileExplorerEntry[]>,
  searchFiles: (options: { rootPath: string; query: string; limit?: number }) =>
    ipcRenderer.invoke('fs:search-files', options) as Promise<FileSearchResult[]>,
  getFileExplorerGitStatuses: (dirPath: string) =>
    ipcRenderer.invoke('fs:get-git-statuses', { dirPath }) as Promise<FileExplorerGitStatuses>,
  getFileInfo: (filePath: string) => ipcRenderer.invoke('file:get-info', { path: filePath }) as Promise<FileViewerFileInfo>,
  readFileBytes: (options: { path: string; start: number; length: number }) =>
    ipcRenderer.invoke('file:read-bytes', options) as Promise<FileViewerByteRange>,
  readFileText: (options: { path: string; start: number; length: number; encoding?: FileViewerTextEncoding }) =>
    ipcRenderer.invoke('file:read-text', options) as Promise<FileViewerTextRange>,
  saveFile: (payload: FileViewerSaveRequest) => ipcRenderer.invoke('file:save', payload) as Promise<FileViewerSaveResult>,
  renameEntry: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', { oldPath, newPath }),
  deleteEntry: (path: string) => ipcRenderer.invoke('fs:delete', { path }),
  mkdir: (path: string) => ipcRenderer.invoke('fs:mkdir', { path }),
  watchFile: (filePath: string) => ipcRenderer.invoke('file:watch', { path: filePath }) as Promise<void>,
  unwatchFile: (filePath: string) => ipcRenderer.invoke('file:unwatch', { path: filePath }) as Promise<void>,
  getFilePreviewSource: (filePath: string) =>
    ipcRenderer.invoke('file:get-preview-source', { path: filePath }) as Promise<FileViewerPreviewSource>,
  getGitRepoInfo: (filePath: string) =>
    ipcRenderer.invoke('file:get-git-repo-info', { path: filePath }) as Promise<FileViewerGitRepoInfo>,
  getGitDiff: (filePath: string) => ipcRenderer.invoke('file:get-git-diff', { path: filePath }) as Promise<FileViewerGitDiff>,
  quitApp: () => ipcRenderer.invoke('app:quit'),
  createTerminal: (options?: { cwd?: string }) => ipcRenderer.invoke('terminal:create', options),
  getTerminalCwd: (id: string) => ipcRenderer.invoke('terminal:get-cwd', { id }),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  writeTerminal: (id: string, data: string) => ipcRenderer.send('terminal:write', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.send('terminal:kill', { id }),
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
  ) => ipcRenderer.send('terminal:update-remote-metadata', { id, ...metadata }),
  getTerminalZoom: () => ipcRenderer.invoke('terminal:get-zoom'),
  getTerminalSettings: () => ipcRenderer.invoke('settings:get-terminal') as Promise<TerminalSettings>,
  updateTerminalSettings: (settings: TerminalSettings) =>
    ipcRenderer.invoke('settings:update-terminal', settings) as Promise<TerminalSettings>,
  resetTerminalSettings: () => ipcRenderer.invoke('settings:reset-terminal') as Promise<TerminalSettings>,
  listAiTabMetadataModels: (provider: AiTabMetadataProvider) =>
    ipcRenderer.invoke('ai-tab-metadata:list-models', { provider }) as Promise<AiTabMetadataModel[]>,
  generateAiTabMetadata: (payload: AiTabMetadataGenerateRequest) =>
    ipcRenderer.invoke('ai-tab-metadata:generate', payload) as Promise<AiTabMetadataGenerateResult>,

  getMacros: () => ipcRenderer.invoke('macros:get') as Promise<MacroDefinition[]>,
  updateMacros: (macros: MacroDefinition[]) => ipcRenderer.invoke('macros:update', macros) as Promise<MacroDefinition[]>,
  resetMacros: () => ipcRenderer.invoke('macros:reset') as Promise<MacroDefinition[]>,

  getSecrets: () => ipcRenderer.invoke('secrets:get'),
  saveSecret: (name: string, value: string) => ipcRenderer.invoke('secrets:save', { name, value }),
  deleteSecret: (id: string) => ipcRenderer.invoke('secrets:delete', id),
  getDecryptedSecret: (id: string) => ipcRenderer.invoke('secrets:get-decrypted', id),

  waitForTerminalInactivity: (id: string, durationMs: number) =>
    ipcRenderer.invoke('terminal:wait-for-inactivity', { id, durationMs }),
  smartPasteClipboard: () => ipcRenderer.invoke('clipboard:smart-paste') as Promise<string>,
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text) as Promise<void>,

  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  getAppUpdateStatus: (options?: { force?: boolean }) =>
    ipcRenderer.invoke('app:get-update-status', options),
  openProjectEditWindow: (draft: ProjectEditWindowDraft) =>
    ipcRenderer.invoke('app:open-project-edit', draft) as Promise<ProjectEditWindowResult | null>,
  openTerminalEditWindow: (draft: TerminalEditWindowDraft) =>
    ipcRenderer.invoke('app:open-terminal-edit', draft) as Promise<TerminalEditWindowResult | null>,
  getEditWindowState: () => ipcRenderer.invoke('app:get-edit-window-state') as Promise<EditWindowState | null>,
  submitEditWindowResult: (result: EditWindowResult) => ipcRenderer.invoke('app:submit-edit-window-result', result) as Promise<void>,
  openSettingsWindow: (options?: { sectionId?: string }) => ipcRenderer.invoke('app:open-settings', options),
  openMacrosWindow: () => ipcRenderer.invoke('app:open-macros') as Promise<void>,
  getRemoteAccessStatus: () => ipcRenderer.invoke('remote:get-status'),
  toggleRemoteAccessServer: () => ipcRenderer.invoke('remote:toggle-server'),
  revokeRemoteAccessDevice: (deviceId: string) => ipcRenderer.invoke('remote:revoke-device', { deviceId }),
  closeRemoteAccessConnection: (connectionId: string) =>
    ipcRenderer.invoke('remote:close-connection', { connectionId }),
  setRemoteAccessPairingAddress: (address: string) =>
    ipcRenderer.invoke('remote:set-pairing-address', { address }),

  onTerminalData: (listener: (message: TerminalDataMessage) => void) => {
    const wrapper: ElectronListener<TerminalDataMessage> = (_event, message) => listener(message)
    ipcRenderer.on('terminal:data', wrapper)
    return () => ipcRenderer.off('terminal:data', wrapper)
  },
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => {
    const wrapper: ElectronListener<TerminalExitMessage> = (_event, message) => listener(message)
    ipcRenderer.on('terminal:exit', wrapper)
    return () => ipcRenderer.off('terminal:exit', wrapper)
  },
  onAppCommand: (listener: (command: AppCommand) => void) => {
    const wrapper: ElectronListener<AppCommand> = (_event, command) => listener(command)
    ipcRenderer.on('app:command', wrapper)
    return () => ipcRenderer.off('app:command', wrapper)
  },
  onFileWatchEvent: (listener: (message: FileViewerWatchEvent) => void) => {
    const wrapper: ElectronListener<FileViewerWatchEvent> = (_event, message) => listener(message)
    ipcRenderer.on('file:watch-event', wrapper)
    return () => ipcRenderer.off('file:watch-event', wrapper)
  },
  onTerminalSettingsChanged: (listener: (message: SettingsChangeMessage) => void) => {
    const wrapper: ElectronListener<SettingsChangeMessage> = (_event, message) => listener(message)
    ipcRenderer.on('settings:terminal-changed', wrapper)
    return () => ipcRenderer.off('settings:terminal-changed', wrapper)
  },
  onMacrosChanged: (listener: (message: MacrosChangeMessage) => void) => {
    const wrapper: ElectronListener<MacrosChangeMessage> = (_event, message) => listener(message)
    ipcRenderer.on('settings:macros-changed', wrapper)
    return () => ipcRenderer.off('settings:macros-changed', wrapper)
  },
  onRemoteAccessStatusChanged: (listener: (status: RemoteAccessStatus) => void) => {
    const wrapper: ElectronListener<RemoteAccessStatus> = (_event, status) => listener(status)
    ipcRenderer.on('remote:status-changed', wrapper)
    return () => ipcRenderer.off('remote:status-changed', wrapper)
  },
  onTerminalZoomChanged: (listener: (message: TerminalZoomMessage) => void) => {
    const wrapper: ElectronListener<TerminalZoomMessage> = (_event, message) => listener(message)
    ipcRenderer.on('terminal:zoom-changed', wrapper)
    return () => ipcRenderer.off('terminal:zoom-changed', wrapper)
  },
  onTerminalCopyRequested: (listener: () => void) => {
    const wrapper = () => listener()
    ipcRenderer.on('terminal:copy-requested', wrapper)
    return () => ipcRenderer.off('terminal:copy-requested', wrapper)
  },
  onSettingsFocusSection: (listener: (message: { sectionId: string }) => void) => {
    const wrapper: ElectronListener<{ sectionId: string }> = (_event, message) => listener(message)
    ipcRenderer.on('settings:focus-section', wrapper)
    return () => ipcRenderer.off('settings:focus-section', wrapper)
  },
})

if (process.env.TERMIDE_TEST === '1') {
  const testApi: TermideTestApi = {
    sendAppCommand: (command) => ipcRenderer.invoke('test:send-app-command', command) as Promise<void>,
    setAiTabMetadataMock: (mock) => ipcRenderer.invoke('test:set-ai-tab-metadata-mock', mock) as Promise<void>,
  }

  contextBridge.exposeInMainWorld('termideTest', testApi)
}
