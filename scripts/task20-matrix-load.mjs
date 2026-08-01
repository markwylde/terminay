/**
 * A deterministic, virtual pressure probe for the five independently-updating
 * workspace projections. It deliberately models scheduling, not throughput of
 * a particular browser, socket, or terminal implementation: no wall clock,
 * random input, or platform service participates in this contract.
 */
export const MATRIX_LOAD_PROFILE = Object.freeze({
  clients: 12,
  frames: 72,
  maxQueuedUpdates: 60,
  maxCleanupFrames: 4,
  maxRetainedAgeFrames: 4,
  maxReconnectAttemptsPerClient: 3,
  updatesPerFrame: Object.freeze({
    terminal: 5,
    watch: 3,
    agent: 2,
    file: 2,
    recording: 1,
  }),
  deliveryBudgetPerFrame: 18,
  reconnectFrames: Object.freeze([7, 19, 31, 43, 55, 67]),
})

const STREAMS = Object.freeze(['terminal', 'watch', 'agent', 'file', 'recording'])

/**
 * Exercise simultaneous terminal, file-watch, agent, file-viewer, recording,
 * and reconnect traffic. Updates coalesce only within a client+stream lane;
 * reconnect controls are never coalesced or displaced by data traffic.
 */
export function runMatrixLoadProbe(profile = MATRIX_LOAD_PROFILE) {
  validateProfile(profile)
  const dataQueue = new Map()
  const reconnectQueue = []
  const reconnects = Array.from({ length: profile.clients }, () => ({ attempts: 0, connected: true }))
  const metrics = {
    applied: Object.fromEntries(STREAMS.map((stream) => [stream, 0])),
    coalesced: Object.fromEntries(STREAMS.map((stream) => [stream, 0])),
    produced: Object.fromEntries(STREAMS.map((stream) => [stream, 0])),
    completedReconnects: 0,
    cleanupFrames: 0,
    maxDataQueue: 0,
    maxUpdateAgeFrames: Object.fromEntries(STREAMS.map((stream) => [stream, 0])),
    maxReconnectQueue: 0,
    reconnectRequests: 0,
    rejectedReconnects: 0,
    remainingDataQueue: 0,
    remainingReconnectQueue: 0,
  }
  let sequence = 0

  for (let frame = 0; frame < profile.frames; frame += 1) {
    for (let client = 0; client < profile.clients; client += 1) {
      for (const stream of STREAMS) {
        for (let update = 0; update < profile.updatesPerFrame[stream]; update += 1) {
          sequence += 1
          metrics.produced[stream] += 1
          const key = `${client}:${stream}`
          if (dataQueue.has(key)) metrics.coalesced[stream] += 1
          dataQueue.set(key, { client, stream, sequence, producedFrame: frame })
        }
      }
    }

    if (profile.reconnectFrames.includes(frame)) {
      // The selected clients rotate, so every lane receives multiple reconnect
      // attempts while all projections are concurrently producing updates.
      for (let offset = 0; offset < 4; offset += 1) {
        const client = (frame + offset * 3) % profile.clients
        const state = reconnects[client]
        metrics.reconnectRequests += 1
        if (state.attempts >= profile.maxReconnectAttemptsPerClient) {
          metrics.rejectedReconnects += 1
          continue
        }
        state.attempts += 1
        state.connected = false
        reconnectQueue.push(client)
      }
    }

    metrics.maxDataQueue = Math.max(metrics.maxDataQueue, dataQueue.size)
    metrics.maxReconnectQueue = Math.max(metrics.maxReconnectQueue, reconnectQueue.length)
    if (dataQueue.size > profile.maxQueuedUpdates) throw new Error('matrix data queue exceeded its fixed bound')

    let remainingBudget = profile.deliveryBudgetPerFrame
    while (remainingBudget > 0 && reconnectQueue.length > 0) {
      const client = reconnectQueue.shift()
      reconnects[client].connected = true
      metrics.completedReconnects += 1
      remainingBudget -= 1
    }
    // Stable insertion order makes the load contract repeatable. A complete
    // round takes four frames, retaining at most one latest value per lane.
    for (const [key, update] of dataQueue) {
      if (remainingBudget === 0) break
      dataQueue.delete(key)
      const age = frame - update.producedFrame
      metrics.maxUpdateAgeFrames[update.stream] = Math.max(metrics.maxUpdateAgeFrames[update.stream], age)
      if (age > profile.maxRetainedAgeFrames) throw new Error('matrix update exceeded its fixed retention age')
      metrics.applied[update.stream] += 1
      remainingBudget -= 1
    }
  }

  while (reconnectQueue.length > 0) {
    const client = reconnectQueue.shift()
    reconnects[client].connected = true
    metrics.completedReconnects += 1
  }
  while (dataQueue.size > 0) {
    metrics.cleanupFrames += 1
    if (metrics.cleanupFrames > profile.maxCleanupFrames) {
      throw new Error('matrix data queue did not drain within its fixed cleanup bound')
    }
    let remainingBudget = profile.deliveryBudgetPerFrame
    for (const [key, update] of dataQueue) {
      if (remainingBudget === 0) break
      dataQueue.delete(key)
      const age = profile.frames + metrics.cleanupFrames - 1 - update.producedFrame
      metrics.maxUpdateAgeFrames[update.stream] = Math.max(metrics.maxUpdateAgeFrames[update.stream], age)
      if (age > profile.maxRetainedAgeFrames) throw new Error('matrix update exceeded its fixed retention age')
      metrics.applied[update.stream] += 1
      remainingBudget -= 1
    }
  }
  metrics.remainingDataQueue = dataQueue.size
  metrics.remainingReconnectQueue = reconnectQueue.length
  metrics.clientsConnected = reconnects.filter((state) => state.connected).length
  metrics.maxReconnectAttempts = Math.max(...reconnects.map((state) => state.attempts))
  return deepFreeze(metrics)
}

function validateProfile(profile) {
  if (!Number.isInteger(profile.clients) || profile.clients < 1) throw new TypeError('clients must be a positive integer')
  if (!Number.isInteger(profile.frames) || profile.frames < 1) throw new TypeError('frames must be a positive integer')
  if (!Number.isInteger(profile.deliveryBudgetPerFrame) || profile.deliveryBudgetPerFrame < 1) throw new TypeError('deliveryBudgetPerFrame must be a positive integer')
  if (!Number.isInteger(profile.maxCleanupFrames) || profile.maxCleanupFrames < 1) throw new TypeError('maxCleanupFrames must be a positive integer')
  if (!Number.isInteger(profile.maxRetainedAgeFrames) || profile.maxRetainedAgeFrames < 0) throw new TypeError('maxRetainedAgeFrames must be a non-negative integer')
  if (profile.maxQueuedUpdates < profile.clients * STREAMS.length) throw new RangeError('maxQueuedUpdates cannot hold one update per client and stream')
  for (const stream of STREAMS) {
    if (!Number.isInteger(profile.updatesPerFrame?.[stream]) || profile.updatesPerFrame[stream] < 1) throw new TypeError(`updatesPerFrame.${stream} must be a positive integer`)
  }
}

function deepFreeze(value) {
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object') Object.freeze(nested)
  return Object.freeze(value)
}
