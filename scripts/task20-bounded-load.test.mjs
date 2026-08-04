import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalService, TerminalServiceAdapter } from '../packages/server-core/dist/index.js'
import { BOUNDED_LOAD_PROFILE, runBoundedLoadProbe } from './task20-bounded-load.mjs'

const EXPECTED = {
  adapterAttachOperations: 120,
  adapterDetachOperations: 120,
  clientOutputDeliveries: 9_408,
  inputWrites: 288,
  outputEvents: 2_352,
  outputBytes: 112_896,
  pullOutputEvents: 2_352,
  reconnects: 24,
  resizes: 96,
  sessionsCreated: 24,
  subscriberAdmissionRejections: 24,
  subscriptionCloseEvents: 120,
  exitEvents: 24,
  maxLiveAttachments: 96,
  maxLiveSubscriptions: 120,
  maxQueuedOutputBytes: 192,
  maxRetainedReplayBytes: 2_016,
  ptysCreated: 24,
  ptyWrites: 288,
  ptyResizes: 96,
  activePtysAfterShutdown: 0,
  serviceSessionsAfterShutdown: 24,
  serviceStopped: true,
  shutdownExitEvents: 24,
}

test('bounded PTY/client/event pressure stays within fixed replay and queue limits', async () => {
  const result = await runBoundedLoadProbe({ TerminalService, TerminalServiceAdapter })

  assert.deepEqual(result, EXPECTED)
  assert.equal(BOUNDED_LOAD_PROFILE.sessionCount * BOUNDED_LOAD_PROFILE.clientsPerSession, result.maxLiveAttachments)
  assert.equal(result.maxQueuedOutputBytes < BOUNDED_LOAD_PROFILE.maxQueuedOutputBytes, true)
  assert.equal(result.maxRetainedReplayBytes <= BOUNDED_LOAD_PROFILE.maxReplayBytes, true)
})

test('the fixed probe produces identical metrics on an immediate repeat', async () => {
  const first = await runBoundedLoadProbe({ TerminalService, TerminalServiceAdapter })
  const second = await runBoundedLoadProbe({ TerminalService, TerminalServiceAdapter })
  assert.deepEqual(second, first)
})

test('subscriber admission is filled exactly, rejects one excess client per PTY, and still permits resume', async () => {
  const result = await runBoundedLoadProbe({ TerminalService, TerminalServiceAdapter })

  assert.equal(BOUNDED_LOAD_PROFILE.maxSubscribersPerSession, BOUNDED_LOAD_PROFILE.clientsPerSession + 1)
  assert.equal(result.subscriberAdmissionRejections, BOUNDED_LOAD_PROFILE.sessionCount)
  assert.equal(result.reconnects, BOUNDED_LOAD_PROFILE.sessionCount)
  assert.equal(result.maxLiveSubscriptions, BOUNDED_LOAD_PROFILE.sessionCount * BOUNDED_LOAD_PROFILE.maxSubscribersPerSession)
})
