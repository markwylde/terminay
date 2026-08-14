import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CONNECTED_ROOTS = ['src/App.tsx', 'src/components', 'src/hooks', 'src/workspace', 'src/remote', 'src/services']
const DISCONNECTED_ALLOWLIST = [
  /^src\/compatibility\//u,
  /^src\/remote\/services\//u,
  /^src\/services\/[^/]+\/legacy[^/]*\.[cm]?[jt]sx?$/u,
]

// Native presentation surfaces do not own application state and are allowed.
const PRESENTATION_HOSTS = new Set([
  'terminayClipboardHost',
  'terminayExternalHost',
  'terminayProjectTabHost',
  'terminayRevealHost',
  'terminaySettingsWindowHost',
  'terminayTerminalPresentationHost',
  'terminayUpdateHost',
  'terminayWindowLifecycleHost',
  'terminayWorkspaceTransferHost',
])

const AUTHORITY_HOSTS = new Set([
  'terminayActivityHost',
  'terminayAgentStatusHost',
  'terminayFileExplorerHost',
  'terminayFileViewerHost',
  'terminayGitHost',
  'terminayRecordingsAuthorityHost',
  'terminayTerminalHost',
  'terminayTerminalLifecycleHost',
  'terminayWorkspaceHost',
])

const COMPATIBILITY_SYMBOLS = [
  'createLegacyFileViewerClient',
  'terminayFileGateway',
  'terminayFileExplorerGateway',
  'legacyTerminalClient',
  'legacyWorkspaceClient',
]

export async function auditOneServerModel(root = process.cwd()) {
  const files = []
  for (const entry of CONNECTED_ROOTS) {
    const absolute = resolve(root, entry)
    if (extname(absolute)) files.push(absolute)
    else await collect(absolute, files)
  }
  const violations = []
  for (const file of files) {
    const path = relative(root, file).replaceAll('\\', '/')
    if (DISCONNECTED_ALLOWLIST.some((pattern) => pattern.test(path))) continue
    const source = await readFile(file, 'utf8')
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
      for (const match of line.matchAll(/window\.(terminay[A-Za-z0-9_]+)/gu)) {
        const host = match[1]
        if (PRESENTATION_HOSTS.has(host)) continue
        if (AUTHORITY_HOSTS.has(host)) {
		  violations.push({ path, line: index + 1, symbol: host, source: line.trim() })
        }
      }
      for (const symbol of COMPATIBILITY_SYMBOLS) {
        if (new RegExp(`\\b${symbol}\\b`, 'u').test(line)) {
          violations.push({ path, line: index + 1, symbol, source: line.trim() })
        }
      }
    }
  }
  return violations
}

async function collect(directory, files) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) }
  catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path, files)
    else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(path)
  }
}

export function formatViolations(violations) {
  return violations.map((item) => `${item.path}:${item.line} ${item.symbol} — ${item.source}`).join('\n')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const violations = await auditOneServerModel()
  if (violations.length > 0) {
    console.error(`Connected renderer authority boundary violations (${violations.length}):\n${formatViolations(violations)}`)
    process.exitCode = 1
  } else {
    console.log('Connected renderer one-server-model boundary: clean')
  }
}
