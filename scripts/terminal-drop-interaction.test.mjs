import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-drop-interaction-'))
const outputPath = join(outputDirectory, 'terminalDropInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalDropInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
  target: 'node22',
})

const { escapeTerminalPathForShell, getTerminalDropText, shouldInterceptTerminalDrop } = await import(outputPath)

function drop({ types = [], files = [], values = {} } = {}) {
  return {
    types,
    files,
    getData(format) {
      return values[format] ?? ''
    },
  }
}

test('portable path drops stay available to a server-backed panel without Desktop IPC', () => {
  const dataTransfer = drop({
    types: ['terminay/path', 'text/plain'],
    values: { 'terminay/path': "/workspace/Mark's project" },
  })

  assert.equal(getTerminalDropText(dataTransfer), "'/workspace/Mark'\\''s project'")
  assert.equal(shouldInterceptTerminalDrop(dataTransfer), true)
  assert.equal(escapeTerminalPathForShell('~/project'), "'~/project'")
})

test('server-backed panels do not claim raw file drops that require Desktop path IPC', () => {
  let resolverCalls = 0
  const dataTransfer = drop({ types: ['Files'], files: [{ name: 'private.txt' }] })

  assert.equal(getTerminalDropText(dataTransfer), null)
  assert.equal(shouldInterceptTerminalDrop(dataTransfer), false)
  assert.equal(resolverCalls, 0)

  const resolver = () => {
    resolverCalls += 1
    return '/Users/mark/private.txt'
  }
  assert.equal(getTerminalDropText(dataTransfer, resolver), "'/Users/mark/private.txt'")
  assert.equal(shouldInterceptTerminalDrop(dataTransfer, resolver), true)
  assert.equal(resolverCalls, 1)
})

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

const panel = await readFile('src/components/TerminalPanel.tsx', 'utf8')

test('TerminalPanel gates Desktop file resolution to the narrow file-explorer host', () => {
  assert.match(panel, /const resolveDesktopDroppedFilePath = useServerTerminal\s*\? undefined\s*:\s*\(file: unknown\) => window\.terminayFileExplorerHost\?\.resolveDroppedFilePath/u)
  assert.doesNotMatch(panel, /window\.terminay\.getPathForFile/u)
  assert.match(panel, /getTerminalDropText\(event\.dataTransfer, resolveDesktopDroppedFilePath\)/u)
  assert.match(panel, /shouldInterceptTerminalDrop\(event\.dataTransfer, resolveDesktopDroppedFilePath\)/u)
})
