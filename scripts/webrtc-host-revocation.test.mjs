import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { runHost } = await importWebRtcHost()

test('WebRTC host authenticates the canonical four-lane application session before use', async () => {
  const api = createHostApi()
  const channels = new Map()
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => {
    const channel = new MockDataChannel(label)
    channels.set(label, channel)
    return channel
  }

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })

  assert.deepEqual([...channels.keys()], [
    'api',
    'asset',
    'control',
    'application',
    'terminal',
    'assets',
  ])
  channels.get('control').dispatchMessage(JSON.stringify({
    id: 'auth-1',
    ticket: 'ticket-1',
    type: 'application-auth',
  }))
  await api.waitForApplicationAttach()

  assert.equal(api.applicationTicket, 'ticket-1')
  assert.equal(api.applicationChannel.label, 'application')
  assert.deepEqual(JSON.parse(channels.get('control').sent[0]), {
    id: 'auth-1',
    ok: true,
    type: 'application-authenticated',
  })
  channels.get('application').close()
  assert.deepEqual(api.closedApplications, [{
    channelId: api.applicationChannelId,
    reason: 'WebRTC application channel closed.',
  }])
  cleanup()
})

test('WebRTC host preserves an authenticated session across a transient ICE disconnect', async () => {
  const api = createHostApi()
  const channels = new Map()
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => {
    const channel = new MockDataChannel(label)
    channels.set(label, channel)
    return channel
  }

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })

  channels.get('control').dispatchMessage(JSON.stringify({
    id: 'auth-transient-disconnect',
    ticket: 'ticket-transient-disconnect',
    type: 'application-auth',
  }))
  await api.waitForApplicationAttach()

  peer.iceConnectionState = 'disconnected'
  peer.dispatchEvent(new Event('iceconnectionstatechange'))
  await settle()

  peer.iceConnectionState = 'connected'
  peer.dispatchEvent(new Event('iceconnectionstatechange'))

  assert.deepEqual(api.closedApplications, [])
  assert.equal(channels.get('application').readyState, 'open')
  assert.equal(channels.get('terminal').readyState, 'open')

  cleanup()
})

test('WebRTC host closes an authenticated session once when ICE recovery expires', async () => {
  const api = createHostApi()
  const channels = new Map()
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => {
    const channel = new MockDataChannel(label)
    channels.set(label, channel)
    return channel
  }

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
    iceRecoveryGraceMs: 10,
  })

  channels.get('control').dispatchMessage(JSON.stringify({
    id: 'auth-expired-disconnect',
    ticket: 'ticket-expired-disconnect',
    type: 'application-auth',
  }))
  await api.waitForApplicationAttach()

  peer.iceConnectionState = 'disconnected'
  peer.dispatchEvent(new Event('iceconnectionstatechange'))
  await waitFor(() => api.closedApplications.length === 1)

  peer.connectionState = 'failed'
  peer.dispatchEvent(new Event('connectionstatechange'))
  assert.equal(api.closedApplications.length, 1)
  assert.match(
    api.closedApplications[0].reason,
    /^WebRTC recovery grace period expired/u,
  )

  cleanup()
})

test('WebRTC host closes the terminal data channel when the desktop revokes the connection', async () => {
  const api = createHostApi()
  const terminalChannel = new MockDataChannel('terminal')

  globalThis.window = { terminayWebRtcHost: api }
  globalThis.RTCPeerConnection = class extends MockPeerConnection {
    createDataChannel(label) {
      if (label === 'terminal') return terminalChannel
      return new MockDataChannel(label)
    }
  }

  const cleanup = await runHost({
    appOrigin: 'https://room-a12345.terminay.com',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    iceServers: [],
    relayJoinTokenHash: 'relay-token-hash',
    roomId: 'room-a12345',
    signalingAuthToken: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    signalingUrl: 'wss://room-a12345.terminay.com/signal',
  })

  terminalChannel.dispatchMessage(JSON.stringify({ ticket: 'ticket-1', type: 'terminal-auth' }))
  await api.waitForAttach()

  assert.equal(terminalChannel.closed, false)
  api.emitTerminalCloseRequest({ channelId: api.attachedChannelId, reason: 'Device revoked' })

  assert.equal(terminalChannel.closed, true)
  assert.deepEqual(api.closedTerminals, [{ channelId: api.attachedChannelId, reason: 'Device revoked' }])
  cleanup()
})

test('WebRTC host accepts bounded UTF-8 byte-view messages from a non-browser peer', async () => {
  const api = createHostApi()
  const assetChannel = new MockDataChannel('asset')
  const terminalChannel = new MockDataChannel('terminal')
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => label === 'asset'
    ? assetChannel
    : label === 'terminal'
      ? terminalChannel
      : new MockDataChannel(label)
	api.getUiArchive = async () => fixtureArchive('byte-view-bundle', 1)

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value))
	assetChannel.dispatchMessage(encode({ archiveFormatVersion: 1, id: 'bundle', type: 'asset:get-bundle' }))
	await waitFor(() => controlMessages(assetChannel).some((message) => message.id === 'bundle' && message.type === 'asset:bundle-start'))

  terminalChannel.dispatchMessage(encode({ ticket: 'ticket-1', type: 'terminal-auth' }))
  await api.waitForAttach()
  terminalChannel.dispatchMessage(new TextEncoder().encode('byte-view-terminal-input'))
  await waitFor(() => api.terminalMessages.some(({ message }) => message === 'byte-view-terminal-input'))

  cleanup()
})

test('WebRTC host rejects retired manifest and per-file asset requests', async () => {
	const api = createHostApi()
	const assetChannel = new MockDataChannel('asset')
	const peer = new MockPeerConnection()
	peer.createDataChannel = (label) => label === 'asset' ? assetChannel : new MockDataChannel(label)
	let archiveReads = 0
	api.getUiArchive = async () => {
		archiveReads += 1
		return fixtureArchive('unused-bundle', 1)
	}
	const cleanup = await runHost(createHostConfig(), { api, createPeerConnection: () => peer })
	assetChannel.dispatchMessage(JSON.stringify({ id: 'retired-manifest', type: 'asset:get-manifest' }))
	assetChannel.dispatchMessage(JSON.stringify({ id: 'retired-file', path: '/remote-app/anything.js', type: 'asset:get' }))
	await waitFor(() => controlMessages(assetChannel).filter((message) => message.type === 'asset:bundle-error').length === 2)
	assert.equal(archiveReads, 0)
	assert.equal(controlMessages(assetChannel).every((message) => message.code === 'invalid-request'), true)
	cleanup()
})

test('WebRTC host owns relay registration and sends an offer after client join', async () => {
  const api = createHostApi()

  globalThis.window = { terminayWebRtcHost: api }
  globalThis.RTCPeerConnection = MockPeerConnection

  const cleanup = await runHost({
    appOrigin: 'https://room-a12345.terminay.com',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    iceServers: [],
    relayJoinTokenHash: 'relay-token-hash',
    roomId: 'room-a12345',
    signalingAuthToken: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    signalingUrl: 'wss://room-a12345.terminay.com/signal',
  })

  assert.equal(api.signalOpened, true)

  api.emitSignalMessage({ roomId: 'room-a12345', type: 'host-registered' })
  api.emitSignalMessage({ roomId: 'room-a12345', type: 'client-join' })
  await waitFor(() => api.signalMessages.some((message) => message.type === 'offer'))

  assert.equal(api.signalMessages.some((message) => message.type === 'host-ready'), false)
  assert.deepEqual(api.statusMessages, [{ type: 'host-registered' }, { type: 'client-join' }])
  const offerMessage = api.signalMessages.find((message) => message.type === 'offer')
  assert.equal(offerMessage.roomId, 'room-a12345')
  assert.equal(offerMessage.sdp.type, 'offer')
  assert.equal(typeof offerMessage.signature, 'string')
  assert.equal(typeof offerMessage.nonce, 'string')

  cleanup()
})

test('WebRTC host ignores signaling messages for another room', async () => {
  const api = createHostApi()

  globalThis.window = { terminayWebRtcHost: api }
  globalThis.RTCPeerConnection = MockPeerConnection

  const cleanup = await runHost({
    appOrigin: 'https://session-a.terminay.com',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    iceServers: [],
    relayJoinTokenHash: 'relay-token-hash',
    roomId: 'room-a12345',
    sessionId: 'session-a',
    signalingAuthToken: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    signalingUrl: 'wss://session-a.terminay.com/signal',
  })

  api.emitSignalMessage({ roomId: 'room-b67890', type: 'host-registered' })
  api.emitSignalMessage({ roomId: 'room-b67890', type: 'client-join' })
  await settle()

  assert.deepEqual(api.statusMessages, [])
  assert.equal(api.signalMessages.some((message) => message.type === 'offer'), false)

  cleanup()
})

test('WebRTC host verifies a signal before reserving its nonce and rejects a verified replay', async () => {
  const api = createHostApi()
  const peer = new MockPeerConnection()
  const signalingAuthToken = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
  const config = {
    appOrigin: 'https://session-a.terminay.com',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    iceServers: [],
    relayJoinTokenHash: 'relay-token-hash',
    roomId: 'room-a12345',
    sessionId: 'session-a',
    signalingAuthToken,
    signalingUrl: 'wss://session-a.terminay.com/signal',
  }
  const answer = {
    nonce: 'same-nonce-is-valid-after-the-forgery',
    roomId: config.roomId,
    sdp: { sdp: 'v=0\r\n', type: 'answer' },
    type: 'answer',
  }
  const validAnswer = {
    ...answer,
    signature: await signSignal(signalingAuthToken, answer),
  }

  const cleanup = await runHost(config, {
    api,
    createPeerConnection: () => peer,
  })

  api.emitSignalMessage({
    ...answer,
    signature: 'forged-signature',
  })
  await waitFor(() => api.statusMessages.some((message) => /unauthenticated/.test(message.detail ?? '')))
  assert.equal(peer.remoteDescription, undefined)

  api.emitSignalMessage(validAnswer)
  await waitFor(() => peer.remoteDescription)
  assert.deepEqual(peer.remoteDescription, answer.sdp)

  api.emitSignalMessage(validAnswer)
  await waitFor(() => api.statusMessages.some((message) => /replayed/.test(message.detail ?? '')))
  assert.deepEqual(peer.remoteDescription, answer.sdp)

  cleanup()
})

test('WebRTC host bounds acknowledged binary archive chunks without starving API traffic', async () => {
  const api = createHostApi()
  const assetChannel = new AutoAckDataChannel('asset')
  const apiChannel = new MockDataChannel('api')
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => {
    if (label === 'asset') return assetChannel
    if (label === 'api') return apiChannel
    return new MockDataChannel(label)
  }
  api.getUiArchive = async () => fixtureArchive('large-bundle', 10 * 64 * 1024)
  api.handleApiRequest = async () => ({ responsive: true })

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  assetChannel.dispatchMessage(JSON.stringify({
		archiveFormatVersion: 1,
    id: 'large-bundle',
    type: 'asset:get-bundle',
  }))
  apiChannel.dispatchMessage(JSON.stringify({
    body: {},
    id: 'api-during-asset',
    pathname: '/api/sessions',
    type: 'api-request',
  }))

  await waitFor(() => apiChannel.sent.some((raw) => JSON.parse(raw).id === 'api-during-asset'))
  await waitFor(() => assetChannel.acknowledged.size === 10)
  assert.equal(assetChannel.maxOutstanding <= 4, true)
  assert.deepEqual(
		binaryChunkIndexes(assetChannel),
    Array.from({ length: 10 }, (_, index) => index),
  )

  cleanup()
})

test('WebRTC host stops an unacknowledged archive transfer when the browser cancels it', async () => {
  const api = createHostApi()
  const assetChannel = new MockDataChannel('asset')
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => label === 'asset'
    ? assetChannel
    : new MockDataChannel(label)
  api.getUiArchive = async () => fixtureArchive('cancel-bundle', 10 * 64 * 1024)

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  assetChannel.dispatchMessage(JSON.stringify({
		archiveFormatVersion: 1,
    id: 'cancel-bundle',
    type: 'asset:get-bundle',
  }))
  await waitFor(() => binaryChunkIndexes(assetChannel).length === 4)
  assetChannel.dispatchMessage(JSON.stringify({
		id: 'cancel-bundle',
    type: 'asset:bundle-cancel',
  }))
  await settle()

  assert.equal(
    binaryChunkIndexes(assetChannel).length,
    4,
  )
  assert.equal(
		controlMessages(assetChannel).some((message) => message.type === 'asset:bundle-error' && /cancelled/.test(message.message ?? '')),
    true,
  )
  cleanup()
})

test('WebRTC host admits one archive request per peer and rejects request-window multiplication', async () => {
  const api = createHostApi()
  const assetChannel = new MockDataChannel('asset')
  const apiChannel = new MockDataChannel('api')
  const terminalChannel = new MockDataChannel('terminal')
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => {
    if (label === 'asset') return assetChannel
    if (label === 'api') return apiChannel
    if (label === 'terminal') return terminalChannel
    return new MockDataChannel(label)
  }
  let archiveReads = 0
  api.getUiArchive = async () => {
		archiveReads += 1
		return fixtureArchive(`bundle-${archiveReads}`, archiveReads === 2 ? 1 : 10 * 64 * 1024)
	}
  api.handleApiRequest = async () => ({ responsive: true })

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  terminalChannel.dispatchMessage(JSON.stringify({ ticket: 'ticket-1', type: 'terminal-auth' }))
  await api.waitForAttach()
  assetChannel.dispatchMessage(JSON.stringify({
		archiveFormatVersion: 1,
    id: 'accepted-stalled-bundle',
    type: 'asset:get-bundle',
  }))
  await waitFor(() => binaryChunkIndexes(assetChannel).length === 4)

  const rejectedIds = Array.from({ length: 12 }, (_, index) => `excess-bundle-${index}`)
  for (const id of rejectedIds) {
    assetChannel.dispatchMessage(JSON.stringify({
      id,
			archiveFormatVersion: 1,
      type: 'asset:get-bundle',
    }))
  }
  apiChannel.dispatchMessage(JSON.stringify({
    body: {},
    id: 'api-under-admission-pressure',
    pathname: '/api/sessions',
    type: 'api-request',
  }))
  terminalChannel.dispatchMessage('terminal-under-admission-pressure')

  await waitFor(() => rejectedIds.every((id) => assetChannel.sent.some((raw) => {
    return typeof raw === 'string' && (() => {
			const message = JSON.parse(raw)
			return message.id === id && message.type === 'asset:bundle-error' && message.code === 'unavailable'
		})()
  })))
  await waitFor(() => apiChannel.sent.some((raw) => JSON.parse(raw).id === 'api-under-admission-pressure'))
  assert.equal(archiveReads, 1)
  assert.equal(api.terminalMessages.some(({ message }) => message === 'terminal-under-admission-pressure'), true)
  assert.equal(
    binaryChunkIndexes(assetChannel).length,
    4,
  )

  assetChannel.dispatchMessage(JSON.stringify({
		id: 'accepted-stalled-bundle',
    type: 'asset:bundle-cancel',
  }))
  await waitFor(() => assetChannel.sent.some((raw) => {
    if (typeof raw !== 'string') return false
		const message = JSON.parse(raw)
		return message.id === 'accepted-stalled-bundle' && message.type === 'asset:bundle-error' && /cancelled/.test(message.message ?? '')
  }))
  assetChannel.dispatchMessage(JSON.stringify({
		archiveFormatVersion: 1,
    id: 'accepted-after-cancel',
    type: 'asset:get-bundle',
  }))
  await waitFor(() => controlMessages(assetChannel).some((message) => message.id === 'accepted-after-cancel' && message.type === 'asset:bundle-start'))
  assert.equal(archiveReads, 2)

  cleanup()
})

function createHostConfig() {
  return {
    appOrigin: 'https://session-a.terminay.com',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    iceServers: [],
    relayJoinTokenHash: 'relay-token-hash',
    roomId: 'room-a12345',
    sessionId: 'session-a',
    signalingAuthToken: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    signalingUrl: 'wss://session-a.terminay.com/signal',
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function signSignal(token, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    Buffer.from(token, 'base64url'),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const canonical = stableJson({
    nonce: message.nonce,
    roomId: message.roomId ?? message.sessionId,
    sdp: message.sdp,
    type: message.type,
  })
  return Buffer.from(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(canonical),
  )).toString('base64url')
}

async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition.')
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

function createHostApi() {
  let attachResolve
  const attachPromise = new Promise((resolve) => {
    attachResolve = resolve
  })
  let applicationAttachResolve
  const applicationAttachPromise = new Promise((resolve) => {
    applicationAttachResolve = resolve
  })
  const closeRequestListeners = new Set()
  const signalListeners = new Set()
  return {
    attachedChannelId: null,
    applicationChannel: null,
    applicationChannelId: null,
    applicationTicket: null,
    closedApplications: [],
    closedTerminals: [],
    signalMessages: [],
    signalOpened: false,
    terminalMessages: [],
    async attachTerminal(channelId) {
      this.attachedChannelId = channelId
      attachResolve()
    },
    async attachApplication(channelId, ticket, channel) {
      this.applicationChannel = channel
      this.applicationChannelId = channelId
      this.applicationTicket = ticket
      applicationAttachResolve()
    },
    closeApplication(channelId, reason) {
      this.closedApplications.push({ channelId, reason })
    },
    closeTerminal(channelId, reason) {
      this.closedTerminals.push({ channelId, reason })
    },
    emitTerminalCloseRequest(message) {
      for (const listener of closeRequestListeners) listener(message)
    },
    emitSignalMessage(message) {
      for (const listener of signalListeners) listener(message)
    },
		getUiArchive: async () => fixtureArchive('default-bundle', 1),
    getConfig: async () => null,
    handleApiRequest: async () => ({}),
    handleTerminalMessage(channelId, message) {
      this.terminalMessages.push({ channelId, message })
    },
    onConfig: () => () => {},
    openSignal() {
      this.signalOpened = true
    },
    sendSignalMessage(message) {
      this.signalMessages.push(message)
    },
    onSignalMessage(listener) {
      signalListeners.add(listener)
      return () => signalListeners.delete(listener)
    },
    onTerminalCloseRequest(listener) {
      closeRequestListeners.add(listener)
      return () => closeRequestListeners.delete(listener)
    },
    onTerminalMessage: () => () => {},
    statusMessages: [],
    updateStatus(message) {
      this.statusMessages.push(message)
    },
    waitForAttach: () => attachPromise,
    waitForApplicationAttach: () => applicationAttachPromise,
  }
}

class MockDataChannel extends EventTarget {
  constructor(label) {
    super()
    this.closed = false
    this.label = label
    this.readyState = 'open'
    this.sent = []
  }

  close() {
    this.closed = true
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
  }

  dispatchMessage(data) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  send(message) {
    this.sent.push(message)
  }
}

class AutoAckDataChannel extends MockDataChannel {
  constructor(label) {
    super(label)
    this.acknowledged = new Set()
    this.maxOutstanding = 0
    this.sentChunks = new Set()
  }

  send(raw) {
    super.send(raw)
		if (typeof raw === 'string') {
			const message = JSON.parse(raw)
			if (message.type === 'asset:bundle-start') this.transferId = message.id
			return
		}
		if (!(raw instanceof ArrayBuffer)) return
		const index = new DataView(raw).getUint32(4, false)
		this.sentChunks.add(index)
    this.maxOutstanding = Math.max(
      this.maxOutstanding,
      this.sentChunks.size - this.acknowledged.size,
    )
    setTimeout(() => {
      this.acknowledged.add(index)
      this.dispatchMessage(JSON.stringify({
			id: this.transferId,
			index,
			type: 'asset:bundle-ack',
      }))
    }, 2)
  }
}

function fixtureArchive(bundleId, compressedBytes) {
	return { archiveFormatVersion: 1, bundleId, bytes: new Uint8Array(compressedBytes).fill(65), compressedBytes }
}

function controlMessages(channel) {
	return channel.sent.filter((raw) => typeof raw === 'string').map((raw) => JSON.parse(raw))
}

function binaryChunkIndexes(channel) {
	return channel.sent
		.filter((raw) => raw instanceof ArrayBuffer)
		.map((raw) => new DataView(raw).getUint32(4, false))
}

class MockPeerConnection extends EventTarget {
  constructor() {
    super()
    this.connectionState = 'new'
    this.iceConnectionState = 'new'
  }

  addIceCandidate() {
    return Promise.resolve()
  }

  close() {
    this.connectionState = 'closed'
  }

  createDataChannel(label) {
    return new MockDataChannel(label)
  }

  createOffer() {
    return Promise.resolve({ sdp: 'v=0\r\n', type: 'offer' })
  }

  setLocalDescription(description) {
    this.localDescription = description
    return Promise.resolve()
  }

  setRemoteDescription(description) {
    this.remoteDescription = description
    return Promise.resolve()
  }
}

async function importWebRtcHost() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-host-test-'))
  const outputPath = join(tempDir, 'WebRtcHost.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('./support/webRtcHostRuntime.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
