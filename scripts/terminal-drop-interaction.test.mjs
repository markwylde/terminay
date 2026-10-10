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
  target: 'node24',
})

const { escapeTerminalPathForShell, getDroppedPath, getPastedPath, getTerminalDropText, pathFromFileUrl, shouldInterceptTerminalDrop, uploadBrowserTerminalDrop } = await import(outputPath)

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

test('raw file drops never recover a host-local filesystem path', () => {
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

test('TerminalPanel uploads file drops through the selected-server client', () => {
  assert.match(panel, /const resolveDesktopDroppedFilePath = undefined/u)
  assert.doesNotMatch(panel, /terminayFileExplorerHost/u)
  assert.doesNotMatch(panel, /window\.terminay\.getPathForFile/u)
  assert.match(panel, /getTerminalDropText\(event\.dataTransfer, resolveDesktopDroppedFilePath\)/u)
  assert.match(panel, /uploadBrowserTerminalDrop/u)
  assert.match(panel, /const handleDrop = async[\s\S]*shouldInterceptTerminalDrop[\s\S]*event\.preventDefault\(\)/u)
})

test('a file URL becomes its path', () => {
  assert.equal(pathFromFileUrl('file:///Users/sam/notes%20a.md'), '/Users/sam/notes a.md')
  assert.equal(pathFromFileUrl('  file:///tmp/x\n'), '/tmp/x')
  assert.equal(pathFromFileUrl('file:///C:/Users/sam/a.txt'), 'C:/Users/sam/a.txt')
  assert.equal(pathFromFileUrl('/Users/sam/notes.md'), null)
  assert.equal(pathFromFileUrl('https://example.com/a'), null)
})

test('a dropped path is taken unescaped from Terminay data, text, a file URL, or a host-resolved file', () => {
  assert.deepEqual(getDroppedPath(drop({ types: ['terminay/path'], values: { 'terminay/path': "/work/it's here.txt" } })), { kind: 'path', path: "/work/it's here.txt" })
  assert.deepEqual(getDroppedPath(drop({ values: { 'text/plain': '~/notes.md' } })), { kind: 'path', path: '~/notes.md' })
  assert.deepEqual(getDroppedPath(drop({ values: { 'text/uri-list': '# comment\r\nfile:///tmp/a%20b.txt\r\n' } })), { kind: 'path', path: '/tmp/a b.txt' })
  assert.deepEqual(getDroppedPath(drop({ values: { 'text/plain': 'file:///tmp/c.txt' } })), { kind: 'path', path: '/tmp/c.txt' })
  const file = { name: 'report.pdf' }
  assert.deepEqual(getDroppedPath(drop({ types: ['Files'], files: [file] }), (value) => value === file ? '/Users/sam/report.pdf' : undefined), { kind: 'path', path: '/Users/sam/report.pdf' })
  // Words that are not a path are not a drop this field understands.
  assert.equal(getDroppedPath(drop({ values: { 'text/plain': 'hello world' } })), null)
})

test('a dropped file whose path the host cannot resolve is reported as unavailable', () => {
  const file = { name: 'report.pdf' }
  assert.deepEqual(getDroppedPath(drop({ types: ['Files'], files: [file] })), { kind: 'unavailable' })
  assert.deepEqual(getDroppedPath(drop({ types: ['Files'], files: [file] }), () => undefined), { kind: 'unavailable' })
})

test('a paste supplies a path only for a copied file or a file URL', () => {
  const file = { name: 'report.pdf' }
  assert.deepEqual(getPastedPath(drop({ files: [file] }), () => '/Users/sam/report.pdf'), { kind: 'path', path: '/Users/sam/report.pdf' })
  assert.deepEqual(getPastedPath(drop({ values: { 'text/plain': 'file:///Users/sam/notes%20a.md' } })), { kind: 'path', path: '/Users/sam/notes a.md' })
  assert.deepEqual(getPastedPath(drop({ files: [file] })), { kind: 'unavailable' })
  // A copied file that also offers its URL as text still yields a path on a host that cannot resolve the file.
  assert.deepEqual(getPastedPath(drop({ files: [file], values: { 'text/plain': 'file:///Users/sam/report.pdf' } })), { kind: 'path', path: '/Users/sam/report.pdf' })
  // A plain path pastes as ordinary text, so the field is left to handle it.
  assert.equal(getPastedPath(drop({ values: { 'text/plain': '/Users/sam/notes.md' } })), null)
})
