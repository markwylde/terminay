import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import headlessXterm from '@xterm/headless'
import { build } from 'esbuild'

const { Terminal: HeadlessTerminal } = headlessXterm
const {
  buildReplayIndex,
  findReplayCheckpoint,
  restoreReplayCursor,
} = await importBundled('../src/recordingReplay.ts')

function makeCast(events, options = {}) {
  const header = JSON.stringify({
    version: 3,
    term: { cols: 80, rows: 24 },
    timestamp: 1_753_632_000,
    title: options.title ?? 'Replay test',
  })
  const records = events.map((event) => JSON.stringify(event))
  return `${[header, ...records].join('\n')}\n${options.partialTail ?? ''}`
}

function createChunkReader(recordingId, content, requests = []) {
  const bytes = Buffer.from(content, 'utf8')
  return async ({ maxBytes = 64 * 1024, recordingId: requestedId, start = 0 }) => {
    assert.equal(requestedId, recordingId)
    requests.push({ maxBytes, start })
    if (start === bytes.length) {
      return {
        content: '',
        eof: true,
        incompleteTail: false,
        nextOffset: start,
        recordingId,
        start,
        totalSize: bytes.length,
      }
    }
    const candidate = bytes.subarray(start, Math.min(bytes.length, start + maxBytes))
    const newline = candidate.lastIndexOf(0x0a)
    if (newline < 0) {
      return {
        content: '',
        eof: true,
        incompleteTail: true,
        nextOffset: bytes.length,
        recordingId,
        start,
        totalSize: bytes.length,
      }
    }
    const complete = candidate.subarray(0, newline + 1)
    const nextOffset = start + complete.length
    return {
      content: complete.toString('utf8'),
      eof: nextOffset === bytes.length,
      incompleteTail: nextOffset < bytes.length,
      nextOffset,
      recordingId,
      start,
      totalSize: bytes.length,
    }
  }
}

test('builds bounded terminal-state checkpoints and seeks from the nearest checkpoint', async () => {
  const recordingId = 'checkpoint-replay'
  const events = []
  for (let index = 0; index < 500; index += 1) {
    events.push([10, 'o', `line ${index}\r\n`])
    if (index % 25 === 0) {
      events.push([0, 'r', `${80 + (index % 3)}x24`])
    }
  }
  const requests = []
  const reader = createChunkReader(recordingId, makeCast(events), requests)
  const index = await buildReplayIndex(recordingId, reader, new AbortController().signal)

  assert.equal(index.duration, 5_000)
  assert.ok(index.checkpoints.length > 1)
  assert.ok(index.checkpoints.length <= 32)
  assert.equal(index.malformedRecordCount, 0)
  assert.equal(index.truncatedTail, false)

  const targetTime = 4_000
  const checkpoint = findReplayCheckpoint(index, targetTime)
  assert.ok(checkpoint.time > 0)
  const seekRequests = []
  const seekReader = createChunkReader(recordingId, makeCast(events), seekRequests)
  const terminal = new HeadlessTerminal({ allowProposedApi: true, cols: 80, rows: 24, scrollback: 200 })
  try {
    const cursor = await restoreReplayCursor(
      index,
      targetTime,
      terminal,
      seekReader,
      new AbortController().signal,
    )
    assert.equal(seekRequests[0].start, checkpoint.nextOffset)
    assert.ok(seekRequests[0].start > 0)
    assert.ok(cursor.time <= targetTime)
    assert.ok(cursor.pendingEvents[0]?.time > targetTime)
  } finally {
    terminal.dispose()
  }
})

test('skips malformed records and preserves a playable prefix before a truncated tail', async () => {
  const recordingId = 'truncated-replay'
  const cast = makeCast(
    [
      [1, 'o', 'valid\r\n'],
      ['bad interval', 'o', 'ignored'],
      [2, 'o', 'still valid\r\n'],
    ],
    { partialTail: '[4,"o","cut off"' },
  )
  const index = await buildReplayIndex(
    recordingId,
    createChunkReader(recordingId, cast),
    new AbortController().signal,
  )

  assert.equal(index.duration, 3)
  assert.equal(index.malformedRecordCount, 1)
  assert.equal(index.truncatedTail, true)
})

test('discards an in-flight chunk result after cancellation', async () => {
  const recordingId = 'canceled-replay'
  const cast = makeCast([[1, 'o', 'never indexed']])
  const baseReader = createChunkReader(recordingId, cast)
  const controller = new AbortController()
  const reader = async (request) => {
    const chunk = await baseReader(request)
    controller.abort()
    return chunk
  }

  await assert.rejects(
    buildReplayIndex(recordingId, reader, controller.signal),
    (error) => error?.name === 'AbortError',
  )
})

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-recording-replay-bundle-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
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
    await rm(tempDir, { force: true, recursive: true })
  }
}
