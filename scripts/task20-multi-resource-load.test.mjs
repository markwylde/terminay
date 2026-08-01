import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { TerminalService, TerminalServiceAdapter } from '../packages/server-core/dist/index.js'
import { runBoundedLoadProbe } from './task20-bounded-load.mjs'
import { runMatrixLoadProbe } from './task20-matrix-load.mjs'

const ITERATIONS = 6
const MAX_HEAP_GROWTH_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_DURATION_MS = 30_000
const FILE_TRANSFER_CHUNK_BYTES = 64 * 1024
const RECORDING_CHUNK_BYTES = 16 * 1024

test('representative multi-resource pressure remains bounded and fully cleans up', async (context) => {
  const baselineHeap = process.memoryUsage().heapUsed
  let peakHeap = baselineHeap
  let logicalFileTransferBytes = 0
  let logicalRecordingBytes = 0
  let totalUpdates = 0
  const startedAt = performance.now()

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const terminal = await runBoundedLoadProbe({ TerminalService, TerminalServiceAdapter })
    const matrix = runMatrixLoadProbe()

    assert.equal(terminal.ptysCreated, 24)
    assert.equal(terminal.maxLiveSubscriptions, 120)
    assert.equal(terminal.maxQueuedOutputBytes <= 256, true)
    assert.equal(terminal.maxRetainedReplayBytes <= 2 * 1024, true)
    assert.equal(terminal.activePtysAfterShutdown, 0)
    assert.equal(terminal.serviceStopped, true)
    assert.equal(matrix.clientsConnected, 12)
    assert.equal(matrix.remainingDataQueue, 0)
    assert.equal(matrix.remainingReconnectQueue, 0)
    assert.equal(matrix.cleanupFrames <= 4, true)
    assert.equal(Object.values(matrix.maxUpdateAgeFrames).every((age) => age <= 4), true)

    for (const lane of Object.keys(matrix.produced)) {
      assert.equal(
        matrix.applied[lane] + matrix.coalesced[lane],
        matrix.produced[lane],
        `${lane} pressure must be applied or explicitly coalesced`,
      )
      totalUpdates += matrix.produced[lane]
    }
    logicalFileTransferBytes += matrix.produced.file * FILE_TRANSFER_CHUNK_BYTES
    logicalRecordingBytes += matrix.produced.recording * RECORDING_CHUNK_BYTES
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
  }

  const durationMs = performance.now() - startedAt
  const heapGrowthBytes = Math.max(0, peakHeap - baselineHeap)
  assert.equal(totalUpdates, 67_392)
  assert.equal(logicalFileTransferBytes, 679_477_248)
  assert.equal(logicalRecordingBytes, 84_934_656)
  assert.equal(heapGrowthBytes <= MAX_HEAP_GROWTH_BYTES, true, `heap grew by ${heapGrowthBytes} bytes`)
  assert.equal(durationMs <= MAX_TOTAL_DURATION_MS, true, `load probe took ${durationMs}ms`)
  context.diagnostic(JSON.stringify({
    durationMs: Math.round(durationMs * 1000) / 1000,
    heapGrowthBytes,
    logicalFileTransferBytes,
    logicalRecordingBytes,
    totalUpdates,
  }))
})
