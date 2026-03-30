import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MacroDefinition } from '../src/types/macros'
import type { TerminalSettings } from '../src/types/settings'

type AppCommand =
  | 'new-terminal'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'
  | 'open-macro-launcher'

type TerminalDataMessage = {
  id: string
  data: string
}

type TerminalExitMessage = {
  id: string
  exitCode: number
}

type SettingsChangeMessage = {
  settings: TerminalSettings
}

type MacrosChangeMessage = {
  macros: MacroDefinition[]
}

const termideApi = {
  quitApp: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  createTerminal: (options?: { cwd?: string }) => ipcRenderer.invoke('terminal:create', options) as Promise<{ id: string }>,
  getTerminalCwd: (id: string) => ipcRenderer.invoke('terminal:get-cwd', { id }) as Promise<string | null>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  writeTerminal: (id: string, data: string) => ipcRenderer.send('terminal:write', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.send('terminal:kill', { id }),
  getTerminalSettings: () => ipcRenderer.invoke('settings:get-terminal') as Promise<TerminalSettings>,
  updateTerminalSettings: (settings: TerminalSettings) =>
    ipcRenderer.invoke('settings:update-terminal', settings) as Promise<TerminalSettings>,
  resetTerminalSettings: () => ipcRenderer.invoke('settings:reset-terminal') as Promise<TerminalSettings>,
  getMacros: () => ipcRenderer.invoke('macros:get') as Promise<MacroDefinition[]>,
  updateMacros: (macros: MacroDefinition[]) => ipcRenderer.invoke('macros:update', macros) as Promise<MacroDefinition[]>,
  resetMacros: () => ipcRenderer.invoke('macros:reset') as Promise<MacroDefinition[]>,
  onTerminalData: (listener: (message: TerminalDataMessage) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalDataMessage) => listener(payload)
    ipcRenderer.on('terminal:data', wrapped)

    return () => {
      ipcRenderer.off('terminal:data', wrapped)
    }
  },
  onTerminalExit: (listener: (message: TerminalExitMessage) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TerminalExitMessage) => listener(payload)
    ipcRenderer.on('terminal:exit', wrapped)

    return () => {
      ipcRenderer.off('terminal:exit', wrapped)
    }
  },
  onAppCommand: (listener: (command: AppCommand) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppCommand) => listener(payload)
    ipcRenderer.on('app:command', wrapped)

    return () => {
      ipcRenderer.off('app:command', wrapped)
    }
  },
  onTerminalSettingsChanged: (listener: (message: SettingsChangeMessage) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: SettingsChangeMessage) => listener(payload)
    ipcRenderer.on('settings:terminal-changed', wrapped)

    return () => {
      ipcRenderer.off('settings:terminal-changed', wrapped)
    }
  },
  onMacrosChanged: (listener: (message: MacrosChangeMessage) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: MacrosChangeMessage) => listener(payload)
    ipcRenderer.on('settings:macros-changed', wrapped)

    return () => {
      ipcRenderer.off('settings:macros-changed', wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('termide', termideApi)
