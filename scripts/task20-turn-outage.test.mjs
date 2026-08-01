import assert from 'node:assert/strict'
import test from 'node:test'
import { TURN_OUTAGE_PROFILE, runTurnOutageProbe } from './task20-turn-outage.mjs'

test('a bounded TURN outage closes each failed allocation before fresh signaling and peer recovery', () => {
  const result = runTurnOutageProbe()

  assert.deepEqual(
    {
      attempts: result.attempts,
      failedAttempts: result.failedAttempts,
      recovered: result.recovered,
      recoveryAllocation: result.recoveryAllocation,
      allocationsAllocated: result.allocationsAllocated,
      allocationsClosed: result.allocationsClosed,
      openAllocations: result.openAllocations,
      peakOpenAllocations: result.peakOpenAllocations,
      signalingAllocations: result.signalingAllocations,
      peerAllocations: result.peerAllocations,
    },
    {
      attempts: 3, failedAttempts: 2, recovered: true,
      recoveryAllocation: 'turn-allocation-3', allocationsAllocated: 3,
      allocationsClosed: 3, openAllocations: 0, peakOpenAllocations: 1,
      signalingAllocations: 1, peerAllocations: 1,
    },
  )
  assert.deepEqual(result.events, [
    { type: 'turn-allocation-started', attempt: 1, allocation: 'turn-allocation-1' },
    { type: 'turn-unavailable', attempt: 1 },
    { type: 'turn-allocation-closed', attempt: 1, allocation: 'turn-allocation-1', reason: 'outage' },
    { type: 'turn-allocation-started', attempt: 2, allocation: 'turn-allocation-2' },
    { type: 'turn-unavailable', attempt: 2 },
    { type: 'turn-allocation-closed', attempt: 2, allocation: 'turn-allocation-2', reason: 'outage' },
    { type: 'turn-allocation-started', attempt: 3, allocation: 'turn-allocation-3' },
    { type: 'turn-recovered', attempt: 3, allocation: 'turn-allocation-3' },
    { type: 'turn-allocation-closed', attempt: 3, allocation: 'turn-allocation-3', reason: 'shutdown' },
  ])
})

test('the TURN outage probe is deterministic and rejects an unrecoverable retry profile', () => {
  assert.deepEqual(runTurnOutageProbe(), runTurnOutageProbe())
  assert.throws(
    () => runTurnOutageProbe({ ...TURN_OUTAGE_PROFILE, outagesBeforeRecovery: 3 }),
    /must leave one recovery attempt/u,
  )
})
