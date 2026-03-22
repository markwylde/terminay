import { contextBridge, ipcRenderer } from 'electron'

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

const termideApi = {
  createTerminal: () => ipcRenderer.invoke('terminal:create') as Promise<{ id: string }>,
  writeTerminal: (id: string, data: string) => ipcRenderer.send('terminal:write', { id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', { id, cols, rows }),
  killTerminal: (id: string) => ipcRenderer.send('terminal:kill', { id }),
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
}

contextBridge.exposeInMainWorld('termide', termideApi)
