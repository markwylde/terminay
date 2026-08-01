import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteConnectionManager } from '@terminay/server-core'
import { NodeDataChannelHeadlessHost } from '../dist/index.js'

const CHANNELS = ['control', 'application', 'terminal', 'assets']

class FakeChannel {
  constructor(label) {
    this.label = label
    this.open = true
    this.sent = []
    this.closed = new Set()
  }

  getLabel() { return this.label }
  isOpen() { return this.open }
  bufferedAmount() { return 0 }
  sendMessageBinary(frame) {
    if (!this.open) return false
    this.sent.push(new Uint8Array(frame))
    return true
  }
  onMessage() {}
  onClosed(listener) { this.closed.add(listener) }
  close() {
    if (!this.open) return
    this.open = false
    for (const listener of this.closed) listener()
  }
}

class FakePeer {
  static instances = []

  constructor(_id, configuration) {
    this.configuration = configuration
    this.closed = false
    this.channels = new Map()
    FakePeer.instances.push(this)
  }

  onLocalDescription(listener) { this.description = listener }
  onLocalCandidate(listener) { this.candidate = listener }
  onStateChange(listener) { this.state = listener }
  onDataChannel(listener) { this.dataChannel = listener }
  setRemoteDescription(sdp, type) {
    this.remoteDescription = { sdp, type }
    this.description?.('answer-sdp', 'answer')
    for (const label of CHANNELS) this.emitChannel(label)
  }
  addRemoteCandidate(candidate, mid) { this.remoteCandidate = { candidate, mid } }
  close() { this.closed = true }
  emitChannel(label) {
    if (this.channels.has(label)) return
    const channel = new FakeChannel(label)
    this.channels.set(label, channel)
    this.dataChannel?.(channel)
  }
}

class SilentClosePeer extends FakePeer {
  emitChannel(label) {
    if (this.channels.has(label)) return
    const channel = new FakeChannel(label)
    // A faulty native binding can transition internally without publishing its
    // close observer. The privileged host must still release its separate
    // authenticated signaling subscription when the device is revoked.
    channel.close = function closeWithoutNotification() { this.open = false }
    this.channels.set(label, channel)
    this.dataChannel?.(channel)
  }
}

function proof(deviceId, ticketId = `${deviceId}-ticket`) {
  return {
    ticketId,
    serverId: 'server-a',
    sessionOrigin: 'https://session.example.test',
    deviceId,
    expiresAt: 900,
    authenticated: true,
  }
}

function setupSignaling() {
  const inbound = []
  const outbound = []
  let closed = false
  return {
    signaling: {
      send: (message) => outbound.push(message),
      onMessage(listener) {
        inbound.push(listener)
        return () => inbound.splice(inbound.indexOf(listener), 1)
      },
      sign: (message) => ({ ...message, signature: 'valid' }),
      verify: (message) => message?.signature === 'valid'
        ? { type: message.type, ...(message.sdp === undefined
          ? { candidate: message.candidate, mid: message.mid }
          : { sdp: message.sdp }) }
        : null,
      close: () => { closed = true },
    },
    inbound,
    outbound,
    isClosed: () => closed,
  }
}

function manager() {
  const value = new RemoteConnectionManager({
    serverId: 'server-a',
    sessionOrigin: 'https://session.example.test',
    now: () => 100,
    maxFrameBytes: 1024,
  })
  value.expose(1_000)
  return value
}

test('server-owned node-datachannel host composes proof, signaling, four channels, and cleanup', async () => {
  FakePeer.instances.length = 0
  const signal = setupSignaling()
  const events = []
  let loadCount = 0
  let moduleCleanupCount = 0
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    loadModule: async () => {
      loadCount += 1
      return { PeerConnection: FakePeer, cleanup: () => { moduleCleanupCount += 1 } }
    },
    createSignaling: () => signal.signaling,
    iceServers: [{ urls: 'stun:stun.example.test' }],
    createTurnCredentials: (context) => {
      assert.deepEqual(Object.keys(context).sort(), [
        'channels', 'deviceId', 'maxBufferedBytes', 'maxFrameBytes', 'peerId', 'serverId', 'sessionOrigin', 'signal',
      ])
      return [{
        urls: 'turns:turn.example.test',
        username: `turn-${context.peerId}`,
        credential: 'ephemeral-secret',
        expiresAt: 1_000,
      }]
    },
    now: () => 100,
    role: 'answerer',
    onEvent: (event) => events.push(event),
  })

  const pending = host.connect(proof('device-a'))
  await new Promise((resolve) => setImmediate(resolve))
  signal.inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
  signal.inbound[0]({ type: 'ice', candidate: 'candidate', mid: '0', signature: 'valid' })
  const session = await pending

  assert.equal(loadCount, 1)
  assert.deepEqual(FakePeer.instances[0].configuration.iceServers, [
    { urls: 'stun:stun.example.test' },
    {
      urls: 'turns:turn.example.test',
      username: `turn-${session.peerId}`,
      credential: 'ephemeral-secret',
    },
  ])
  assert.equal(session.snapshot().state, 'connected')
  assert.equal(session.snapshot().peer.state, 'connected')
  assert.deepEqual(signal.outbound, [{ type: 'answer', sdp: 'answer-sdp', signature: 'valid' }])
  assert.deepEqual(events.map((event) => event.type), ['connect-started', 'connected'])
  assert.equal(host.snapshot.activeSessions, 1)
  assert.equal(host.snapshot.measurements.iceConfigurations, 1)
  assert.equal(host.snapshot.measurements.relayCapableIceConfigurations, 1)
  assert.equal(host.snapshot.measurements.turnCredentialRequests, 1)
  assert.equal(host.snapshot.measurements.turnCredentialFailures, 0)
  assert.equal(host.snapshot.measurements.activeTurnCredentialRequests, 0)

  await host.closePeer(session.peerId)
  assert.equal(FakePeer.instances[0].closed, true)
  assert.equal(signal.isClosed(), true)
  assert.equal(host.snapshot.activeSessions, 0)

  await host.shutdown()
  assert.equal(moduleCleanupCount, 1)
  assert.deepEqual(events.at(-1), { type: 'shutdown' })
})

test('TURN credentials are per-peer, short-lived, and never accepted as static ICE configuration', async () => {
	FakePeer.instances.length = 0
  assert.throws(() => new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => setupSignaling().signaling,
    iceServers: [{ urls: 'turn:turn.example.test', username: 'long-lived', credential: 'secret' }],
  }), /static ICE credentials are not allowed/)

  let signalingCalls = 0
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => {
      signalingCalls += 1
      return setupSignaling().signaling
    },
    createTurnCredentials: () => [{
      urls: 'turn:turn.example.test',
      username: 'expired',
      credential: 'secret',
      expiresAt: 100,
    }],
    now: () => 100,
  })

  await assert.rejects(host.connect(proof('device-expired-turn')), /not short-lived/)
  assert.equal(signalingCalls, 0, 'invalid credentials must not allocate a signaling subscription')
  assert.equal(FakePeer.instances.length, 0, 'the rejected setup must not create a native peer')
  assert.equal(host.snapshot.measurements.turnCredentialRequests, 1)
  assert.equal(host.snapshot.measurements.turnCredentialFailures, 1)
  assert.equal(host.snapshot.measurements.activeTurnCredentialRequests, 0)
  await host.shutdown()
})

test('failed node-datachannel setup is closed and reported without retaining a peer', async () => {
  const signal = setupSignaling()
  const events = []
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => signal.signaling,
    timeoutMs: 25,
    onEvent: (event) => events.push(event),
  })

  await assert.rejects(host.connect(proof('device-b')), /timed out/)
  assert.equal(host.snapshot.activeSessions, 0)
  assert.equal(host.snapshot.failedConnections, 1)
  assert.deepEqual(events.map((event) => event.type), ['connect-started', 'connect-failed'])
  await host.shutdown()
})

test('throwing host lifecycle observers cannot interrupt authenticated setup or shutdown', async () => {
  FakePeer.instances.length = 0
  const signal = setupSignaling()
  let observerCalls = 0
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => signal.signaling,
    timeoutMs: 1_000,
    onEvent: () => {
      observerCalls += 1
      throw new Error('metrics sink unavailable')
    },
  })

  const pending = host.connect(proof('device-observer-throws'))
  await new Promise((resolve) => setImmediate(resolve))
  signal.inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
  const session = await pending

  assert.equal(session.snapshot().state, 'connected')
  assert.equal(host.snapshot.activeSessions, 1)
  await host.shutdown()
  assert.equal(host.snapshot.state, 'closed')
  assert.ok(observerCalls >= 3, 'connect, session close, and shutdown events were all attempted')
  assert.equal(signal.isClosed(), true)
})

test('revoking a device aborts its pending node-datachannel setup and closes signaling', async () => {
  FakePeer.instances.length = 0
  const signal = setupSignaling()
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => signal.signaling,
    timeoutMs: 10_000,
  })

  const pending = host.connect(proof('device-revoked'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(signal.inbound.length, 1)

  assert.equal(await host.revokeDevice('device-revoked'), 1)
  await assert.rejects(pending, /remote device is revoked/)
  assert.equal(FakePeer.instances[0].closed, true)
  assert.equal(signal.isClosed(), true)
  assert.equal(host.snapshot.activeSessions, 0)
  assert.equal(host.snapshot.failedConnections, 1)

  await host.shutdown()
})

test('revoking a connected device closes signaling even when native channels omit close callbacks', async () => {
  FakePeer.instances.length = 0
  const signal = setupSignaling()
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: SilentClosePeer },
    createSignaling: () => signal.signaling,
    timeoutMs: 1_000,
  })

  const pending = host.connect(proof('device-silent-close'))
  await new Promise((resolve) => setImmediate(resolve))
  signal.inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
  const session = await pending
  assert.equal(host.snapshot.activeSessions, 1)

  assert.equal(await host.revokeDevice('device-silent-close'), 1)
  assert.equal(signal.isClosed(), true, 'revocation must close the relay without a native callback')
  assert.equal(host.snapshot.activeSessions, 0)
  assert.throws(() => session.snapshot(), /closed/)
  await host.shutdown()
})

test('pending native setup is bounded before reconnect admission allocates signaling or a peer', async () => {
  FakePeer.instances.length = 0
  const signals = []
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => {
      const signal = setupSignaling()
      signals.push(signal)
      return signal.signaling
    },
    timeoutMs: 10_000,
    maxPendingConnections: 1,
  })

  const first = host.connect(proof('device-first'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(signals.length, 1)
  assert.equal(FakePeer.instances.length, 1)

  await assert.rejects(host.connect(proof('device-over-limit')), /pending connection limit reached/)
  assert.equal(signals.length, 1, 'rejected reconnect must not allocate a relay subscription')
  assert.equal(FakePeer.instances.length, 1, 'rejected reconnect must not allocate a native peer')
  assert.equal(host.snapshot.connectAttempts, 1)
  assert.equal(host.snapshot.failedConnections, 0)

  await host.shutdown()
  await assert.rejects(first, /shutting down/)
  assert.equal(signals[0].isClosed(), true)
})

test('a pending-capacity rejection does not consume another device WebRTC retry window', async () => {
  FakePeer.instances.length = 0
  const signals = []
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => {
      const signal = setupSignaling()
      signals.push(signal)
      return signal.signaling
    },
    timeoutMs: 10_000,
    maxPendingConnections: 1,
    connectionRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 4 },
  })

  const first = host.connect(proof('device-capacity-holder'))
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(
    host.connect(proof('device-capacity-rejected')),
    /pending connection limit reached/,
  )
  assert.equal(signals.length, 1)
  assert.equal(FakePeer.instances.length, 1)

  signals[0].inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
  const firstSession = await first
  await host.closePeer(firstSession.peerId)

  const replacement = host.connect(proof('device-capacity-rejected', 'retry-ticket'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(signals.length, 2, 'the capacity rejection must not consume the device retry window')
  signals[1].inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
  const replacementSession = await replacement
  assert.equal(replacementSession.deviceId, 'device-capacity-rejected')
  await host.shutdown()
})

test('repeated authenticated WebRTC setup is rate-limited before signaling or native allocation', async () => {
  FakePeer.instances.length = 0
  const signals = []
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => {
      const signal = setupSignaling()
      signals.push(signal)
      return signal.signaling
    },
    timeoutMs: 10_000,
    connectionRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 4 },
  })

  const first = host.connect(proof('device-rate-limited', 'first-ticket'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(signals.length, 1)
  assert.equal(FakePeer.instances.length, 1)

  await assert.rejects(
    host.connect(proof('device-rate-limited', 'second-ticket')),
    /remote admission rate limit reached/,
  )
  assert.equal(signals.length, 1, 'rate-limit rejection must not subscribe to signaling')
  assert.equal(FakePeer.instances.length, 1, 'rate-limit rejection must not allocate a native peer')
  assert.equal(host.snapshot.connectAttempts, 1)
  assert.equal(host.snapshot.failedConnections, 0)

  await host.shutdown()
  await assert.rejects(first, /shutting down/)
})

test('malformed device identities cannot create WebRTC rate-limit state before admission', async () => {
  FakePeer.instances.length = 0
  let signalingCalls = 0
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => {
      signalingCalls += 1
      return setupSignaling().signaling
    },
    timeoutMs: 10_000,
    connectionRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 1 },
  })

  const malformed = proof('device-placeholder', 'malformed-ticket')
  malformed.deviceId = null
  await assert.rejects(
    host.connect(malformed),
    /remote device identity is invalid/,
  )
  assert.equal(signalingCalls, 0, 'malformed input must not subscribe to signaling')
  assert.equal(FakePeer.instances.length, 0, 'malformed input must not allocate a native peer')
  assert.equal(host.snapshot.connectAttempts, 0, 'malformed input is rejected before host admission')

  const valid = host.connect(proof('device-after-malformed'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(signalingCalls, 1, 'the invalid proof must not consume the only limiter slot')
  await host.shutdown()
  await assert.rejects(valid, /shutting down/)
})

test('an already-aborted caller signal consumes no WebRTC retry state or native setup capacity', async () => {
  FakePeer.instances.length = 0
  let signalingCalls = 0
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => {
      signalingCalls += 1
      return setupSignaling().signaling
    },
    timeoutMs: 10_000,
    connectionRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 1 },
  })
  const controller = new AbortController()
  controller.abort(new Error('caller cancelled before connect'))

  await assert.rejects(
    host.connect(proof('device-caller-cancelled'), controller.signal),
    /caller cancelled before connect/,
  )
  assert.equal(signalingCalls, 0, 'pre-cancelled work must not subscribe to signaling')
  assert.equal(FakePeer.instances.length, 0, 'pre-cancelled work must not allocate a native peer')
  assert.equal(host.snapshot.connectAttempts, 0, 'pre-cancelled work must not become a host attempt')
  assert.equal(host.snapshot.pendingConnections, 0, 'pre-cancelled work must not reserve a pending slot')

  const replacement = host.connect(proof('device-caller-cancelled', 'fresh-ticket'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(signalingCalls, 1, 'pre-cancelled work must not consume the device retry window')
  await host.shutdown()
  await assert.rejects(replacement, /shutting down/)
})

test('idle WebRTC setup-rate-limit metadata is pruned by host cleanup and status inspection', async () => {
  let now = 100
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => setupSignaling().signaling,
    now: () => now,
    connectionRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 1 },
  })

  const pending = host.connect(proof('device-expiring-rate-window'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(host.cleanup().connectionRateLimitWindows, 0)

  now += 60_000
  assert.equal(host.cleanup().connectionRateLimitWindows, 1)
  await host.shutdown()
  await assert.rejects(pending, /shutting down/)

  const secondHost = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: { PeerConnection: FakePeer },
    createSignaling: () => setupSignaling().signaling,
    now: () => now,
    connectionRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 1 },
  })
  const second = secondHost.connect(proof('device-status-expiring-rate-window'))
  await new Promise((resolve) => setImmediate(resolve))
  now += 60_000
  void secondHost.snapshot
  const replacement = secondHost.connect(proof('device-status-replacement-rate-window'))
  await new Promise((resolve) => setImmediate(resolve))
  await secondHost.shutdown()
  await assert.rejects(second, /shutting down/)
  await assert.rejects(replacement, /shutting down/)
})

test('shutdown aborts a stalled TURN credential provider before it can allocate signaling or a peer', async () => {
	FakePeer.instances.length = 0
	let credentialRequests = 0
	let signalingCalls = 0
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer },
		createSignaling: () => {
			signalingCalls += 1
			return setupSignaling().signaling
		},
		createTurnCredentials: () => {
			credentialRequests += 1
			return new Promise(() => {})
		},
		timeoutMs: 10_000,
	})

	const pending = host.connect(proof('device-stalled-turn'))
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(credentialRequests, 1)
	assert.equal(signalingCalls, 0)
	assert.equal(FakePeer.instances.length, 0)
	assert.equal(host.snapshot.measurements.turnCredentialRequests, 1)
	assert.equal(host.snapshot.measurements.activeTurnCredentialRequests, 1)
	assert.equal(host.snapshot.measurements.peakActiveTurnCredentialRequests, 1)

	await host.shutdown()
	await assert.rejects(pending, /shutting down/)
	assert.equal(host.snapshot.activeSessions, 0)
	assert.equal(host.snapshot.measurements.activeTurnCredentialRequests, 0)
	assert.equal(host.snapshot.measurements.turnCredentialFailures, 1)
	assert.equal(signalingCalls, 0)
	assert.equal(FakePeer.instances.length, 0)
})

test('revocation aborts a stalled signaling factory before it can allocate a native peer', async () => {
	FakePeer.instances.length = 0
	let signalingRequests = 0
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer },
		createSignaling: () => {
			signalingRequests += 1
			return new Promise(() => {})
		},
		timeoutMs: 10_000,
	})

	const pending = host.connect(proof('device-stalled-signaling'))
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(signalingRequests, 1)
	assert.equal(FakePeer.instances.length, 0)

	assert.equal(await host.revokeDevice('device-stalled-signaling'), 1)
	await assert.rejects(pending, /remote device is revoked/)
	assert.equal(host.snapshot.activeSessions, 0)
	assert.equal(FakePeer.instances.length, 0)
	await host.shutdown()
})

test('revoking a device clears its native setup rate-limit metadata immediately', async () => {
	FakePeer.instances.length = 0
	let now = 100
	const signal = setupSignaling()
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer },
		createSignaling: () => signal.signaling,
		now: () => now,
		timeoutMs: 10_000,
		connectionRateLimit: { maxAttempts: 1, windowMs: 60_000, maxKeys: 1 },
	})

	const pending = host.connect(proof('device-revoked-rate-window'))
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(await host.revokeDevice('device-revoked-rate-window'), 1)
	await assert.rejects(pending, /remote device is revoked/)

	// If revocation had left the limiter entry behind, this expiry sweep would
	// remove it and report one stale device-scoped record.
	now += 60_000
	assert.equal(host.cleanup().connectionRateLimitWindows, 0)
	assert.equal(host.snapshot.pendingConnections, 0)
	assert.equal(FakePeer.instances[0].closed, true)
	assert.equal(signal.isClosed(), true)
	await host.shutdown()
})

test('concurrent shutdown callers join native cleanup and publish one terminal event', async () => {
  let releaseCleanup
  const cleanupStarted = new Promise((resolve) => { releaseCleanup = resolve })
  let cleanupCalls = 0
  const events = []
  const host = new NodeDataChannelHeadlessHost({
    manager: manager(),
    module: {
      PeerConnection: FakePeer,
      cleanup: async () => {
        cleanupCalls += 1
        await cleanupStarted
      },
    },
    createSignaling: () => setupSignaling().signaling,
    onEvent: (event) => events.push(event),
  })

  const first = host.shutdown()
  const second = host.shutdown()
  assert.strictEqual(second, first, 'every shutdown caller must await the in-flight cleanup')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(cleanupCalls, 1)

  releaseCleanup()
  await Promise.all([first, second])
  assert.equal(cleanupCalls, 1)
	assert.deepEqual(events, [{ type: 'shutdown' }])
})

test('native channel teardown immediately releases the host session and emits one close event', async () => {
	FakePeer.instances.length = 0
	const signal = setupSignaling()
	const events = []
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer },
		createSignaling: () => signal.signaling,
		timeoutMs: 1_000,
		onEvent: (event) => events.push(event),
	})

	const pending = host.connect(proof('device-closed'))
	await new Promise((resolve) => setImmediate(resolve))
	signal.inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
	const session = await pending
	for (const channel of FakePeer.instances[0].channels.values()) channel.close()
	await new Promise((resolve) => setImmediate(resolve))

	assert.equal(signal.isClosed(), true)
	assert.deepEqual(events.filter((event) => event.type === 'session-closed'), [{
		type: 'session-closed', peerId: session.peerId, deviceId: 'device-closed',
	}])
	assert.equal(host.snapshot.activeSessions, 0)
	assert.equal(events.filter((event) => event.type === 'session-closed').length, 1)
	await host.shutdown()
})

test('a stalled relay close cannot delay explicit native peer cleanup', async () => {
	FakePeer.instances.length = 0
	const signal = setupSignaling()
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer },
		createSignaling: () => signal.signaling,
		timeoutMs: 1_000,
		signalingCloseTimeoutMs: 10,
	})

	const pending = host.connect(proof('device-stalled-relay-close'))
	await new Promise((resolve) => setImmediate(resolve))
	signal.inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
	const session = await pending
	signal.signaling.close = () => new Promise(() => {})

	await Promise.race([
		host.closePeer(session.peerId),
		new Promise((_, reject) => setTimeout(
			() => reject(new Error('stalled relay close blocked peer cleanup')),
			250,
		)),
	])
	assert.equal(FakePeer.instances[0].closed, true)
	assert.equal(host.snapshot.activeSessions, 0)
	await host.shutdown()
})

test('aggregate runtime measurements bound a sustained multi-peer setup probe without retaining identities', async () => {
	FakePeer.instances.length = 0
	let clock = 1_000
	const signals = []
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer },
		createSignaling: () => {
			const signal = setupSignaling()
			signals.push(signal)
			return signal.signaling
		},
		iceServers: [{ urls: 'stun:direct.example.test' }],
		createTurnCredentials: (context) => [{
			urls: 'turns:turn.example.test',
			username: `turn-${context.peerId}`,
			credential: 'ephemeral',
			expiresAt: 1_600,
		}],
		now: () => clock,
		timeoutMs: 1_000,
	})

	const connections = ['a', 'b', 'c'].map((suffix) => host.connect(proof(`device-measure-${suffix}`)))
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(host.snapshot.pendingConnections, 3)
	assert.equal(host.snapshot.measurements.peakPendingConnections, 3)

	clock = 1_025
	for (const signal of signals) {
		signal.inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
	}
	const sessions = await Promise.all(connections)
	assert.equal(sessions.length, 3)
	assert.equal(host.snapshot.activeSessions, 3)
	assert.equal(host.snapshot.pendingConnections, 0)
	assert.deepEqual(host.snapshot.measurements, {
		peakActiveSessions: 3,
		peakPendingConnections: 3,
		completedConnections: 3,
		totalConnectionDurationMs: 75,
		maxConnectionDurationMs: 25,
		iceConfigurations: 3,
		relayCapableIceConfigurations: 3,
		turnCredentialRequests: 3,
		turnCredentialFailures: 0,
		activeTurnCredentialRequests: 0,
		peakActiveTurnCredentialRequests: 3,
	})
	assert.doesNotMatch(JSON.stringify(host.snapshot.measurements), /device-measure|peer-|ticket|turn-/u)

	await host.closeAll()
	assert.equal(host.snapshot.activeSessions, 0)
	assert.equal(host.snapshot.measurements.peakActiveSessions, 3)
	await host.shutdown()
})

test('aggregate connection-duration measurements remain finite under an extreme injected clock', async () => {
	FakePeer.instances.length = 0
	let clock = 0
	const signals = []
	const host = new NodeDataChannelHeadlessHost({
		manager: manager(),
		module: { PeerConnection: FakePeer },
		createSignaling: () => {
			const signal = setupSignaling()
			signals.push(signal)
			return signal.signaling
		},
		now: () => clock,
		timeoutMs: 1_000,
	})

	for (const suffix of ['a', 'b']) {
		clock = 0
		const pending = host.connect(proof(`device-extreme-clock-${suffix}`))
		await new Promise((resolve) => setImmediate(resolve))
		clock = Number.MAX_SAFE_INTEGER
		signals.at(-1).inbound[0]({ type: 'offer', sdp: 'offer-sdp', signature: 'valid' })
		await pending
	}

	assert.deepEqual(host.snapshot.measurements, {
		peakActiveSessions: 2,
		peakPendingConnections: 1,
		completedConnections: 2,
		totalConnectionDurationMs: Number.MAX_SAFE_INTEGER,
		maxConnectionDurationMs: Number.MAX_SAFE_INTEGER,
		iceConfigurations: 2,
		relayCapableIceConfigurations: 0,
		turnCredentialRequests: 0,
		turnCredentialFailures: 0,
		activeTurnCredentialRequests: 0,
		peakActiveTurnCredentialRequests: 0,
	})
	await host.shutdown()
})
