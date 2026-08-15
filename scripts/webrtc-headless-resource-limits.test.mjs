import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const PEER_COUNT = 12
const UI_ARCHIVE_CHUNK_BYTES = 64 * 1024
const ASSET_CHUNK_COUNT = 10
const ASSET_WINDOW = 4

const { runHost } = await importWebRtcHost()

test('multi-peer asset pressure stays proportional to the fixed per-peer ACK window', async () => {
  const runtimes = []
  let aggregateOutstanding = 0
  let maximumAggregateOutstanding = 0

  for (let index = 0; index < PEER_COUNT; index += 1) {
    const api = createHostApi()
    const peer = new MockPeerConnection()
    const asset = new AutoAckDataChannel('asset', {
      ackDelayMs: 5 + (index % 4),
      onOutstandingChange(delta) {
        aggregateOutstanding += delta
        maximumAggregateOutstanding = Math.max(maximumAggregateOutstanding, aggregateOutstanding)
      },
    })
    const apiChannel = new MockDataChannel('api')
    peer.channels.set('asset', asset)
    peer.channels.set('api', apiChannel)
    api.getUiArchive = async () => fixtureArchive(`bundle-${index}`, ASSET_CHUNK_COUNT * UI_ARCHIVE_CHUNK_BYTES)
    api.handleApiRequest = async () => ({ peer: index, responsive: true })

    const cleanup = await runHost(createHostConfig(index), {
      api,
      createPeerConnection: () => peer,
    })
    runtimes.push({ api, apiChannel, asset, cleanup, peer })
  }

  for (const [index, runtime] of runtimes.entries()) {
    runtime.asset.dispatchMessage(JSON.stringify({
      id: `asset-${index}`,
			archiveFormatVersion: 1,
      type: 'asset:get-bundle',
    }))
    runtime.apiChannel.dispatchMessage(JSON.stringify({
      body: {},
      id: `api-${index}`,
      pathname: '/api/sessions',
      type: 'api-request',
    }))
  }

  await waitFor(() => runtimes.every(({ apiChannel }) => (
    apiChannel.sent.some((raw) => JSON.parse(raw).type === 'api-response')
  )))
  await waitFor(() => runtimes.every(({ asset }) => asset.acknowledged.size === ASSET_CHUNK_COUNT))

  assert.equal(runtimes.every(({ asset }) => asset.maximumOutstanding <= ASSET_WINDOW), true)
  assert.equal(
    maximumAggregateOutstanding <= PEER_COUNT * ASSET_WINDOW,
    true,
    `aggregate outstanding chunks exceeded ${PEER_COUNT} peers × ${ASSET_WINDOW}`,
  )
  assert.equal(aggregateOutstanding, 0)
	assert.equal(runtimes.every(({ peer }) => peer.createdChannelCount === 6), true)

  for (const runtime of runtimes) runtime.cleanup()
  assert.equal(runtimes.every(({ peer }) => peer.closeCount === 1), true)
  assert.equal(runtimes.every(({ api }) => api.listenerCount === 0), true)
})

test('a slow consumer can be cancelled without starving API or terminal traffic', async () => {
  const api = createHostApi()
  const peer = new MockPeerConnection()
  const asset = new MockDataChannel('asset')
  const apiChannel = new MockDataChannel('api')
  const terminal = new MockDataChannel('terminal')
  peer.channels.set('asset', asset)
  peer.channels.set('api', apiChannel)
  peer.channels.set('terminal', terminal)
  api.getUiArchive = async () => fixtureArchive('slow-bundle', ASSET_CHUNK_COUNT * UI_ARCHIVE_CHUNK_BYTES)
  api.handleApiRequest = async () => ({ responsive: true })

  const cleanup = await runHost(createHostConfig(20), {
    api,
    createPeerConnection: () => peer,
  })
  terminal.dispatchMessage(JSON.stringify({ ticket: 'ticket-20', type: 'terminal-auth' }))
  await api.waitForAttach()
  asset.dispatchMessage(JSON.stringify({
    id: 'slow-asset',
		archiveFormatVersion: 1,
    type: 'asset:get-bundle',
  }))
  await waitFor(() => asset.binaryChunkMessages.length === ASSET_WINDOW)

  apiChannel.dispatchMessage(JSON.stringify({
    body: {},
    id: 'api-during-slow-consumer',
    pathname: '/api/sessions',
    type: 'api-request',
  }))
  terminal.dispatchMessage(JSON.stringify({ data: 'terminal-during-slow-consumer', type: 'write' }))
  await waitFor(() => apiChannel.sent.some((raw) => JSON.parse(raw).id === 'api-during-slow-consumer'))
  assert.equal(api.terminalMessages.length, 1)

  asset.dispatchMessage(JSON.stringify({ id: 'slow-asset', type: 'asset:bundle-cancel' }))
  await waitFor(() => asset.sent.some((raw) => isControl(raw, 'asset:bundle-error') && /cancelled/.test(JSON.parse(raw).message ?? '')))
  await settle()
  assert.equal(asset.binaryChunkMessages.length, ASSET_WINDOW)

  cleanup()
  assert.equal(peer.closeCount, 1)
  assert.equal(api.listenerCount, 0)
})

test('relay loss, peer failure, and revocation remain isolated and shut down deterministically', async () => {
  const first = await createRuntime(30)
  const second = await createRuntime(31)

  first.api.emitSignalMessage({
    message: 'relay transport lost',
    roomId: createHostConfig(30).roomId,
    type: 'error',
  })
  await waitFor(() => first.api.statusMessages.some(({ detail }) => detail === 'relay transport lost'))
  assert.equal(first.peer.connectionState, 'new')
  assert.equal(second.peer.connectionState, 'new')

  first.terminal.dispatchMessage(JSON.stringify({ ticket: 'ticket-30', type: 'terminal-auth' }))
  second.terminal.dispatchMessage(JSON.stringify({ ticket: 'ticket-31', type: 'terminal-auth' }))
  await Promise.all([first.api.waitForAttach(), second.api.waitForAttach()])

  first.peer.fail()
  assert.deepEqual(first.api.closedTerminals, [{
    channelId: first.api.attachedChannelId,
    reason: 'WebRTC peer connection failed.',
  }])
  assert.equal(second.api.closedTerminals.length, 0)

  second.api.emitTerminalCloseRequest({
    channelId: second.api.attachedChannelId,
    reason: 'Device revoked',
  })
  assert.equal(second.terminal.closed, true)
  assert.deepEqual(second.api.closedTerminals, [{
    channelId: second.api.attachedChannelId,
    reason: 'Device revoked',
  }])

  first.cleanup()
  second.cleanup()
  assert.equal(first.api.closedTerminals.length, 1)
  assert.equal(second.api.closedTerminals.length, 1)
  assert.equal(first.peer.closeCount, 1)
  assert.equal(second.peer.closeCount, 1)
  assert.equal(first.api.listenerCount, 0)
  assert.equal(second.api.listenerCount, 0)
})

async function createRuntime(index) {
  const api = createHostApi()
  const peer = new MockPeerConnection()
  const terminal = new MockDataChannel('terminal')
  peer.channels.set('terminal', terminal)
  const cleanup = await runHost(createHostConfig(index), {
    api,
    createPeerConnection: () => peer,
  })
  return { api, cleanup, peer, terminal }
}

function createHostConfig(index) {
  return {
    appOrigin: `https://session-${index}.terminay.com`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    iceServers: [],
    relayJoinTokenHash: `relay-token-hash-${index}`,
    roomId: `room-${index}`,
    sessionId: `session-${index}`,
    signalingUrl: `wss://session-${index}.terminay.com/signal`,
  }
}

function createHostApi() {
  let attachResolve
  const attachPromise = new Promise((resolve) => {
    attachResolve = resolve
  })
  const closeRequestListeners = new Set()
  const signalListeners = new Set()
  const terminalMessageListeners = new Set()
  return {
    attachedChannelId: null,
    closedTerminals: [],
    signalMessages: [],
    statusMessages: [],
    terminalMessages: [],
    async attachTerminal(channelId) {
      this.attachedChannelId = channelId
      attachResolve()
    },
    closeTerminal(channelId, reason) {
      this.closedTerminals.push({ channelId, reason })
    },
    emitSignalMessage(message) {
      for (const listener of signalListeners) listener(message)
    },
    emitTerminalCloseRequest(message) {
      for (const listener of closeRequestListeners) listener(message)
    },
    get listenerCount() {
      return closeRequestListeners.size + signalListeners.size + terminalMessageListeners.size
    },
		getUiArchive: async () => fixtureArchive('default-bundle', 1),
    getConfig: async () => null,
    handleApiRequest: async () => ({}),
    handleTerminalMessage(channelId, message) {
      this.terminalMessages.push({ channelId, message })
    },
    onConfig: () => () => {},
    openSignal() {},
    onSignalMessage(listener) {
      signalListeners.add(listener)
      return () => signalListeners.delete(listener)
    },
    onTerminalCloseRequest(listener) {
      closeRequestListeners.add(listener)
      return () => closeRequestListeners.delete(listener)
    },
    onTerminalMessage(listener) {
      terminalMessageListeners.add(listener)
      return () => terminalMessageListeners.delete(listener)
    },
    sendSignalMessage(message) {
      this.signalMessages.push(message)
    },
    updateStatus(message) {
      this.statusMessages.push(message)
    },
    waitForAttach: () => attachPromise,
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

  get binaryChunkMessages() {
    return this.sent
			.filter((raw) => raw instanceof ArrayBuffer)
  }

  close() {
    if (this.closed) return
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
  constructor(label, { ackDelayMs, onOutstandingChange }) {
    super(label)
    this.ackDelayMs = ackDelayMs
    this.acknowledged = new Set()
    this.maximumOutstanding = 0
    this.onOutstandingChange = onOutstandingChange
    this.outstanding = 0
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
    this.outstanding += 1
    this.maximumOutstanding = Math.max(this.maximumOutstanding, this.outstanding)
    this.onOutstandingChange(1)
    setTimeout(() => {
      if (this.closed) return
      this.outstanding -= 1
      this.acknowledged.add(index)
      this.onOutstandingChange(-1)
      this.dispatchMessage(JSON.stringify({
			id: this.transferId,
			index,
			type: 'asset:bundle-ack',
      }))
    }, this.ackDelayMs)
  }
}

class MockPeerConnection extends EventTarget {
  constructor() {
    super()
    this.channels = new Map()
    this.closeCount = 0
    this.connectionState = 'new'
    this.createdChannelCount = 0
    this.iceConnectionState = 'new'
  }

  addIceCandidate() {
    return Promise.resolve()
  }

  close() {
    this.closeCount += 1
    this.connectionState = 'closed'
    for (const channel of this.channels.values()) channel.close()
  }

  createDataChannel(label) {
    this.createdChannelCount += 1
    const existing = this.channels.get(label)
    if (existing) return existing
    const channel = new MockDataChannel(label)
    this.channels.set(label, channel)
    return channel
  }

  createOffer() {
    return Promise.resolve({ sdp: 'v=0\r\n', type: 'offer' })
  }

  fail() {
    this.connectionState = 'failed'
    this.dispatchEvent(new Event('connectionstatechange'))
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

async function waitFor(predicate, timeoutMs = 2_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for the WebRTC resource condition.')
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30))
}

function fixtureArchive(bundleId, compressedBytes) {
	return { archiveFormatVersion: 1, bundleId, bytes: new Uint8Array(compressedBytes).fill(65), compressedBytes }
}

function isControl(raw, type) {
	return typeof raw === 'string' && JSON.parse(raw).type === type
}

async function importWebRtcHost() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-resource-test-'))
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
