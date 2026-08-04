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
  api.getAssetManifest = async () => ({ assets: [{ path: '/remote-app/bundle/remote.html' }] })

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value))
  assetChannel.dispatchMessage(encode({ id: 'manifest', type: 'asset:get-manifest' }))
  await waitFor(() => assetChannel.sent.some((raw) => JSON.parse(raw).id === 'manifest'))

  terminalChannel.dispatchMessage(encode({ ticket: 'ticket-1', type: 'terminal-auth' }))
  await api.waitForAttach()
  terminalChannel.dispatchMessage(new TextEncoder().encode('byte-view-terminal-input'))
  await waitFor(() => api.terminalMessages.some(({ message }) => message === 'byte-view-terminal-input'))

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

test('WebRTC host bounds acknowledged asset chunks without starving API traffic', async () => {
  const api = createHostApi()
  const assetChannel = new AutoAckDataChannel('asset')
  const apiChannel = new MockDataChannel('api')
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => {
    if (label === 'asset') return assetChannel
    if (label === 'api') return apiChannel
    return new MockDataChannel(label)
  }
  api.getAsset = async () => ({
    bodyBase64: 'A'.repeat(10 * 64 * 1024),
    contentType: 'application/javascript',
    hash: 'asset-hash',
    path: '/remote-app/bundle/assets/large.js',
  })
  api.handleApiRequest = async () => ({ responsive: true })

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  assetChannel.dispatchMessage(JSON.stringify({
    id: 'large-asset',
    path: '/remote-app/bundle/assets/large.js',
    type: 'asset:get',
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
    assetChannel.sent
      .map((raw) => JSON.parse(raw))
      .filter((message) => message.type === 'asset:chunk')
      .map((message) => message.index),
    Array.from({ length: 10 }, (_, index) => index),
  )

  cleanup()
})

test('WebRTC host stops an unacknowledged asset transfer when the browser cancels it', async () => {
  const api = createHostApi()
  const assetChannel = new MockDataChannel('asset')
  const peer = new MockPeerConnection()
  peer.createDataChannel = (label) => label === 'asset'
    ? assetChannel
    : new MockDataChannel(label)
  api.getAsset = async () => ({
    bodyBase64: 'A'.repeat(10 * 64 * 1024),
    contentType: 'application/javascript',
    hash: 'asset-hash',
    path: '/remote-app/bundle/assets/cancel.js',
  })

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  assetChannel.dispatchMessage(JSON.stringify({
    id: 'cancel-asset',
    path: '/remote-app/bundle/assets/cancel.js',
    type: 'asset:get',
  }))
  await waitFor(() => assetChannel.sent.filter((raw) => JSON.parse(raw).type === 'asset:chunk').length === 4)
  assetChannel.dispatchMessage(JSON.stringify({
    id: 'cancel-asset',
    type: 'asset:cancel',
  }))
  await settle()

  assert.equal(
    assetChannel.sent.filter((raw) => JSON.parse(raw).type === 'asset:chunk').length,
    4,
  )
  assert.equal(
    assetChannel.sent.some((raw) => /cancelled/.test(JSON.parse(raw).error ?? '')),
    true,
  )
  cleanup()
})

test('WebRTC host admits one asset request per peer and rejects request-window multiplication', async () => {
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
  let assetReads = 0
  api.getAsset = async (assetPath) => {
    assetReads += 1
    return {
      bodyBase64: assetPath.endsWith('after-cancel.js')
        ? 'small-response'
        : 'A'.repeat(10 * 64 * 1024),
      contentType: 'application/javascript',
      hash: 'asset-hash',
      path: assetPath,
    }
  }
  api.handleApiRequest = async () => ({ responsive: true })

  const cleanup = await runHost(createHostConfig(), {
    api,
    createPeerConnection: () => peer,
  })
  terminalChannel.dispatchMessage(JSON.stringify({ ticket: 'ticket-1', type: 'terminal-auth' }))
  await api.waitForAttach()
  assetChannel.dispatchMessage(JSON.stringify({
    id: 'accepted-stalled-asset',
    path: '/remote-app/bundle/assets/stalled.js',
    type: 'asset:get',
  }))
  await waitFor(() => assetChannel.sent.filter((raw) => JSON.parse(raw).type === 'asset:chunk').length === 4)

  const rejectedIds = Array.from({ length: 12 }, (_, index) => `excess-asset-${index}`)
  for (const id of rejectedIds) {
    assetChannel.dispatchMessage(JSON.stringify({
      id,
      path: `/remote-app/bundle/assets/${id}.js`,
      type: 'asset:get',
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
    const message = JSON.parse(raw)
    return message.id === id && /limit reached.*262144/.test(message.error ?? '')
  })))
  await waitFor(() => apiChannel.sent.some((raw) => JSON.parse(raw).id === 'api-under-admission-pressure'))
  assert.equal(assetReads, 1)
  assert.equal(api.terminalMessages.some(({ message }) => message === 'terminal-under-admission-pressure'), true)
  assert.equal(
    assetChannel.sent.filter((raw) => JSON.parse(raw).type === 'asset:chunk').length,
    4,
  )

  assetChannel.dispatchMessage(JSON.stringify({
    id: 'accepted-stalled-asset',
    type: 'asset:cancel',
  }))
  await waitFor(() => assetChannel.sent.some((raw) => {
    const message = JSON.parse(raw)
    return message.id === 'accepted-stalled-asset' && /cancelled/.test(message.error ?? '')
  }))
  assetChannel.dispatchMessage(JSON.stringify({
    id: 'accepted-after-cancel',
    path: '/remote-app/bundle/assets/after-cancel.js',
    type: 'asset:get',
  }))
  await waitFor(() => assetChannel.sent.some((raw) => JSON.parse(raw).id === 'accepted-after-cancel'))
  assert.equal(assetReads, 2)

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
    getAsset: async () => ({}),
    getAssetManifest: async () => ({}),
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
    const message = JSON.parse(raw)
    if (message.type !== 'asset:chunk') return
    this.sentChunks.add(message.index)
    this.maxOutstanding = Math.max(
      this.maxOutstanding,
      this.sentChunks.size - this.acknowledged.size,
    )
    setTimeout(() => {
      this.acknowledged.add(message.index)
      this.dispatchMessage(JSON.stringify({
        id: message.id,
        index: message.index,
        type: 'asset:ack',
      }))
    }, 2)
  }
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
