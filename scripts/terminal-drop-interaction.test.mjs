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

const { escapeTerminalPathForShell, getTerminalDropText, shouldInterceptTerminalDrop, uploadBrowserTerminalDrop } = await import(outputPath)

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

test('Desktop raw file drops use the privileged host resolver', () => {
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

test('web raw file drops upload bounded bytes and insert server paths', async () => {
  const uploads = []
  const file = { name: "Mark's notes.txt", size: 3, async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer } }
  const text = await uploadBrowserTerminalDrop([file], '/srv/project', async (path, bytes) => uploads.push({ path, bytes: Array.from(bytes) }))
  assert.equal(text, "'/srv/project/Mark'\\''s notes.txt'")
  assert.deepEqual(uploads, [{ path: "Mark's notes.txt", bytes: [1, 2, 3] }])
  assert.equal(shouldInterceptTerminalDrop(drop({ types: ['Files'], files: [file] }), undefined, true), true)
})

test('web file drops reject oversized files and unsafe names before upload', async () => {
  let uploads = 0
  const upload = async () => { uploads += 1 }
  await assert.rejects(
    uploadBrowserTerminalDrop([{ name: 'large.bin', size: 4 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(0) }], '/srv/project', upload),
    /maximum 4 MB/u,
  )
  await assert.rejects(
    uploadBrowserTerminalDrop([{ name: '../escape', size: 0, arrayBuffer: async () => new ArrayBuffer(0) }], '/srv/project', upload),
    /maximum 4 MB/u,
  )
  assert.equal(uploads, 0)
})

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

const panel = await readFile('src/components/TerminalPanel.tsx', 'utf8')

test('TerminalPanel selects Desktop resolution or browser upload at the host boundary', () => {
  assert.match(panel, /const resolveDesktopDroppedFilePath = window\.terminayFileExplorerHost === undefined/u)
  assert.doesNotMatch(panel, /window\.terminay\.getPathForFile/u)
  assert.match(panel, /getTerminalDropText\(event\.dataTransfer, resolveDesktopDroppedFilePath\)/u)
  assert.match(panel, /uploadBrowserTerminalDrop/u)
  assert.match(panel, /const handleDrop = async[\s\S]*shouldInterceptTerminalDrop[\s\S]*event\.preventDefault\(\)/u)
})
