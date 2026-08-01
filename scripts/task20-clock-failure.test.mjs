import assert from 'node:assert/strict'
import test from 'node:test'
import { runClockFailureProbe } from './task20-clock-failure.mjs'

test('wall-clock rollback cannot extend a lease and forward jumps fail closed', () => {
  const result = runClockFailureProbe()
  assert.equal(result.initiallyExpired, false)
  assert.equal(result.rollbackExpired, false)
  assert.equal(result.elapsedExpired, true)
  assert.equal(result.forwardExpired, true)
  assert.equal(result.rollbackAfterExpiryExpired, true)
  assert.deepEqual(
    result.timeline.map(sample => sample.effectiveTime),
    [1_100, 1_600, 2_100, 10_000, 10_000],
  )
})

test('clock samples reject elapsed-time rollback', () => {
  assert.throws(
    () => runClockFailureProbe([
      { wallTime: 1_100, elapsed: 100 },
      { wallTime: 1_200, elapsed: 50 },
      { wallTime: 1_300, elapsed: 200 },
      { wallTime: 1_400, elapsed: 300 },
      { wallTime: 1_500, elapsed: 400 },
    ]),
    /monotonic elapsed time cannot move backwards/i,
  )
})
