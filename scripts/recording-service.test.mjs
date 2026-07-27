import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const {
  MAX_RECORDING_CHUNK_BYTES,
  TerminalRecordingService,
} = await importBundled('../electron/recording/service.ts')
const { writeRecordedTerminalInput } = await importBundled('../electron/recording/inputBoundary.ts')
const { defaultTerminalSettings } = await importBundled('../src/terminalSettings.ts')

function createHarness(home, initialRoot, overrides = {}) {
  const settings = {
    ...defaultTerminalSettings,
    recording: {
      ...defaultTerminalSettings.recording,
      captureInput: false,
      directory: initialRoot,
      ...overrides,
    },
  }
  const options = {
    getHomePath: () => home,
    getLibraryIndexPath: () => join(home, 'library', 'recording-roots.json'),
    getSettings: () => settings,
  }
  return { options, service: new TerminalRecordingService(options), settings }
}

async function findRecordingFiles(root, recordingId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const dateDirectories = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
    for (const directory of dateDirectories) {
      const base = join(root, directory.name, recordingId)
      try {
        await stat(`${base}.cast`)
        return { cast: `${base}.cast`, metadata: `${base}.json` }
      } catch {
        // The write stream may not have created the cast yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Recording files not found for ${recordingId}`)
}

async function readStable(filePath) {
  let previous = null
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const current = await readFile(filePath, 'utf8')
      if (current === previous) return current
      previous = current
    } catch {
      // The stream may not have created the cast yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Recording did not stabilize: ${filePath}`)
}

function assertPathFree(value) {
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(serialized, /castPath|metadataPath/)
  assert.doesNotMatch(serialized, /\/(?:Users|home|tmp|private)\//)
}

test('the shared input boundary records and writes each authorized payload exactly once', () => {
  const recorded = []
  const written = []
  writeRecordedTerminalInput(
    { appendInput: (sessionId, data) => recorded.push({ data, sessionId }) },
    'remote-or-local-session',
    'payload',
    (data) => written.push(data),
  )
  assert.deepEqual(recorded, [{ data: 'payload', sessionId: 'remote-or-local-session' }])
  assert.deepEqual(written, ['payload'])
})

test('public DTOs are opaque-id-only while persisted files are private and completed atomically', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-contract-'))
  const root = join(home, 'recordings')
  try {
    const { service, settings } = createHarness(home, root, { captureInput: true, sensitiveInputPolicy: 'mask' })
    const started = service.start('session-one', { cwd: join(home, 'project'), shell: '/bin/zsh', title: 'Shell' })
    assertPathFree(started)
    service.appendOutput('session-one', 'Password: ')
    service.appendInput('session-one', 'secret\n')
    const stopped = service.finalize('session-one', 7, 15)
    assertPathFree(stopped)

    const files = await findRecordingFiles(root, started.recordingId)
    const cast = await readStable(files.cast)
    const metadata = JSON.parse(await readFile(files.metadata, 'utf8'))
    assert.equal(metadata.version, 2)
    assert.equal(metadata.recordingState, 'completed')
    assert.equal(metadata.signal, 15)
    assert.equal(metadata.relativeCastPath.includes(home), false)
    assert.equal('castPath' in metadata, false)
    assert.equal(cast.includes('secret'), false)
    assert.equal(cast.includes('******'), true)
    assert.equal((await stat(root)).mode & 0o777, 0o700)
    assert.equal((await stat(files.cast)).mode & 0o777, 0o600)
    assert.equal((await stat(files.metadata)).mode & 0o777, 0o600)
    assert.equal((await readdir(join(root, (await readdir(root))[0]))).some((name) => name.endsWith('.tmp')), false)

    const [listed] = await service.listRecordings()
    assertPathFree(listed)
    assert.equal(listed.cwdLabel, 'project')
    assert.equal(listed.shellName, 'zsh')
    assert.equal(listed.recordingState, 'completed')
    assert.equal(listed.signal, 15)

    let content = ''
    let start = 0
    for (;;) {
      const chunk = await service.readRecordingChunk({ recordingId: listed.recordingId, start, maxBytes: 256 })
      content += chunk.content
      start = chunk.nextOffset
      if (chunk.eof) break
    }
    assert.equal(content, cast)
    await assert.rejects(
      service.readRecordingChunk({ recordingId: listed.recordingId, maxBytes: MAX_RECORDING_CHUNK_BYTES + 1 }),
      /chunk size/i,
    )
    settings.recording.captureInput = false
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

test('the live input toggle affects only later events', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-toggle-'))
  const root = join(home, 'recordings')
  try {
    const { service, settings } = createHarness(home, root)
    const started = service.start('session-toggle')
    service.appendInput('session-toggle', 'before-off')
    settings.recording.captureInput = true
    service.appendInput('session-toggle', 'captured')
    settings.recording.captureInput = false
    service.appendInput('session-toggle', 'after-off')
    settings.recording.captureInput = true
    service.appendInput('session-toggle', 'captured-later')
    service.finalize('session-toggle')
    const files = await findRecordingFiles(root, started.recordingId)
    const cast = await readStable(files.cast)
    assert.equal(cast.includes('before-off'), false)
    assert.equal(cast.includes('captured'), true)
    assert.equal(cast.includes('after-off'), false)
    assert.equal(cast.includes('captured-later'), true)
    const [listed] = await service.listRecordings()
    assert.equal(listed.capturedInput, true)
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

test('startup recovery marks orphaned recordings interrupted and retains old configured roots', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-recovery-'))
  const firstRoot = join(home, 'first')
  const secondRoot = join(home, 'second')
  try {
    const harness = createHarness(home, firstRoot)
    const orphan = harness.service.start('orphan')
    harness.service.appendOutput('orphan', 'survives restart')
    const files = await findRecordingFiles(firstRoot, orphan.recordingId)
    await readStable(files.cast)

    harness.settings.recording.directory = secondRoot
    const restarted = new TerminalRecordingService(harness.options)
    const recovered = await restarted.listRecordings()
    assert.equal(recovered.some((item) => item.recordingId === orphan.recordingId && item.recordingState === 'interrupted'), true)

    const second = restarted.start('second-root')
    restarted.appendOutput('second-root', 'new root')
    restarted.finalize('second-root')
    const acrossRoots = await restarted.listRecordings()
    assert.deepEqual(new Set(acrossRoots.map((item) => item.recordingId)), new Set([orphan.recordingId, second.recordingId]))
    assertPathFree(acrossRoots)
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

test('startup recovery preserves an incomplete cast created before its sidecar', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-orphan-cast-'))
  const root = join(home, 'recordings')
  const dateDirectory = join(root, '2026-07-27')
  const recordingId = '00000000-0000-4000-8000-000000000001'
  try {
    await mkdir(dateDirectory, { recursive: true })
    await writeFile(join(dateDirectory, `${recordingId}.cast`), '')
    const { service } = createHarness(home, root)
    const [recovered] = await service.listRecordings()
    assert.equal(recovered.recordingId, recordingId)
    assert.equal(recovered.recordingState, 'interrupted')
    assert.equal(recovered.castAvailable, true)
    assert.equal(recovered.title, 'Incomplete terminal recording')
    const metadata = JSON.parse(await readFile(join(dateDirectory, `${recordingId}.json`), 'utf8'))
    assert.equal(metadata.recordingId, recordingId)
    assert.equal(metadata.recordingState, 'interrupted')
    assert.equal(metadata.endedAt !== null, true)
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

test('persisting a new root retains historical roots that are temporarily unavailable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-unavailable-root-'))
  const firstRoot = join(home, 'first')
  const unavailableRoot = join(home, 'first-unmounted')
  const secondRoot = join(home, 'second')
  try {
    const harness = createHarness(home, firstRoot)
    const first = harness.service.start('first')
    harness.service.appendOutput('first', 'historical')
    harness.service.finalize('first')
    await readStable((await findRecordingFiles(firstRoot, first.recordingId)).cast)
    const indexedFirstRoot = await realpath(firstRoot)
    await rename(firstRoot, unavailableRoot)

    harness.settings.recording.directory = secondRoot
    const whileUnavailable = new TerminalRecordingService(harness.options)
    const second = whileUnavailable.start('second')
    whileUnavailable.finalize('second')
    const index = JSON.parse(await readFile(harness.options.getLibraryIndexPath(), 'utf8'))
    assert.equal(index.roots.includes(indexedFirstRoot), true)
    assert.equal(index.roots.some((root) => root.endsWith('/second')), true)

    await rename(unavailableRoot, firstRoot)
    const afterRemount = new TerminalRecordingService(harness.options)
    const recordings = await afterRemount.listRecordings()
    assert.deepEqual(new Set(recordings.map((item) => item.recordingId)), new Set([first.recordingId, second.recordingId]))
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

test('active recordings cannot be deleted by id and unknown ids do not authorize paths', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-delete-'))
  const root = join(home, 'recordings')
  try {
    const { service } = createHarness(home, root)
    const started = service.start('active')
    service.appendOutput('active', 'running')
    await assert.rejects(service.deleteRecordingById(started.recordingId), /stop the active/i)
    await assert.rejects(service.resolveRevealPathById('../outside'), /invalid/i)
    service.finalize('active')
    await service.deleteRecordingById(started.recordingId)
    await assert.rejects(service.resolveRevealPathById(started.recordingId), /does not exist/i)
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

test('metadata write failure reports a deterministic path-free failed state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-fault-'))
  const root = join(home, 'recordings')
  try {
    const { options } = createHarness(home, root)
    options.writeMetadataAtomically = () => {
      throw new Error(`${root}/private-sidecar.json could not be written`)
    }
    const service = new TerminalRecordingService(options)
    const started = service.start('fault')
    assert.equal(started.status, 'failed')
    assert.equal(started.errorMessage, 'The recording could not be written.')
    assert.equal(service.getState('fault').status, 'failed')
    assert.equal(service.activeRecordings.size, 0)
    assertPathFree(started)
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

test('a disk-full cast stream error removes the active writer and persists failed lifecycle metadata', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-recording-stream-fault-'))
  const root = join(home, 'recordings')
  try {
    const { service } = createHarness(home, root)
    const started = service.start('stream-fault')
    const active = service.activeRecordings.get('stream-fault')
    assert.ok(active)
    const files = await findRecordingFiles(root, started.recordingId)
    await readStable(files.cast)
    active.stream.emit('error', Object.assign(new Error(`${root}/private.cast failed`), { code: 'ENOSPC' }))
    assert.equal(service.activeRecordings.size, 0)
    assert.equal(service.getState('stream-fault').status, 'failed')
    assertPathFree(service.getState('stream-fault'))
    await readStable(files.metadata)
    const metadata = JSON.parse(await readFile(files.metadata, 'utf8'))
    assert.equal(metadata.recordingState, 'failed')
    assert.equal(metadata.endedAt !== null, true)
  } finally {
    await rm(home, { force: true, recursive: true })
  }
})

async function importBundled(relativePath) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'terminay-recording-service-bundle-'))
  const outputPath = join(temporaryDirectory, `${relativePath.split('/').pop()}.mjs`)
  try {
    await build({
      bundle: true,
      entryPoints: [new URL(relativePath, import.meta.url).pathname],
      format: 'esm',
      outfile: outputPath,
      platform: 'node',
      target: 'node20',
    })
    return await import(outputPath)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}
