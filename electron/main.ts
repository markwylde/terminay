import { app, BrowserWindow, Menu, clipboard, ipcMain, nativeImage, shell, webContents, safeStorage } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { IPty } from 'node-pty'
import { defaultMacros, normalizeMacros } from '../src/macroSettings'
import { defaultTerminalSettings, normalizeTerminalSettings } from '../src/terminalSettings'
import type { MacroDefinition } from '../src/types/macros'
import type { TerminalSettings } from '../src/types/settings'
import { RemoteAccessService } from './remote/service'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof import('node-pty')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

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

function getWindowIconPath(): string | undefined {
  if (process.platform === 'win32') {
    return getBrandAssetPath('icon.ico') ?? getBrandAssetPath('termide.png') ?? undefined
  }

  if (process.platform === 'darwin') {
    return getBrandAssetPath('icon.icns') ?? getBrandAssetPath('termide.png') ?? undefined
  }

  return getBrandAssetPath('termide.png') ?? getBrandAssetPath('termide.svg') ?? undefined
}

type AppCommand =
  | 'new-terminal'
  | 'split-horizontal'
  | 'split-vertical'
  | 'popout-active'
  | 'close-active'
  | 'open-macro-launcher'

let terminalZoomLevel = 0

function broadcastZoomChange(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    window.webContents.send('terminal:zoom-changed', { zoomLevel: terminalZoomLevel })
  }
}

function zoomIn(): void {
  if (terminalZoomLevel < 10) {
    terminalZoomLevel++
    broadcastZoomChange()
  }
}

function zoomOut(): void {
  if (terminalZoomLevel > -5) {
    terminalZoomLevel--
    broadcastZoomChange()
  }
}

function resetZoom(): void {
  terminalZoomLevel = 0
  broadcastZoomChange()
}

interface TerminalSession {
  id: string
  ownerWebContentsId: number
  process: IPty
}

const terminalSessions = new Map<string, TerminalSession>()
let settingsWindow: BrowserWindow | null = null
let macrosWindow: BrowserWindow | null = null
const remoteAccessService = new RemoteAccessService({
  app,
  getControllableSession: (sessionId) => {
    const session = terminalSessions.get(sessionId)
    return session
      ? {
          close: () => killSession(sessionId),
          resize: (cols: number, rows: number) => session.process.resize(cols, rows),
          write: (data: string) => session.process.write(data),
        }
      : null
  },
  getRemoteAccessSettings: () => readTerminalSettings().remoteAccess,
  onStatusChanged: (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue
      }

      window.webContents.send('remote:status-changed', status)
    }
  },
  publicDir: process.env.VITE_PUBLIC,
  rendererDistDir: RENDERER_DIST,
  saveGeneratedTlsPaths: ({ certPath, keyPath }) => {
    const currentSettings = readTerminalSettings()
    const nextSettings = writeTerminalSettings({
      ...currentSettings,
      remoteAccess: {
        ...currentSettings.remoteAccess,
        tlsCertPath: certPath,
        tlsKeyPath: keyPath,
      },
    })
    broadcastTerminalSettings(nextSettings)
  },
})

function getTerminalSettingsPath(): string {
  return path.join(app.getPath('userData'), 'terminal-settings.json')
}

function getMacrosPath(): string {
  return path.join(app.getPath('userData'), 'macros.json')
}

function getSecretsPath(): string {
  return path.join(app.getPath('userData'), 'secrets.json')
}

function readTerminalSettings(): TerminalSettings {
  const settingsPath = getTerminalSettingsPath()

  try {
    if (!existsSync(settingsPath)) {
      return defaultTerminalSettings
    }

    const fileContents = readFileSync(settingsPath, 'utf8')
    return normalizeTerminalSettings(JSON.parse(fileContents))
  } catch {
    return defaultTerminalSettings
  }
}

function writeTerminalSettings(settings: TerminalSettings): TerminalSettings {
  const normalized = normalizeTerminalSettings(settings)
  const settingsPath = getTerminalSettingsPath()

  mkdirSync(path.dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(normalized, null, 2))
  return normalized
}

function readMacros(): MacroDefinition[] {
  const macrosPath = getMacrosPath()

  try {
    if (!existsSync(macrosPath)) {
      return defaultMacros
    }

    const fileContents = readFileSync(macrosPath, 'utf8')
    return normalizeMacros(JSON.parse(fileContents))
  } catch {
    return defaultMacros
  }
}

function writeMacros(macros: MacroDefinition[]): MacroDefinition[] {
  const normalized = normalizeMacros(macros)
  const macrosPath = getMacrosPath()

  mkdirSync(path.dirname(macrosPath), { recursive: true })
  writeFileSync(macrosPath, JSON.stringify(normalized, null, 2))
  return normalized
}

type SecretRecord = {
  id: string
  name: string
  encryptedValue: string
}

function readSecrets(): SecretRecord[] {
  const secretsPath = getSecretsPath()
  try {
    if (!existsSync(secretsPath)) {
      return []
    }
    const content = readFileSync(secretsPath, 'utf8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

function writeSecrets(secrets: SecretRecord[]): void {
  writeFileSync(getSecretsPath(), JSON.stringify(secrets, null, 2))
}

function shellEscapePath(pathValue: string): string {
  return `'${pathValue.replace(/'/g, `'\\''`)}'`
}

function expandClipboardFormatCandidates(format: string): string[] {
  const candidates = new Set<string>([format])

  if (format.includes('.') && !format.includes('/')) {
    candidates.add(format.replace('.', '/'))
  }

  if (format.includes('/') && !format.includes('.')) {
    candidates.add(format.replace('/', '.'))
  }

  return [...candidates]
}

function readClipboardFormatText(format: string): string | null {
  for (const candidate of expandClipboardFormatCandidates(format)) {
    try {
      const text = clipboard.read(candidate)
      if (text.length > 0) {
        return text
      }
    } catch {
      // Try the next candidate format.
    }

    try {
      const data = clipboard.readBuffer(candidate)
      if (data.length > 0) {
        return data.toString('utf8')
      }
    } catch {
      // Try the next candidate format.
    }
  }

  return null
}

function parseClipboardFilePaths(rawValue: string): string[] {
  return rawValue
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      if (value.startsWith('file://')) {
        try {
          return fileURLToPath(value)
        } catch {
          return value
        }
      }

      return value
    })
}

function readClipboardFilePaths(): string[] {
  const availableFormats = clipboard.availableFormats().map((format) => format.toLowerCase())
  const fileUrlFormats = ['public.file-url', 'public/file-url', 'text/uri-list', 'nsfilenamespboardtype']

  for (const format of fileUrlFormats) {
    const normalizedFormat = format.toLowerCase()
    if (!availableFormats.includes(normalizedFormat)) {
      continue
    }

    const rawValue = readClipboardFormatText(format)
    if (!rawValue) {
      continue
    }

    const paths = parseClipboardFilePaths(rawValue)
    if (paths.length > 0) {
      return paths
    }
  }

  return []
}

function readClipboardImagePath(): string | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return null
  }

  const imageBytes = image.toPNG()
  if (imageBytes.length === 0) {
    return null
  }

  const tempDir = path.join(app.getPath('temp'), 'termide-clipboard')
  mkdirSync(tempDir, { recursive: true })
  const filePath = path.join(tempDir, `clipboard-${randomUUID()}.png`)
  writeFileSync(filePath, imageBytes)
  return filePath
}

function smartPasteClipboardContents(): string {
  // Match terminal-emulator behavior: prefer explicit file URLs, then plain text,
  // and only fall back to image-to-temp-file conversion when there is no text.
  const filePaths = readClipboardFilePaths()
  if (filePaths.length > 0) {
    return filePaths.map(shellEscapePath).join(' ')
  }

  const text = clipboard.readText()
  if (text.length > 0) {
    return text
  }

  const imagePath = readClipboardImagePath()
  if (imagePath) {
    return shellEscapePath(imagePath)
  }

  return ''
}

function broadcastTerminalSettings(settings: TerminalSettings): void {
  const payload = { settings }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }

    window.webContents.send('settings:terminal-changed', payload)
  }
}

function broadcastMacros(macros: MacroDefinition[]): void {
  const payload = { macros }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }

    window.webContents.send('settings:macros-changed', payload)
  }
}

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

function getConfiguredShells(settings: TerminalSettings): string[] {
  if (settings.shell.program.trim().length > 0) {
    return [settings.shell.program.trim()]
  }

  return getCandidateShells()
}

function getShellBaseName(shellPath: string): string {
  return path.basename(shellPath).toLowerCase()
}

function getShellStartupArgs(shellPath: string, startupMode: TerminalSettings['shell']['startupMode']): string[] {
  const resolvedMode =
    startupMode === 'auto'
      ? (process.platform === 'darwin' ? 'login' : 'non-login')
      : startupMode

  if (resolvedMode !== 'login') {
    return []
  }

  const shellBaseName = getShellBaseName(shellPath)
  if (['zsh', 'bash', 'sh', 'ksh', 'fish'].includes(shellBaseName)) {
    return ['-l']
  }

  return []
}

function parseCommandLineArgs(value: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let escaping = false

  for (const char of value) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === '\'') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) {
    current += '\\'
  }

  if (current.length > 0) {
    args.push(current)
  }

  return args
}

function getTerminalSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // xterm.js renders true color, but many CLI tools only enable 24-bit output
  // when COLORTERM explicitly advertises it.
  env.COLORTERM = 'truecolor'

  if (process.platform !== 'darwin') {
    return env
  }

  const utf8Locale = env.LC_ALL || env.LC_CTYPE || env.LANG || 'en_US.UTF-8'
  const normalizedLocale = utf8Locale.toUpperCase().includes('UTF-8') ? utf8Locale : 'en_US.UTF-8'

  // GUI-launched macOS apps may not inherit a UTF-8 locale, which breaks non-ASCII PTY I/O like emoji.
  env.LANG = normalizedLocale
  env.LC_CTYPE = normalizedLocale

  return env
}

async function normalizeSpawnCwd(cwd?: string): Promise<string> {
  const fallbackCwd = app.getPath('home')

  if (!cwd) {
    return fallbackCwd
  }

  try {
    const cwdStats = await stat(cwd)
    return cwdStats.isDirectory() ? cwd : fallbackCwd
  } catch {
    return fallbackCwd
  }
}

async function getChildProcessIds(pid: number): Promise<number[]> {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)])
      return stdout
        .split('\n')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    }

    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)])
      return stdout
        .split('\n')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    }
  } catch {
    return []
  }

  return []
}

async function resolveDeepestProcessPid(pid: number): Promise<number> {
  let currentPid = pid

  while (true) {
    const childPids = await getChildProcessIds(currentPid)
    if (childPids.length !== 1) {
      return currentPid
    }

    currentPid = childPids[0]
  }
}

async function resolveProcessCwd(pid: number): Promise<string | null> {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await execFileAsync('readlink', [`/proc/${pid}/cwd`])
      const cwd = stdout.trim()
      return cwd.length > 0 ? cwd : null
    }

    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)])
      const cwdLine = stdout
        .split('\n')
        .find((line) => line.startsWith('n'))
      const cwd = cwdLine?.slice(1).trim()
      return cwd && cwd.length > 0 ? cwd : null
    }
  } catch {
    return null
  }

  return null
}

async function resolveTerminalCwd(sessionId: string): Promise<string | null> {
  const session = terminalSessions.get(sessionId)
  const rootPid = session?.process.pid

  if (!rootPid || rootPid <= 0) {
    return null
  }

  const deepestPid = await resolveDeepestProcessPid(rootPid)
  const deepestCwd = await resolveProcessCwd(deepestPid)
  if (deepestCwd) {
    return deepestCwd
  }

  if (deepestPid !== rootPid) {
    return resolveProcessCwd(rootPid)
  }

  return null
}

async function spawnWithFallbackShell(settings: TerminalSettings, cwd?: string): Promise<IPty> {
  const shells = getConfiguredShells(settings)
  let lastError: unknown = null
  const spawnCwd = await normalizeSpawnCwd(cwd)
  const spawnEnv = getTerminalSpawnEnv()
  const extraArgs = parseCommandLineArgs(settings.shell.extraArgs)

  for (const shellPath of shells) {
    if (process.platform !== 'win32' && shellPath.startsWith('/') && !existsSync(shellPath)) {
      continue
    }

    try {
      return pty.spawn(shellPath, [...getShellStartupArgs(shellPath, settings.shell.startupMode), ...extraArgs], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: spawnCwd,
        env: spawnEnv,
      })
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    `Unable to start a terminal shell. Tried: ${shells.join(', ')}. Last error: ${String(lastError)}`,
  )
}

async function createPtySession(webContentsId: number, cwd?: string): Promise<TerminalSession> {
  const id = randomUUID()
  const ptyProcess = await spawnWithFallbackShell(readTerminalSettings(), cwd)

  const session: TerminalSession = {
    id,
    ownerWebContentsId: webContentsId,
    process: ptyProcess,
  }

  terminalSessions.set(id, session)
  remoteAccessService.ensureSession(id)
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
  remoteAccessService.removeSession(id)
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
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettingsWindow(),
        },
        {
          label: 'Macros',
          accelerator: 'CmdOrCtrl+;',
          click: () => openMacrosWindow(),
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
        {
          label: 'Open Macro Launcher',
          accelerator: 'CmdOrCtrl+L',
          click: () => sendCommandToFocusedWindow('open-macro-launcher'),
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
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => resetZoom(),
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => zoomIn(),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => zoomOut(),
        },
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
  const windowIconPath = getWindowIconPath()

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

function openSettingsWindow(sectionId?: string): void {
  const preloadPath = path.join(__dirname, 'preload.mjs')
  const windowIconPath = getWindowIconPath()

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    if (sectionId) {
      settingsWindow.webContents.send('settings:focus-section', { sectionId })
    }
    return
  }

  settingsWindow = new BrowserWindow({
    icon: windowIconPath,
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'Termide Settings',
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  if (VITE_DEV_SERVER_URL) {
    const target = new URL(VITE_DEV_SERVER_URL)
    target.searchParams.set('view', 'settings')
    if (sectionId) {
      target.searchParams.set('section', sectionId)
    }
    settingsWindow.loadURL(target.toString())
  } else {
    settingsWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
      query: sectionId ? { view: 'settings', section: sectionId } : { view: 'settings' },
    })
  }
}

function openMacrosWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.mjs')
  const windowIconPath = getWindowIconPath()

  if (macrosWindow && !macrosWindow.isDestroyed()) {
    macrosWindow.focus()
    return
  }

  macrosWindow = new BrowserWindow({
    icon: windowIconPath,
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: 'Termide Macros',
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  macrosWindow.on('closed', () => {
    macrosWindow = null
  })

  if (VITE_DEV_SERVER_URL) {
    macrosWindow.loadURL(`${VITE_DEV_SERVER_URL}?view=macros`)
  } else {
    macrosWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
      query: { view: 'macros' },
    })
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

  app.dock?.setIcon(icon)
}

ipcMain.handle('terminal:create', async (event, payload?: { cwd?: string }) => {
  const session = await createPtySession(event.sender.id, payload?.cwd)

  session.process.onData((data: string) => {
    sendToSessionRenderer(session, 'terminal:data', { id: session.id, data })
    remoteAccessService.appendSessionData(session.id, data)
  })

  session.process.onExit((exit: { exitCode: number; signal?: number }) => {
    sendToSessionRenderer(session, 'terminal:exit', {
      id: session.id,
      exitCode: exit.exitCode ?? 0,
    })
    remoteAccessService.markSessionExit(session.id, exit.exitCode ?? 0)
    terminalSessions.delete(session.id)
  })

  return { id: session.id }
})

ipcMain.handle('terminal:get-cwd', async (_event, payload: { id: string }) => {
  return resolveTerminalCwd(payload.id)
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
    remoteAccessService.updateSessionSize(payload.id, cols, rows)
  } catch {
    // can throw during teardown races
  }
})

ipcMain.on('terminal:kill', (_event, payload: { id: string }) => {
  killSession(payload.id)
})

ipcMain.on(
  'terminal:update-remote-metadata',
  (
    _event,
    payload: {
      id: string
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
  ) => {
    remoteAccessService.updateSessionMetadata(payload.id, payload)
  },
)

ipcMain.handle('terminal:get-zoom', () => {
  return terminalZoomLevel
})

ipcMain.handle('settings:get-terminal', () => {
  return readTerminalSettings()
})

ipcMain.handle('settings:update-terminal', (_event, payload: TerminalSettings) => {
  const settings = writeTerminalSettings(payload)
  broadcastTerminalSettings(settings)
  remoteAccessService.notifyStatusChanged()
  return settings
})

ipcMain.handle('settings:reset-terminal', () => {
  const settings = writeTerminalSettings(defaultTerminalSettings)
  broadcastTerminalSettings(settings)
  remoteAccessService.notifyStatusChanged()
  return settings
})

ipcMain.handle('macros:get', () => {
  return readMacros()
})

ipcMain.handle('macros:update', (_event, payload: MacroDefinition[]) => {
  const macros = writeMacros(payload)
  broadcastMacros(macros)
  return macros
})

ipcMain.handle('macros:reset', () => {
  const macros = writeMacros(defaultMacros)
  broadcastMacros(macros)
  return macros
})

ipcMain.handle('app:quit', () => {
  app.quit()
})

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  await shell.openExternal(url)
})

ipcMain.handle('clipboard:smart-paste', () => {
  return smartPasteClipboardContents()
})

ipcMain.handle('remote:get-status', () => {
  return remoteAccessService.getStatus()
})

ipcMain.handle('remote:toggle-server', async () => {
  return remoteAccessService.toggle()
})

ipcMain.handle('remote:revoke-device', async (_event, payload: { deviceId: string }) => {
  return remoteAccessService.revokeDevice(payload.deviceId)
})

ipcMain.handle('remote:close-connection', async (_event, payload: { connectionId: string }) => {
  return remoteAccessService.closeConnection(payload.connectionId)
})

ipcMain.handle('remote:set-pairing-address', async (_event, payload: { address: string }) => {
  return remoteAccessService.setPairingAddress(payload.address)
})

ipcMain.handle('app:open-settings', (_event, payload?: { sectionId?: string }) => {
  openSettingsWindow(payload?.sectionId)
})

ipcMain.handle('secrets:get', () => {
  const secrets = readSecrets()
  return secrets.map((s) => ({ id: s.id, name: s.name }))
})

ipcMain.handle('secrets:save', (_event, { name, value }) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system.')
  }
  const secrets = readSecrets()
  const id = randomUUID()
  const encryptedValue = safeStorage.encryptString(value).toString('base64')
  const record: SecretRecord = { id, name, encryptedValue }
  secrets.push(record)
  writeSecrets(secrets)
  return { id, name }
})

ipcMain.handle('secrets:delete', (_event, id) => {
  const secrets = readSecrets()
  const index = secrets.findIndex((s) => s.id === id)
  if (index !== -1) {
    secrets.splice(index, 1)
    writeSecrets(secrets)
  }
})

ipcMain.handle('secrets:get-decrypted', (_event, id) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system.')
  }
  const secrets = readSecrets()
  const secret = secrets.find((s) => s.id === id)
  if (!secret) {
    throw new Error('Secret not found.')
  }
  return safeStorage.decryptString(Buffer.from(secret.encryptedValue, 'base64'))
})

ipcMain.handle('terminal:wait-for-inactivity', async (_event, { id, durationMs }) => {
  const session = terminalSessions.get(id)
  if (!session) {
    return
  }

  return new Promise<void>((resolve) => {
    let timeout = setTimeout(() => {
      dataListener.dispose()
      resolve()
    }, durationMs)

    const dataListener = session.process.onData(() => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        dataListener.dispose()
        resolve()
      }, durationMs)
    })
  })
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
