import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { runHost } = await importWebRtcHost()

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
  const closeRequestListeners = new Set()
  const signalListeners = new Set()
  return {
    attachedChannelId: null,
    closedTerminals: [],
    signalMessages: [],
    signalOpened: false,
    async attachTerminal(channelId) {
      this.attachedChannelId = channelId
      attachResolve()
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
    handleTerminalMessage() {},
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
    entryPoints: [new URL('../src/remote/WebRtcHost.tsx', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
