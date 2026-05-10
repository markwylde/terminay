import { app, BrowserWindow, Menu, clipboard, ipcMain, nativeImage, shell, webContents, safeStorage } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile, fork, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, type Dirent } from 'node:fs'
import { lstat, readdir, stat, rename, rm, mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { defaultMacros, normalizeMacros } from '../src/macroSettings'
import { defaultTerminalSettings, normalizeTerminalSettings } from '../src/terminalSettings'
import { findCommandForKeyboardEvent, getCommandShortcut } from '../src/keyboardShortcuts'
import { registerAiTabMetadataIpcHandlers } from './aiTabMetadata/ipc'
import { AiTabMetadataService } from './aiTabMetadata/service'
import type { MacroDefinition } from '../src/types/macros'
import type { TerminalSettings } from '../src/types/settings'
import type {
  AppCommand,
  AppUpdateStatus,
  AiTabMetadataModel,
  EditWindowResult,
  EditWindowState,
  FileExplorerEntry,
  FileSearchResult,
  ProjectEditWindowDraft,
  ProjectEditWindowResult,
  TerminalEditWindowDraft,
  TerminalEditWindowResult,
} from '../src/types/terminay'
import { FileBufferService } from './fileViewer/fileBufferService'
import { FileWatchService } from './fileViewer/fileWatchService'
import { GitDiffService } from './fileViewer/gitDiffService'
import { registerFileViewerIpcHandlers } from './fileViewer/ipc'
import { FileExplorerWatchService } from './fileExplorerWatchService'
import { RemoteAccessService } from './remote/service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)
const RELEASES_LATEST_URL = 'https://github.com/markwylde/terminay/releases/latest'
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

process.env.APP_ROOT = path.join(__dirname, '..')
app.setName('Terminay')

const customUserDataPath = process.env.TERMINAY_USER_DATA_DIR?.trim()
if (customUserDataPath) {
  app.setPath('userData', customUserDataPath)
}

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
    return getBrandAssetPath('icon.ico') ?? getBrandAssetPath('terminay.png') ?? undefined
  }

  if (process.platform === 'darwin') {
    return getBrandAssetPath('icon.icns') ?? getBrandAssetPath('terminay.png') ?? undefined
  }

  return getBrandAssetPath('terminay.png') ?? getBrandAssetPath('terminay.svg') ?? undefined
}

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
  host: ChildProcess
  rootPid: number | null
  exited: boolean
  inactivityWaiters: Map<string, () => void>
}

type PtyHostMessage =
  | { type: 'ready'; pid: number }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }
  | { type: 'inactive'; requestId: string }

const terminalSessions = new Map<string, TerminalSession>()
let settingsWindow: BrowserWindow | null = null
let macrosWindow: BrowserWindow | null = null
const pendingEditWindows = new Map<
  number,
  {
    resolve: (result: ProjectEditWindowResult | TerminalEditWindowResult | null) => void
    settled: boolean
    state: EditWindowState
    window: BrowserWindow
  }
>()
const fileBufferService = new FileBufferService(() => app.getPath('home'))
const fileWatchService = new FileWatchService(fileBufferService)
const fileExplorerWatchService = new FileExplorerWatchService(() => app.getPath('home'))
const gitDiffService = new GitDiffService(fileBufferService)
const aiTabMetadataService = new AiTabMetadataService(app.getPath('home'))
let cachedAppUpdateStatus: AppUpdateStatus | null = null
let appUpdateFetchPromise: Promise<AppUpdateStatus> | null = null
const remoteAccessService = new RemoteAccessService({
  app,
  getControllableSession: (sessionId) => {
    const session = terminalSessions.get(sessionId)
    return session
      ? {
          close: () => killSession(sessionId),
          resize: (cols: number, rows: number) => sendToPtyHost(session, { type: 'resize', cols, rows }),
          write: (data: string) => sendToPtyHost(session, { type: 'write', data }),
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

function normalizeVersion(value: string): string | null {
  const match = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/.exec(value.trim())
  if (!match?.groups) {
    return null
  }

  return `${match.groups.major}.${match.groups.minor}.${match.groups.patch}`
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10))
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10))

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart !== rightPart) {
      return leftPart - rightPart
    }
  }

  return 0
}

async function fetchAppUpdateStatus(): Promise<AppUpdateStatus> {
  const currentVersion = normalizeVersion(app.getVersion()) ?? '0.0.0'

  if (currentVersion === '0.0.0') {
    return {
      checkedAt: new Date().toISOString(),
      currentVersion,
      errorMessage: null,
      hasUpdate: false,
      latestVersion: null,
      releaseUrl: null,
    }
  }

  try {
    const response = await fetch(RELEASES_LATEST_URL, {
      headers: {
        Accept: 'text/html',
        'User-Agent': `Terminay/${currentVersion}`,
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`GitHub responded with ${response.status}`)
    }

    const releaseUrl = response.url
    const latestTag = releaseUrl.match(/\/tag\/(v?\d+\.\d+\.\d+)\/?$/)?.[1] ?? null
    const latestVersion = latestTag ? normalizeVersion(latestTag) : null

    if (!latestVersion) {
      throw new Error('Could not determine the latest version from the GitHub release URL.')
    }

    return {
      checkedAt: new Date().toISOString(),
      currentVersion,
      errorMessage: null,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      latestVersion,
      releaseUrl,
    }
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      currentVersion,
      errorMessage: error instanceof Error ? error.message : 'Unable to check for updates.',
      hasUpdate: false,
      latestVersion: null,
      releaseUrl: null,
    }
  }
}

async function getAppUpdateStatus(options?: { force?: boolean }): Promise<AppUpdateStatus> {
  const force = options?.force === true
  const checkedAtMs = cachedAppUpdateStatus?.checkedAt
    ? Date.parse(cachedAppUpdateStatus.checkedAt)
    : Number.NaN
  const isCachedValueFresh =
    cachedAppUpdateStatus !== null &&
    Number.isFinite(checkedAtMs) &&
    Date.now() - checkedAtMs < UPDATE_CHECK_INTERVAL_MS

  if (!force && isCachedValueFresh && cachedAppUpdateStatus) {
    return cachedAppUpdateStatus
  }

  if (!appUpdateFetchPromise) {
    appUpdateFetchPromise = fetchAppUpdateStatus()
      .then((status) => {
        cachedAppUpdateStatus = status
        return status
      })
      .finally(() => {
        appUpdateFetchPromise = null
      })
  }

  return appUpdateFetchPromise
}

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

function resolveExplorerPath(rawPath: string): string {
  const trimmedPath = rawPath.trim()
  if (trimmedPath === '~') {
    return app.getPath('home')
  }

  if (trimmedPath.startsWith('~/') || trimmedPath.startsWith('~\\')) {
    return path.join(app.getPath('home'), trimmedPath.slice(2))
  }

  return trimmedPath
}

async function readDirectoryEntries(dirPath: string): Promise<FileExplorerEntry[]> {
  const resolvedPath = resolveExplorerPath(dirPath)
  const directoryEntries = await readdir(resolvedPath, { withFileTypes: true })
  const items = await Promise.all(
    directoryEntries.map(async (entry) => {
      const entryPath = path.join(resolvedPath, entry.name)
      const stats = await lstat(entryPath)

      return {
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink(),
        name: entry.name,
        path: entryPath,
      } satisfies FileExplorerEntry
    }),
  )

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })

  return items
}

const FILE_SEARCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  '.vite',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
])
const FILE_SEARCH_SCAN_LIMIT = 25_000

function normalizeFileSearchPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function getFileSearchContext(rootPath: string, query: string) {
  const resolvedRoot = resolveExplorerPath(rootPath)
  const normalizedQuery = normalizeFileSearchPath(query).trim()
  const lastSeparatorIndex = normalizedQuery.lastIndexOf('/')
  const prefix = lastSeparatorIndex >= 0 ? normalizedQuery.slice(0, lastSeparatorIndex + 1) : ''
  const term = lastSeparatorIndex >= 0 ? normalizedQuery.slice(lastSeparatorIndex + 1) : normalizedQuery
  const isAbsolute = normalizedQuery.startsWith('/') || path.isAbsolute(normalizedQuery)
  const basePath = isAbsolute
    ? path.resolve(prefix || path.parse(resolvedRoot).root)
    : path.resolve(resolvedRoot, prefix || '.')

  return {
    basePath,
    displayPrefix: prefix,
    term,
  }
}

function getFuzzyTokenScore(source: string, token: string): number {
  let lastMatchIndex = -1
  let score = 0

  for (const character of token) {
    const matchIndex = source.indexOf(character, lastMatchIndex + 1)
    if (matchIndex === -1) {
      return 0
    }

    score += matchIndex === lastMatchIndex + 1 ? 15 : 5
    if (matchIndex === 0 || /[/._-]/.test(source[matchIndex - 1] ?? '')) {
      score += 10
    }
    lastMatchIndex = matchIndex
  }

  return score
}

function getFileSearchScore(relativePath: string, query: string): number {
  const normalizedQuery = normalizeFileSearchPath(query).trim().toLowerCase()
  if (!normalizedQuery) {
    return 1
  }

  const candidatePath = normalizeFileSearchPath(relativePath).toLowerCase()
  const candidateName = path.posix.basename(candidatePath)
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean)
  let score = 0

  for (const token of queryTokens) {
    if (candidatePath === token) {
      score += 10_000
      continue
    }
    if (candidateName === token) {
      score += 9_000
      continue
    }
    if (candidateName.startsWith(token)) {
      score += 5_000 - candidateName.length
      continue
    }
    if (candidatePath.startsWith(token)) {
      score += 4_000 - candidatePath.length
      continue
    }

    const nameSubstringIndex = candidateName.indexOf(token)
    if (nameSubstringIndex !== -1) {
      score += 3_000 - nameSubstringIndex
      continue
    }

    const pathSubstringIndex = candidatePath.indexOf(token)
    if (pathSubstringIndex !== -1) {
      score += 2_000 - pathSubstringIndex
      continue
    }

    const fuzzyScore = Math.max(
      getFuzzyTokenScore(candidateName, token),
      getFuzzyTokenScore(candidatePath, token),
    )
    if (fuzzyScore === 0) {
      return 0
    }

    score += 1_000 + fuzzyScore
  }

  return score
}

async function searchFiles(rootPath: string, query: string, limit = 60): Promise<FileSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const searchContext = getFileSearchContext(rootPath, trimmedQuery)
  const rootStats = await stat(searchContext.basePath)
  if (!rootStats.isDirectory()) {
    return []
  }

  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 60
  const boundedLimit = Math.max(1, Math.min(requestedLimit, 200))
  const matches: Array<FileSearchResult & { score: number }> = []
  const directories = ['']
  let scannedFileCount = 0

  while (directories.length > 0 && scannedFileCount < FILE_SEARCH_SCAN_LIMIT) {
    const relativeDirectory = directories.shift() ?? ''
    const absoluteDirectory = path.join(searchContext.basePath, relativeDirectory)
    let entries: Dirent[]

    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const relativePath = path.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        if (!FILE_SEARCH_IGNORED_DIRECTORIES.has(entry.name)) {
          const displayPath = normalizeFileSearchPath(relativePath)
          const score = getFileSearchScore(displayPath, searchContext.term)
          if (score > 0) {
            matches.push({
              isDirectory: true,
              path: path.join(searchContext.basePath, relativePath),
              relativePath: `${searchContext.displayPrefix}${displayPath}/`,
              score: score + 50,
            })
          }

          directories.push(relativePath)
        }
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      scannedFileCount += 1
      const displayPath = normalizeFileSearchPath(relativePath)
      const score = getFileSearchScore(displayPath, searchContext.term)
      if (score <= 0) {
        continue
      }

      matches.push({
        isDirectory: false,
        path: path.join(searchContext.basePath, relativePath),
        relativePath: `${searchContext.displayPrefix}${displayPath}`,
        score,
      })
    }
  }

  return matches
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base', numeric: true })
    })
    .slice(0, boundedLimit)
    .map(({ score: _score, ...result }) => result)
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

  const tempDir = path.join(app.getPath('temp'), 'terminay-clipboard')
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
  const rootPid = session?.rootPid

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

function getPtyHostPath(): string {
  return path.join(MAIN_DIST, 'ptyHost.js')
}

function sendToPtyHost(session: TerminalSession, message: Record<string, unknown>): void {
  if (session.exited || !session.host.connected) {
    return
  }

  try {
    session.host.send(message)
  } catch {
    // The PTY host may have crashed or exited between the connected check and send.
  }
}

function finalizeTerminalSession(session: TerminalSession, exitCode: number): void {
  if (session.exited) {
    return
  }

  session.exited = true
  terminalSessions.delete(session.id)
  remoteAccessService.markSessionExit(session.id, exitCode)
  sendToSessionRenderer(session, 'terminal:exit', {
    id: session.id,
    exitCode,
  })

  for (const resolve of session.inactivityWaiters.values()) {
    resolve()
  }
  session.inactivityWaiters.clear()
}

async function buildPtySpawnOptions(settings: TerminalSettings, cwd?: string): Promise<{
  shellPath: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}> {
  const shells = getConfiguredShells(settings)
  const spawnCwd = await normalizeSpawnCwd(cwd)
  const spawnEnv = getTerminalSpawnEnv()
  const extraArgs = parseCommandLineArgs(settings.shell.extraArgs)

  for (const shellPath of shells) {
    if (process.platform !== 'win32' && shellPath.startsWith('/') && !existsSync(shellPath)) {
      continue
    }

    return {
      shellPath,
      args: [...getShellStartupArgs(shellPath, settings.shell.startupMode), ...extraArgs],
      cwd: spawnCwd,
      env: spawnEnv,
    }
  }

  throw new Error(`Unable to start a terminal shell. Tried: ${shells.join(', ')}`)
}

async function createPtySession(webContentsId: number, cwd?: string): Promise<TerminalSession> {
  const id = randomUUID()
  const spawnOptions = await buildPtySpawnOptions(readTerminalSettings(), cwd)
  const host = fork(getPtyHostPath(), {
    env: {
      ...process.env,
      TERMINAY_PTY_HOST: '1',
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })

  const session: TerminalSession = {
    id,
    ownerWebContentsId: webContentsId,
    host,
    rootPid: null,
    exited: false,
    inactivityWaiters: new Map(),
  }

  return new Promise<TerminalSession>((resolve, reject) => {
    let settled = false

    const fail = (error: Error) => {
      if (settled) {
        return
      }

      settled = true
      try {
        host.kill()
      } catch {
        // best-effort cleanup
      }
      reject(error)
    }

    const handleMessage = (message: PtyHostMessage) => {
      switch (message.type) {
        case 'ready':
          session.rootPid = message.pid
          terminalSessions.set(id, session)
          remoteAccessService.ensureSession(id)
          settled = true
          resolve(session)
          break
        case 'data':
          sendToSessionRenderer(session, 'terminal:data', { id: session.id, data: message.data })
          remoteAccessService.appendSessionData(session.id, message.data)
          break
        case 'exit':
          finalizeTerminalSession(session, message.exitCode)
          break
        case 'error':
          if (!settled) {
            fail(new Error(message.message))
          }
          break
        case 'inactive':
          session.inactivityWaiters.get(message.requestId)?.()
          session.inactivityWaiters.delete(message.requestId)
          break
      }
    }

    host.on('message', handleMessage)
    host.once('error', (error) => {
      fail(error)
    })
    host.once('exit', (code, signal) => {
      if (!settled) {
        fail(new Error(`PTY host exited before startup (${signal ?? code ?? 'unknown'})`))
        return
      }

      if (!session.exited) {
        finalizeTerminalSession(session, typeof code === 'number' ? code : 1)
      }
    })

    sendToPtyHost(session, {
      type: 'create',
      ...spawnOptions,
    })
  })
}

function killSession(id: string): void {
  const session = terminalSessions.get(id)
  if (!session) {
    return
  }

  sendToPtyHost(session, { type: 'kill' })
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
  const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow
  targetWindow?.webContents.send('app:command', command)
}

function bindAppShortcuts(webContents: Electron.WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (
      settingsWindow?.webContents.id === webContents.id ||
      macrosWindow?.webContents.id === webContents.id ||
      pendingEditWindows.has(webContents.id)
    ) {
      return
    }

    if (input.type !== 'keyDown') {
      return
    }

    const command = findCommandForKeyboardEvent(
      {
        altKey: input.alt,
        ctrlKey: input.control,
        key: input.key,
        metaKey: input.meta,
        shiftKey: input.shift,
      },
      readTerminalSettings().keyboardShortcuts,
      process.platform === 'darwin',
    )

    if (!command) {
      return
    }

    event.preventDefault()
    webContents.send('app:command', command)
  })
}

function getMenuShortcut(settings: TerminalSettings, command: AppCommand): string | undefined {
  const shortcut = getCommandShortcut(settings.keyboardShortcuts, command)
  return shortcut.length > 0 ? shortcut : undefined
}

function shouldAutoHideMenuBar(): boolean {
  return process.platform !== 'linux'
}

function sendCopyRequestToFocusedWindow(browserWindow?: Electron.BaseWindow): void {
  const target = browserWindow instanceof BrowserWindow ? browserWindow : BrowserWindow.getFocusedWindow()
  target?.webContents.copy()
  target?.webContents.send('terminal:copy-requested')
}

function createAppMenu(settings: TerminalSettings = readTerminalSettings()): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Terminay',
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
          label: 'Create a new terminal tab',
          accelerator: getMenuShortcut(settings, 'new-terminal'),
          click: () => sendCommandToFocusedWindow('new-terminal'),
        },
        {
          label: 'Create a new project',
          accelerator: getMenuShortcut(settings, 'new-project'),
          click: () => sendCommandToFocusedWindow('new-project'),
        },
        {
          type: 'separator',
        },
        {
          label: 'Save',
          accelerator: getMenuShortcut(settings, 'save-active'),
          click: () => sendCommandToFocusedWindow('save-active'),
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
          accelerator: getMenuShortcut(settings, 'close-active'),
          click: () => sendCommandToFocusedWindow('close-active'),
        },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'Split Horizontally',
          accelerator: getMenuShortcut(settings, 'split-horizontal'),
          click: () => sendCommandToFocusedWindow('split-horizontal'),
        },
        {
          label: 'Split Vertically',
          accelerator: getMenuShortcut(settings, 'split-vertical'),
          click: () => sendCommandToFocusedWindow('split-vertical'),
        },
        {
          label: 'Pop Out Active Terminal',
          accelerator: getMenuShortcut(settings, 'popout-active'),
          click: () => sendCommandToFocusedWindow('popout-active'),
        },
        {
          label: 'Open Command Bar',
          accelerator: getMenuShortcut(settings, 'open-command-bar'),
          click: () => sendCommandToFocusedWindow('open-command-bar'),
        },
        {
          label: 'Clear Terminal',
          accelerator: getMenuShortcut(settings, 'clear-terminal'),
          click: () => sendCommandToFocusedWindow('clear-terminal'),
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
        {
          label: 'Copy',
          accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+C' : 'CmdOrCtrl+Shift+C',
          click: (_menuItem, browserWindow) => sendCopyRequestToFocusedWindow(browserWindow ?? undefined),
        },
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
        {
          label: 'Set Project Root to Working Directory',
          accelerator: getMenuShortcut(settings, 'set-project-root-folder-to-working-directory'),
          click: () => sendCommandToFocusedWindow('set-project-root-folder-to-working-directory'),
        },
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
  const usesOverlayTitlebar = process.platform === 'win32'
  const windowIconPath = getWindowIconPath()

  mainWindow = new BrowserWindow({
    icon: windowIconPath,
    width: 1400,
    height: 900,
    title: 'Terminay',
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
    mainWindow?.setTitle('Terminay')
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
        title: 'Terminay',
        width: 1000,
        height: 700,
        titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
        trafficLightPosition: isMac
          ? {
              x: 14,
              y: 12,
            }
          : undefined,
        autoHideMenuBar: shouldAutoHideMenuBar(),
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

  void getAppUpdateStatus()
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

  const isMac = process.platform === 'darwin'
  const usesOverlayTitlebar = process.platform === 'win32'

  settingsWindow = new BrowserWindow({
    icon: windowIconPath,
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'Terminay Settings',
    titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
    titleBarOverlay: usesOverlayTitlebar
      ? {
          color: '#0d1117',
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
    autoHideMenuBar: shouldAutoHideMenuBar(),
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

  const isMac = process.platform === 'darwin'
  const usesOverlayTitlebar = process.platform === 'win32'

  macrosWindow = new BrowserWindow({
    icon: windowIconPath,
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: 'Terminay Macros',
    titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
    titleBarOverlay: usesOverlayTitlebar
      ? {
          color: '#0d1117',
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
    autoHideMenuBar: shouldAutoHideMenuBar(),
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

function getEditWindowUrl(kind: EditWindowState['kind']): string {
  if (VITE_DEV_SERVER_URL) {
    const target = new URL(VITE_DEV_SERVER_URL)
    target.searchParams.set('view', 'edit-tab')
    target.searchParams.set('kind', kind)
    return target.toString()
  }

  return path.join(RENDERER_DIST, 'index.html')
}

function openEditWindow(
  parentWindow: BrowserWindow | null,
  state: EditWindowState,
): Promise<ProjectEditWindowResult | TerminalEditWindowResult | null> {
  const preloadPath = path.join(__dirname, 'preload.mjs')
  const windowIconPath = getWindowIconPath()
  const height = state.kind === 'project' ? 700 : 640

  return new Promise((resolve) => {
    const editWindow = new BrowserWindow({
      parent: parentWindow ?? undefined,
      modal: true,
      icon: windowIconPath,
      useContentSize: true,
      width: 500,
      height,
      minWidth: 500,
      maxWidth: 500,
      minHeight: height,
      maxHeight: height,
      title: state.kind === 'project' ? 'Edit Project Tab' : 'Edit Terminal Tab',
      // On macOS, 'panel' prevents the window from becoming a "sheet"
      // while modal: true is set, allowing for a native title bar.
      type: process.platform === 'darwin' ? 'panel' : undefined,
      titleBarStyle: 'default',
      autoHideMenuBar: shouldAutoHideMenuBar(),
      backgroundColor: '#0d0f12',
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      resizable: true,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    const editWindowWebContentsId = editWindow.webContents.id

    const settle = (result: ProjectEditWindowResult | TerminalEditWindowResult | null) => {
      const pending = pendingEditWindows.get(editWindowWebContentsId)
      if (!pending || pending.settled) {
        return
      }

      pending.settled = true
      pendingEditWindows.delete(editWindowWebContentsId)
      resolve(result)
    }

    pendingEditWindows.set(editWindowWebContentsId, {
      resolve: settle,
      settled: false,
      state,
      window: editWindow,
    })

    editWindow.once('ready-to-show', () => {
      editWindow.show()
    })

    editWindow.on('closed', () => {
      settle(null)
    })

    if (VITE_DEV_SERVER_URL) {
      void editWindow.loadURL(getEditWindowUrl(state.kind))
      return
    }

    void editWindow.loadFile(getEditWindowUrl(state.kind), {
      query: {
        kind: state.kind,
        view: 'edit-tab',
      },
    })
  })
}

function setDockIcon(): void {
  if (process.platform !== 'darwin') {
    return
  }

  const iconPath = getBrandAssetPath('icon.icns') ?? getBrandAssetPath('terminay.png')

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

  sendToPtyHost(session, { type: 'write', data: payload.data })
})

ipcMain.on('terminal:resize', (_event, payload: { id: string; cols: number; rows: number }) => {
  const session = terminalSessions.get(payload.id)
  if (!session) {
    return
  }

  const cols = Math.max(2, Math.floor(payload.cols))
  const rows = Math.max(1, Math.floor(payload.rows))

  try {
    sendToPtyHost(session, { type: 'resize', cols, rows })
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
      inheritsProjectColor?: boolean
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

ipcMain.handle('fs:get-home-path', () => {
  return app.getPath('home')
})

ipcMain.handle('fs:list-directory', async (_event, payload: { dirPath: string }) => {
  return readDirectoryEntries(payload.dirPath)
})

ipcMain.handle('fs:search-files', async (_event, payload: { rootPath: string; query: string; limit?: number }) => {
  return searchFiles(payload.rootPath, payload.query, payload.limit)
})

ipcMain.handle('fs:get-git-statuses', async (_event, payload: { dirPath: string }) => {
  return gitDiffService.getExplorerStatuses(payload.dirPath)
})

ipcMain.handle('fs:rename', async (_event, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
  await rename(oldPath, newPath)
})

ipcMain.handle('fs:delete', async (_event, { path }: { path: string }) => {
  await rm(path, { recursive: true, force: true })
})

ipcMain.handle('fs:mkdir', async (_event, { path }: { path: string }) => {
  await mkdir(path, { recursive: true })
})

ipcMain.handle('fs:watch-directory', async (event, { path }: { path: string }) => {
  fileExplorerWatchService.watchDirectory(event.sender.id, path)
})

ipcMain.handle('fs:unwatch-directory', async (event, { path }: { path: string }) => {
  fileExplorerWatchService.unwatchDirectory(event.sender.id, path)
})

ipcMain.handle('settings:get-terminal', () => {
  return readTerminalSettings()
})

ipcMain.handle('settings:update-terminal', (_event, payload: TerminalSettings) => {
  const settings = writeTerminalSettings(payload)
  broadcastTerminalSettings(settings)
  createAppMenu(settings)
  remoteAccessService.notifyStatusChanged()
  return settings
})

ipcMain.handle('settings:reset-terminal', () => {
  const settings = writeTerminalSettings(defaultTerminalSettings)
  broadcastTerminalSettings(settings)
  createAppMenu(settings)
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

ipcMain.handle('app:get-update-status', async (_event, options?: { force?: boolean }) => {
  return getAppUpdateStatus(options)
})

ipcMain.handle('clipboard:smart-paste', () => {
  return smartPasteClipboardContents()
})

ipcMain.handle('clipboard:write-text', (_event, text: string) => {
  clipboard.writeText(text)
})

ipcMain.handle('app:open-project-edit', async (event, draft: ProjectEditWindowDraft) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? null
  const result = await openEditWindow(parentWindow, {
    draft,
    kind: 'project',
  })

  if (!result) {
    return null
  }

  return result as ProjectEditWindowResult
})

ipcMain.handle('app:open-terminal-edit', async (event, draft: TerminalEditWindowDraft) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? null
  const result = await openEditWindow(parentWindow, {
    draft,
    kind: 'terminal',
  })

  if (!result) {
    return null
  }

  return result as TerminalEditWindowResult
})

ipcMain.handle('app:get-edit-window-state', (event) => {
  const pending = pendingEditWindows.get(event.sender.id)
  return pending?.state ?? null
})

ipcMain.handle('app:submit-edit-window-result', async (event, result: EditWindowResult) => {
  const pending = pendingEditWindows.get(event.sender.id)
  if (!pending) {
    return
  }

  if (pending.state.kind !== result.kind) {
    throw new Error(`Mismatched edit window result kind: expected ${pending.state.kind}, received ${result.kind}.`)
  }

  pending.resolve(result.result)
  if (!pending.window.isDestroyed()) {
    pending.window.close()
  }
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

ipcMain.handle('app:open-macros', () => {
  openMacrosWindow()
})

if (process.env.TERMINAY_TEST === '1') {
  ipcMain.handle('test:send-app-command', (event, command: AppCommand) => {
    event.sender.send('app:command', command)
  })

  ipcMain.handle(
    'test:set-ai-tab-metadata-mock',
    (
      _event,
      mock: {
        error?: string | null
        models?: AiTabMetadataModel[]
        noteResult?: string
        titleResult?: string
      },
    ) => {
      aiTabMetadataService.setTestMock(mock)
    },
  )
}

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
    const requestId = randomUUID()
    session.inactivityWaiters.set(requestId, resolve)
    sendToPtyHost(session, { type: 'waitForInactivity', requestId, durationMs })
  })
})

app.on('web-contents-created', (_event, contents) => {
  bindAppShortcuts(contents)

  contents.once('destroyed', () => {
    killSessionsForWebContents(contents.id)
    fileExplorerWatchService.disposeSubscriber(contents.id)
    fileWatchService.disposeSubscriber(contents.id)
  })
})

registerFileViewerIpcHandlers({
  fileBufferService,
  fileWatchService,
  gitDiffService,
  ipcMain,
})

registerAiTabMetadataIpcHandlers({
  aiTabMetadataService,
  ipcMain,
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
  app.setName('Terminay')
  app.setAboutPanelOptions({ applicationName: 'Terminay' })
  ensureNodePtySpawnHelperIsExecutable()
  setDockIcon()
  createAppMenu()
  createWindow()
})
