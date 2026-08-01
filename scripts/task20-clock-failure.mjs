const DEFAULT_SAMPLES = Object.freeze([
  Object.freeze({ wallTime: 1_100, elapsed: 100 }),
  Object.freeze({ wallTime: 500, elapsed: 600 }),
  Object.freeze({ wallTime: 700, elapsed: 1_100 }),
  Object.freeze({ wallTime: 10_000, elapsed: 1_200 }),
  Object.freeze({ wallTime: 100, elapsed: 1_300 }),
])

export function runClockFailureProbe(samples = DEFAULT_SAMPLES) {
  const expiresAt = 2_000
  let greatestObservedWallTime = 1_000
  let monotonicTime = 0
  const timeline = []

  const observe = (wallTime, elapsed) => {
    if (!Number.isSafeInteger(wallTime) || !Number.isSafeInteger(elapsed) || elapsed < monotonicTime) {
      throw new TypeError('clock samples must be bounded and monotonic elapsed time cannot move backwards')
    }
    monotonicTime = elapsed
    greatestObservedWallTime = Math.max(greatestObservedWallTime, wallTime)
    const effectiveTime = Math.max(greatestObservedWallTime, 1_000 + monotonicTime)
    const expired = effectiveTime >= expiresAt
    timeline.push(Object.freeze({ wallTime, elapsed, effectiveTime, expired }))
    return expired
  }

  if (!Array.isArray(samples) || samples.length !== 5) throw new TypeError('clock probe requires exactly five samples')
  const results = samples.map(sample => observe(sample.wallTime, sample.elapsed))
  const [
    initiallyExpired,
    rollbackExpired,
    elapsedExpired,
    forwardExpired,
    rollbackAfterExpiryExpired,
  ] = results

  return Object.freeze({
    initiallyExpired,
    rollbackExpired,
    elapsedExpired,
    forwardExpired,
    rollbackAfterExpiryExpired,
    timeline: Object.freeze(timeline),
  })
}
