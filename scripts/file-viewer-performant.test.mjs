import assert from 'node:assert/strict'
import {
  appendFile,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-performant-bundle-'))
const outputPath = path.join(bundleDirectory, 'file-buffer-service.cjs')
const projectionOutputPath = path.join(bundleDirectory, 'sparse-projection.cjs')

await build({
  bundle: true,
  entryPoints: ['electron/fileViewer/fileBufferService.ts'],
  format: 'cjs',
  logLevel: 'silent',
  outfile: outputPath,
  platform: 'node',
})
await build({
  bundle: true,
  entryPoints: ['src/services/fileViewer/sparseProjection.ts'],
  format: 'cjs',
  logLevel: 'silent',
  outfile: projectionOutputPath,
  platform: 'node',
})

const { FileBufferService, MAX_TEXT_INDEX_BYTES_PER_REQUEST } = require(outputPath)
const {
  applySparseEdits,
  getProjectedSize,
  mapProjectedOffset,
  readProjectedRange,
} = require(projectionOutputPath)

test.after(async () => {
  await rm(bundleDirectory, { force: true, recursive: true })
})

async function createProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'terminay-performant-project-'))
  return {
    projectRoot,
    service: new FileBufferService(() => projectRoot),
  }
}

function encodeBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

test('projects length-changing sparse edits for ranged views and logical byte offsets', async () => {
  const original = Buffer.from('abc\ndef', 'utf8')
  const edits = [{ dataBase64: encodeBase64('XYZ\nQ'), end: 3, start: 1 }]
  const expected = Buffer.from('aXYZ\nQ\ndef', 'utf8')

  assert.equal(getProjectedSize(original.length, edits), expected.length)
  assert.deepEqual(Buffer.from(applySparseEdits(original, edits)), expected)
  assert.deepEqual(mapProjectedOffset(original.length, edits, 0), {
    kind: 'original',
    originalOffset: 0,
  })
  assert.deepEqual(mapProjectedOffset(original.length, edits, 4), {
    editIndex: 0,
    kind: 'replacement',
    replacementOffset: 3,
  })
  assert.deepEqual(mapProjectedOffset(original.length, edits, 6), {
    kind: 'original',
    originalOffset: 3,
  })
  const ranged = await readProjectedRange(
    original.length,
    edits,
    2,
    6,
    async (start, length) => original.subarray(start, start + length),
  )
  assert.equal(Buffer.from(ranged).toString('utf8'), 'YZ\nQ\nd')
})

test('indexes and reads UTF-8 lines whose code points cross scan chunk boundaries', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'boundary.txt')

  try {
    const firstLine = `${'a'.repeat(65_535)}雪 end`
    await writeFile(filePath, `${firstLine}\nsecond\r\nthird`, 'utf8')

    const metadata = await service.getTextMetadata(filePath, projectRoot)
    assert.equal(metadata.lineCount, 3)
    assert.equal(metadata.size, Buffer.byteLength(`${firstLine}\nsecond\r\nthird`))

    const firstWindow = await service.readTextLines(filePath, projectRoot, 0, 2)
    assert.equal(firstWindow.lines[0].text, firstLine)
    assert.equal(firstWindow.lines[1].text, 'second')
    assert.equal(firstWindow.lines[1].end - firstWindow.lines[1].start, 6)
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('returns a bounded partial index before continuing a very large text scan', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'incremental-index.txt')

  try {
    const line = `${'a'.repeat(62)}\n`
    const source = line.repeat(Math.ceil((MAX_TEXT_INDEX_BYTES_PER_REQUEST + 1024) / line.length))
    await writeFile(filePath, source, 'utf8')

    const first = await service.getTextMetadata(filePath, projectRoot)
    assert.equal(first.isComplete, false)
    assert.equal(first.indexedByteLength, MAX_TEXT_INDEX_BYTES_PER_REQUEST)
    assert.equal(first.lineCount < source.split('\n').length, true)

    const firstPage = await service.readTextLines(filePath, projectRoot, 0, 128)
    assert.equal(firstPage.lines.length, 128)
    assert.equal(firstPage.lines[0].text, 'a'.repeat(62))

    const complete = await service.getTextMetadata(filePath, projectRoot)
    assert.equal(complete.isComplete, true)
    assert.equal(complete.indexedByteLength, Buffer.byteLength(source))
    assert.equal(complete.lineCount, source.split('\n').length)
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('preserves BOM, CRLF, and multibyte byte ranges across a 128-line page boundary', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'page-boundary.txt')

  try {
    const sourceLines = Array.from(
      { length: 129 },
      (_, index) => `${index === 0 ? '\uFEFF' : ''}line ${index + 1}${index === 127 ? ' 雪' : ''}\r\n`,
    )
    await writeFile(filePath, sourceLines.join(''), 'utf8')
    const firstPage = (await service.readTextLines(filePath, projectRoot, 0, 128)).lines
    const secondPage = (await service.readTextLines(filePath, projectRoot, 128, 1)).lines
    const firstPageText = firstPage.map((line) => `${line.text}${line.eol}`).join('')
    const firstPageEnd = firstPage[127].end + Buffer.byteLength(firstPage[127].eol)

    assert.equal(firstPage[0].text.startsWith('\uFEFF'), true)
    assert.equal(firstPage[127].text.endsWith('雪'), true)
    assert.equal(firstPage[127].eol, '\r\n')
    assert.equal(Buffer.byteLength(firstPageText), firstPageEnd - firstPage[0].start)
    assert.equal(secondPage[0].start, firstPageEnd)
    assert.equal(secondPage[0].lineNumber, 128)
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('applies sorted sparse UTF-8 replacements atomically without loading a full-file payload', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'edit.txt')

  try {
    await writeFile(filePath, 'alpha\n雪 beta\nomega\n', 'utf8')
    const metadata = await service.getTextMetadata(filePath, projectRoot)
    const window = await service.readTextLines(filePath, projectRoot, 1, 1)
    const line = window.lines[0]

    await service.saveSparseFile({
      edits: [{ dataBase64: encodeBase64('雪 changed'), end: line.end, start: line.start }],
      expectedIno: metadata.ino,
      expectedMtimeMs: metadata.mtimeMs,
      expectedSize: metadata.size,
      path: filePath,
      projectRoot,
    })

    assert.equal(await readFile(filePath, 'utf8'), 'alpha\n雪 changed\nomega\n')
    assert.deepEqual(
      (await readdir(projectRoot)).filter((name) => name.endsWith('.tmp')),
      [],
    )
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('applies a bounded page replacement that inserts and joins UTF-8 lines', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'structural.txt')

  try {
    await writeFile(filePath, 'alpha\n雪 beta\nomega\n', 'utf8')
    const metadata = await service.getTextMetadata(filePath, projectRoot)
    const lines = (await service.readTextLines(filePath, projectRoot, 0, 2)).lines
    const end = lines[1].end + Buffer.byteLength(lines[1].eol)

    await service.saveSparseFile({
      edits: [{
        dataBase64: encodeBase64('alpha changed\ninserted 雪\njoined beta\n'),
        end,
        start: lines[0].start,
      }],
      expectedIno: metadata.ino,
      expectedMtimeMs: metadata.mtimeMs,
      expectedSize: metadata.size,
      path: filePath,
      projectRoot,
    })

    assert.equal(await readFile(filePath, 'utf8'), 'alpha changed\ninserted 雪\njoined beta\nomega\n')
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('applies a sparse byte replacement to a binary file', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'large.bin')

  try {
    await writeFile(filePath, Buffer.from([0x00, 0x01, 0x02, 0xff]))
    const info = await service.getFileInfo(filePath)
    assert.notEqual(info.ino, null)
    assert.notEqual(info.mtimeMs, null)

    await service.saveSparseFile({
      edits: [{ dataBase64: Buffer.from([0x7f]).toString('base64'), end: 3, start: 2 }],
      expectedIno: info.ino,
      expectedMtimeMs: info.mtimeMs,
      expectedSize: info.size,
      path: filePath,
      projectRoot,
    })

    assert.deepEqual(await readFile(filePath), Buffer.from([0x00, 0x01, 0x7f, 0xff]))
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('rejects stale revisions and leaves the newer file untouched', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'stale.txt')

  try {
    await writeFile(filePath, 'before\n', 'utf8')
    const metadata = await service.getTextMetadata(filePath, projectRoot)
    const line = (await service.readTextLines(filePath, projectRoot, 0, 1)).lines[0]
    await appendFile(filePath, 'newer\n', 'utf8')

    await assert.rejects(
      service.saveSparseFile({
        edits: [{ dataBase64: encodeBase64('after'), end: line.end, start: line.start }],
        expectedIno: metadata.ino,
        expectedMtimeMs: metadata.mtimeMs,
        expectedSize: metadata.size,
        path: filePath,
        projectRoot,
      }),
      /changed on disk/,
    )
    assert.equal(await readFile(filePath, 'utf8'), 'before\nnewer\n')
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('rejects a symlink replacement and never mutates its target', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'victim.txt')
  const movedPath = path.join(projectRoot, 'victim-original.txt')
  const targetPath = path.join(projectRoot, 'target.txt')

  try {
    await writeFile(filePath, 'victim\n', 'utf8')
    await writeFile(targetPath, 'target\n', 'utf8')
    const metadata = await service.getTextMetadata(filePath, projectRoot)
    const line = (await service.readTextLines(filePath, projectRoot, 0, 1)).lines[0]
    await rename(filePath, movedPath)
    await symlink(targetPath, filePath)

    await assert.rejects(
      service.saveSparseFile({
        edits: [{ dataBase64: encodeBase64('changed'), end: line.end, start: line.start }],
        expectedIno: metadata.ino,
        expectedMtimeMs: metadata.mtimeMs,
        expectedSize: metadata.size,
        path: filePath,
        projectRoot,
      }),
      /does not follow a file symlink/,
    )
    assert.equal(await readFile(targetPath, 'utf8'), 'target\n')
    assert.equal(await readFile(movedPath, 'utf8'), 'victim\n')
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('rejects an inode replacement even when the expected size and mtime match the replacement', async () => {
  const { projectRoot, service } = await createProject()
  const filePath = path.join(projectRoot, 'inode.txt')
  const replacementPath = path.join(projectRoot, 'inode-replacement.txt')

  try {
    await writeFile(filePath, 'before\n', 'utf8')
    const original = await service.getTextMetadata(filePath, projectRoot)
    const line = (await service.readTextLines(filePath, projectRoot, 0, 1)).lines[0]
    await writeFile(replacementPath, 'newer!\n', 'utf8')
    await rename(replacementPath, filePath)
    const replacement = await service.getFileInfo(filePath)

    await assert.rejects(
      service.saveSparseFile({
        edits: [{ dataBase64: encodeBase64('after!'), end: line.end, start: line.start }],
        expectedIno: original.ino,
        expectedMtimeMs: replacement.mtimeMs,
        expectedSize: replacement.size,
        path: filePath,
        projectRoot,
      }),
      /changed on disk/,
    )
    assert.equal(await readFile(filePath, 'utf8'), 'newer!\n')
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
  }
})

test('rejects paths outside the canonical project and invalid edit ordering without mutation', async () => {
  const { projectRoot, service } = await createProject()
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'terminay-performant-outside-'))
  const filePath = path.join(projectRoot, 'ordered.txt')
  const outsidePath = path.join(outsideRoot, 'outside.txt')

  try {
    await writeFile(filePath, 'first\nsecond\n', 'utf8')
    await writeFile(outsidePath, 'outside\n', 'utf8')
    await assert.rejects(service.getTextMetadata(outsidePath, projectRoot), /outside the canonical project scope/)

    const metadata = await service.getTextMetadata(filePath, projectRoot)
    const lines = (await service.readTextLines(filePath, projectRoot, 0, 2)).lines
    await assert.rejects(
      service.saveSparseFile({
        edits: [
          { dataBase64: encodeBase64('second edit'), end: lines[1].end, start: lines[1].start },
          { dataBase64: encodeBase64('first edit'), end: lines[0].end, start: lines[0].start },
        ],
        expectedIno: metadata.ino,
        expectedMtimeMs: metadata.mtimeMs,
        expectedSize: metadata.size,
        path: filePath,
        projectRoot,
      }),
      /sorted, non-overlapping/,
    )
    assert.equal(await readFile(filePath, 'utf8'), 'first\nsecond\n')
    assert.deepEqual(
      (await readdir(projectRoot)).filter((name) => name.endsWith('.tmp')),
      [],
    )
  } finally {
    await rm(projectRoot, { force: true, recursive: true })
    await rm(outsideRoot, { force: true, recursive: true })
  }
})
