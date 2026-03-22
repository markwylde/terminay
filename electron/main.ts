import { app, BrowserWindow, Menu, ipcMain, nativeImage, shell, webContents } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync } from 'node:fs'
import type { IPty } from 'node-pty'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof import('node-pty')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')
app.setName('Termide')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

function getBrandAssetPath(filename: string): string | null {
  const candidates = [
    path.join(process.env.VITE_PUBLIC, filename),
    path.join(process.cwd(), 'public', filename),
    path.join(app.getAppPath(), 'public', filename),
    path.join(process.env.APP_ROOT, 'public', filename),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

type AppCommand =
  | 'new-terminal'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'

interface TerminalSession {
  id: string
  ownerWebContentsId: number
  process: IPty
}

const terminalSessions = new Map<string, TerminalSession>()

function ensureNodePtySpawnHelperIsExecutable(): void {
  if (process.platform === 'win32') {
    return
  }

  const helperPath = path.join(
    process.cwd(),
    'node_modules',
    'node-pty',
    'prebuilds',
    `${process.platform}-${process.arch}`,
    'spawn-helper',
  )

  if (!existsSync(helperPath)) {
    return
  }

  try {
    chmodSync(helperPath, 0o755)
  } catch {
    // If chmod fails we continue and let the normal spawn error surface.
  }
}

function getCandidateShells(): string[] {
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'powershell.exe']
  }

  return [
    process.env.SHELL || '',
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter((value, index, list) => value.length > 0 && list.indexOf(value) === index)
}

function spawnWithFallbackShell(): IPty {
  const shells = getCandidateShells()
  let lastError: unknown = null

  for (const shellPath of shells) {
    if (process.platform !== 'win32' && shellPath.startsWith('/') && !existsSync(shellPath)) {
      continue
    }

    try {
      return pty.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: app.getPath('home'),
        env: process.env,
      })
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Unable to start a terminal shell. Tried: ${shells.join(', ')}. Last error: ${String(lastError)}`,
  )
}

function createPtySession(webContentsId: number): TerminalSession {
  const id = randomUUID()
  const ptyProcess = spawnWithFallbackShell()

  const session: TerminalSession = {
    id,
    ownerWebContentsId: webContentsId,
    process: ptyProcess,
  }

  terminalSessions.set(id, session)
  return session
}

function killSession(id: string): void {
  const session = terminalSessions.get(id)
  if (!session) {
    return
  }

  try {
    session.process.kill()
  } catch {
    // session may already have ended
  }

  terminalSessions.delete(id)
}

function killSessionsForWebContents(webContentsId: number): void {
  for (const session of terminalSessions.values()) {
    if (session.ownerWebContentsId === webContentsId) {
      killSession(session.id)
    }
  }
}

function sendToSessionRenderer(
  session: TerminalSession,
  channel: 'terminal:data' | 'terminal:exit',
  payload: { id: string; data: string } | { id: string; exitCode: number },
): void {
  const target = webContents.fromId(session.ownerWebContentsId)
  if (!target || target.isDestroyed()) {
    return
  }

  try {
    target.send(channel, payload)
  } catch {
    // Window is shutting down; ignore late terminal events.
  }
}

let mainWindow: BrowserWindow | null = null

function sendCommandToFocusedWindow(command: AppCommand): void {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  focusedWindow?.webContents.send('app:command', command)
}

function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Termide',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies Electron.MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendCommandToFocusedWindow('new-terminal'),
        },
        {
          type: 'separator',
        },
        {
          label: 'Close Terminal',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendCommandToFocusedWindow('close-active'),
        },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'Split Horizontally',
          accelerator: 'CmdOrCtrl+Shift+-',
          click: () => sendCommandToFocusedWindow('split-horizontal'),
        },
        {
          label: 'Split Vertically',
          accelerator: 'CmdOrCtrl+Shift+\\',
          click: () => sendCommandToFocusedWindow('split-vertical'),
        },
        {
          label: 'Pop Out Active Terminal',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendCommandToFocusedWindow('popout-active'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.mjs')
  const isMac = process.platform === 'darwin'
  const usesOverlayTitlebar = process.platform === 'win32' || process.platform === 'linux'
  const windowIconPath = getBrandAssetPath('termide.png') ?? getBrandAssetPath('termide.svg') ?? undefined

  mainWindow = new BrowserWindow({
    icon: windowIconPath,
    width: 1400,
    height: 900,
    title: 'Termide',
    titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
    titleBarOverlay: usesOverlayTitlebar
      ? {
          color: '#0f1823',
          symbolColor: '#9bb0c8',
          height: 38,
        }
      : false,
    trafficLightPosition: isMac
      ? {
          x: 14,
          y: 12,
        }
      : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow?.setTitle('Termide')
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isPopout = url.includes('popout.html')

    if (!isPopout) {
      shell.openExternal(url)
      return { action: 'deny' }
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        icon: windowIconPath,
        title: 'Termide',
        width: 1000,
        height: 700,
        autoHideMenuBar: true,
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
        },
      },
    }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function setDockIcon(): void {
  if (process.platform !== 'darwin') {
    return
  }

  const iconPath = getBrandAssetPath('icon.icns') ?? getBrandAssetPath('termide.png')

  if (!iconPath) {
    return
  }

  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    return
  }

  app.dock.setIcon(icon)
}

ipcMain.handle('terminal:create', (event) => {
  const session = createPtySession(event.sender.id)

  session.process.onData((data: string) => {
    sendToSessionRenderer(session, 'terminal:data', { id: session.id, data })
  })

  session.process.onExit((exit: { exitCode: number; signal?: number }) => {
    sendToSessionRenderer(session, 'terminal:exit', {
      id: session.id,
      exitCode: exit.exitCode ?? 0,
    })
    terminalSessions.delete(session.id)
  })

  return { id: session.id }
})

ipcMain.on('terminal:write', (_event, payload: { id: string; data: string }) => {
  const session = terminalSessions.get(payload.id)
  if (!session) {
    return
  }

  session.process.write(payload.data)
})

ipcMain.on('terminal:resize', (_event, payload: { id: string; cols: number; rows: number }) => {
  const session = terminalSessions.get(payload.id)
  if (!session) {
    return
  }

  const cols = Math.max(2, Math.floor(payload.cols))
  const rows = Math.max(1, Math.floor(payload.rows))

  try {
    session.process.resize(cols, rows)
  } catch {
    // can throw during teardown races
  }
})

ipcMain.on('terminal:kill', (_event, payload: { id: string }) => {
  killSession(payload.id)
})

app.on('web-contents-created', (_event, contents) => {
  contents.once('destroyed', () => {
    killSessionsForWebContents(contents.id)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  app.setName('Termide')
  app.setAboutPanelOptions({ applicationName: 'Termide' })
  ensureNodePtySpawnHelperIsExecutable()
  setDockIcon()
  createAppMenu()
  createWindow()
})
