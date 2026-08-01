import assert from 'node:assert/strict'
import test from 'node:test'
import { MATRIX_LOAD_PROFILE, runMatrixLoadProbe } from './task20-matrix-load.mjs'

test('concurrent terminal/watch/agent/file/recording/reconnect pressure is bounded and recovers', () => {
  const result = runMatrixLoadProbe()

  assert.deepEqual(result.produced, {
    terminal: 4_320,
    watch: 2_592,
    agent: 1_728,
    file: 1_728,
    recording: 864,
  })
  assert.equal(result.maxDataQueue, MATRIX_LOAD_PROFILE.clients * 5)
  assert.equal(result.maxDataQueue <= MATRIX_LOAD_PROFILE.maxQueuedUpdates, true)
  assert.equal(result.reconnectRequests, 24)
  assert.equal(result.completedReconnects + result.rejectedReconnects, result.reconnectRequests)
  assert.equal(result.remainingReconnectQueue, 0)
  assert.equal(result.remainingDataQueue, 0)
  assert.equal(result.cleanupFrames <= MATRIX_LOAD_PROFILE.maxCleanupFrames, true)
  assert.equal(
    Object.values(result.maxUpdateAgeFrames).every(
      age => age <= MATRIX_LOAD_PROFILE.maxRetainedAgeFrames,
    ),
    true,
  )
  assert.equal(result.clientsConnected, MATRIX_LOAD_PROFILE.clients)
  assert.equal(result.maxReconnectAttempts <= MATRIX_LOAD_PROFILE.maxReconnectAttemptsPerClient, true)
  assert.equal(Object.values(result.coalesced).every((count) => count > 0), true)
  for (const stream of Object.keys(result.produced)) {
    assert.equal(
      result.applied[stream] + result.coalesced[stream],
      result.produced[stream],
      `${stream} updates must be either applied or explicitly coalesced`,
    )
  }
})

test('the matrix probe has exact repeatable results and rejects an unbounded queue profile', () => {
  const first = runMatrixLoadProbe()
  const second = runMatrixLoadProbe()
  assert.deepEqual(second, first)

  assert.throws(
    () => runMatrixLoadProbe({ ...MATRIX_LOAD_PROFILE, maxQueuedUpdates: 59 }),
    /cannot hold one update per client and stream/,
  )
  assert.throws(
    () => runMatrixLoadProbe({ ...MATRIX_LOAD_PROFILE, maxCleanupFrames: 1 }),
    /did not drain within its fixed cleanup bound/,
  )
  assert.throws(
    () => runMatrixLoadProbe({ ...MATRIX_LOAD_PROFILE, maxRetainedAgeFrames: 0 }),
    /exceeded its fixed retention age/,
  )
})
