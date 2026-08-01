/**
 * Deterministic TURN-outage recovery contract.
 *
 * This models only the server-side allocation boundary: an unavailable TURN
 * allocation must be retired before retry, and neither signaling nor a peer
 * may be allocated until a fresh relay allocation succeeds. It intentionally
 * does not claim a hosted TURN deployment or native network execution.
 */
export const TURN_OUTAGE_PROFILE = Object.freeze({
  outagesBeforeRecovery: 2,
  maxAttempts: 3,
})

export function runTurnOutageProbe(profile = TURN_OUTAGE_PROFILE) {
  validateProfile(profile)

  const allocations = new Map()
  const events = []
  let nextAllocation = 0
  let peakOpenAllocations = 0
  let signalingAllocations = 0
  let peerAllocations = 0

  const openAllocation = (attempt) => {
    const allocation = `turn-allocation-${++nextAllocation}`
    allocations.set(allocation, { attempt, closed: false })
    peakOpenAllocations = Math.max(peakOpenAllocations, openAllocationCount(allocations))
    events.push(Object.freeze({ type: 'turn-allocation-started', attempt, allocation }))
    return allocation
  }
  const closeAllocation = (allocation, reason) => {
    const entry = allocations.get(allocation)
    if (!entry) throw new Error('unknown TURN allocation')
    if (entry.closed) throw new Error('TURN allocation closed more than once')
    entry.closed = true
    events.push(Object.freeze({ type: 'turn-allocation-closed', attempt: entry.attempt, allocation, reason }))
  }

  let recoveredAllocation = null
  for (let attempt = 1; attempt <= profile.maxAttempts; attempt += 1) {
    const allocation = openAllocation(attempt)
    if (attempt <= profile.outagesBeforeRecovery) {
      events.push(Object.freeze({ type: 'turn-unavailable', attempt }))
      closeAllocation(allocation, 'outage')
      continue
    }

    recoveredAllocation = allocation
    signalingAllocations += 1
    peerAllocations += 1
    events.push(Object.freeze({ type: 'turn-recovered', attempt, allocation }))
    break
  }

  if (!recoveredAllocation) throw new Error('TURN did not recover within the fixed retry bound')
  closeAllocation(recoveredAllocation, 'shutdown')

  return deepFreeze({
    attempts: allocations.size,
    failedAttempts: profile.outagesBeforeRecovery,
    recovered: true,
    recoveryAllocation: recoveredAllocation,
    allocationsAllocated: allocations.size,
    allocationsClosed: [...allocations.values()].filter((entry) => entry.closed).length,
    openAllocations: openAllocationCount(allocations),
    peakOpenAllocations,
    signalingAllocations,
    peerAllocations,
    events,
  })
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('TURN outage profile must be an object')
  if (!Number.isInteger(profile.maxAttempts) || profile.maxAttempts < 1) throw new TypeError('maxAttempts must be a positive integer')
  if (!Number.isInteger(profile.outagesBeforeRecovery) || profile.outagesBeforeRecovery < 0) throw new TypeError('outagesBeforeRecovery must be a non-negative integer')
  if (profile.outagesBeforeRecovery >= profile.maxAttempts) throw new RangeError('TURN outage count must leave one recovery attempt')
}

function openAllocationCount(allocations) {
  let count = 0
  for (const allocation of allocations.values()) if (!allocation.closed) count += 1
  return count
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
