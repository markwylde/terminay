import { contextBridge, ipcRenderer } from 'electron'
import type { TerminalSettings } from '../src/types/settings'

type AppCommand =
  | 'new-terminal'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'

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

const termideApi = {
  quitApp: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  createTerminal: () => ipcRenderer.invoke('terminal:create') as Promise<{ id: string }>,
  writeTerminal: (id: string, data: string) => ipcRenderer.send('terminal:write', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.send('terminal:kill', { id }),
  getTerminalSettings: () => ipcRenderer.invoke('settings:get-terminal') as Promise<TerminalSettings>,
  updateTerminalSettings: (settings: TerminalSettings) =>
    ipcRenderer.invoke('settings:update-terminal', settings) as Promise<TerminalSettings>,
  resetTerminalSettings: () => ipcRenderer.invoke('settings:reset-terminal') as Promise<TerminalSettings>,
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
}

contextBridge.exposeInMainWorld('termide', termideApi)
