import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MacroDefinition } from '../src/types/macros'
import type { TerminalSettings } from '../src/types/settings'
import type {
  AppCommand,
  FileExplorerEntry,
  MacrosChangeMessage,
  RemoteAccessStatus,
  SettingsChangeMessage,
  TerminalDataMessage,
  TerminalExitMessage,
  TerminalZoomMessage,
} from '../src/types/termide'

type ElectronListener<T> = (_event: Electron.IpcRendererEvent, payload: T) => void

contextBridge.exposeInMainWorld('termide', {
  getHomePath: () => ipcRenderer.invoke('fs:get-home-path') as Promise<string>,
  listDirectory: (dirPath: string) => ipcRenderer.invoke('fs:list-directory', { dirPath }) as Promise<FileExplorerEntry[]>,
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

  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  openSettingsWindow: (options?: { sectionId?: string }) => ipcRenderer.invoke('app:open-settings', options),
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
  onSettingsFocusSection: (listener: (message: { sectionId: string }) => void) => {
    const wrapper: ElectronListener<{ sectionId: string }> = (_event, message) => listener(message)
    ipcRenderer.on('settings:focus-section', wrapper)
    return () => ipcRenderer.off('settings:focus-section', wrapper)
  },
})
