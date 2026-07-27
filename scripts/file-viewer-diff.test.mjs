import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-file-diff-test-'))

async function bundle(entryPoint, outputName) {
  const outputPath = path.join(bundleDirectory, outputName)
  await build({
    bundle: true,
    entryPoints: [entryPoint],
    format: 'cjs',
    logLevel: 'silent',
    outfile: outputPath,
    platform: 'node',
  })
  return require(outputPath)
}

const { buildSideBySideDiffRows, buildUnifiedDiffRows, getVirtualDiffRange } = await bundle(
  'src/components/file-viewer/modes/diffRows.ts',
  'diff-rows.cjs',
)
const {
  GitDiffService,
  MAX_FILE_DIFF_BYTES,
  MAX_NORMALIZED_DIFF_LINE_BYTES,
  normalizeGitPatch,
} = await bundle(
  'electron/fileViewer/gitDiffService.ts',
  'git-diff-service.cjs',
)

test.after(async () => {
  await rm(bundleDirectory, { force: true, recursive: true })
})

const hunk = {
  header: '@@ -1,3 +1,4 @@',
  lines: [
    { newLineNumber: 1, oldLineNumber: 1, type: 'context', value: 'same' },
    { newLineNumber: null, oldLineNumber: 2, type: 'delete', value: 'old one' },
    { newLineNumber: null, oldLineNumber: 3, type: 'delete', value: 'old two' },
    { newLineNumber: 2, oldLineNumber: null, type: 'add', value: 'new one' },
    { newLineNumber: 3, oldLineNumber: null, type: 'add', value: 'new two' },
    { newLineNumber: 4, oldLineNumber: null, type: 'add', value: 'new three' },
  ],
}

test('builds different unified and side-by-side row models', () => {
  const unified = buildUnifiedDiffRows([hunk])
  const sideBySide = buildSideBySideDiffRows([hunk])

  assert.equal(unified.length, 7)
  assert.equal(sideBySide.length, 5)
  assert.equal(sideBySide[1].kind, 'pair')
  assert.equal(sideBySide[1].left.value, 'same')
  assert.equal(sideBySide[1].right.value, 'same')
  assert.equal(sideBySide[2].left.value, 'old one')
  assert.equal(sideBySide[2].right.value, 'new one')
  assert.equal(sideBySide[4].left, null)
  assert.equal(sideBySide[4].right.value, 'new three')
})

test('virtual range stays bounded and follows scrolling', () => {
  const first = getVirtualDiffRange({
    overscan: 10,
    rowCount: 100_000,
    rowHeight: 30,
    scrollTop: 0,
    viewportHeight: 600,
  })
  const later = getVirtualDiffRange({
    overscan: 10,
    rowCount: 100_000,
    rowHeight: 30,
    scrollTop: 60_000,
    viewportHeight: 600,
  })

  assert.deepEqual(first, { endIndex: 30, startIndex: 0 })
  assert.deepEqual(later, { endIndex: 2030, startIndex: 1990 })
})

test('normalizes raw Git patches into bounded privileged diff rows', () => {
  const result = normalizeGitPatch(
    [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -2,2 +2,3 @@ heading',
      ' same',
      '-old',
      '+new',
      '+extra',
      '\\ No newline at end of file',
      '',
    ].join('\n'),
  )

  assert.equal(result.tooLarge, false)
  assert.deepEqual(result.hunks, [{
    header: '@@ -2,2 +2,3 @@ heading',
    lines: [
      { newLineNumber: 2, oldLineNumber: 2, type: 'context', value: 'same' },
      { newLineNumber: null, oldLineNumber: 3, type: 'delete', value: 'old' },
      { newLineNumber: 3, oldLineNumber: null, type: 'add', value: 'new' },
      { newLineNumber: 4, oldLineNumber: null, type: 'add', value: 'extra' },
    ],
  }])

  const oversized = normalizeGitPatch(
    `@@ -1 +1 @@\n-${'a'.repeat(MAX_NORMALIZED_DIFF_LINE_BYTES + 1)}`,
  )
  assert.deepEqual(oversized, { hunks: [], tooLarge: true })
})

test('Git diff output is bounded and reports a too-large state', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'terminay-large-diff-'))
  const filePath = path.join(repository, 'large.txt')

  try {
    await execFileAsync('git', ['init'], { cwd: repository })
    await execFileAsync('git', ['config', 'user.email', 'diff-test@example.com'], { cwd: repository })
    await execFileAsync('git', ['config', 'user.name', 'Diff Test'], { cwd: repository })
    await writeFile(filePath, 'initial\n', 'utf8')
    await execFileAsync('git', ['add', 'large.txt'], { cwd: repository })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repository })
    const changedLine = `${'0123456789abcdef'.repeat(4)}\n`
    const changed = changedLine.repeat(Math.ceil((MAX_FILE_DIFF_BYTES + 1024) / changedLine.length))
    await writeFile(filePath, changed, 'utf8')

    const service = new GitDiffService({
      getFileInfo: async () => ({
        isDirectory: false,
        name: 'large.txt',
        path: filePath,
      }),
    })
    const result = await service.getDiff(filePath)

    assert.equal(result.hasDiff, true)
    assert.deepEqual(result.hunks, [])
    assert.equal('patch' in result, false)
    assert.equal(result.tooLarge, true)
    assert.equal((await readFile(filePath)).byteLength > MAX_FILE_DIFF_BYTES, true)
  } finally {
    await rm(repository, { force: true, recursive: true })
  }
})
