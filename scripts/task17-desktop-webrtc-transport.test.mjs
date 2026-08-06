import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-webrtc-'))
const output = join(directory, 'desktopWebRtcTransport.mjs')
await build({
  alias: {
    '@terminay/server-core': join(process.cwd(), 'packages/server-core/src/index.ts'),
  },
  bundle: true,
  entryPoints: ['electron/remote/desktopWebRtcTransport.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
  target: 'node20',
})
const { createDesktopWebRtcTransport } = await import(pathToFileURL(output).href)
test.after(async () => rm(directory, { force: true, recursive: true }))
const identity = {
  deviceId: 'desktop-device',
  serverId: 'desktop-server',
  sessionOrigin: 'https://session.example',
}

class Channel {
  listeners = new Set()
  closedListeners = new Set()
  closed = false
  sent = []
  buffered = 0
  constructor(label) { this.label = label }
  getLabel() { return this.label }
  isOpen() { return !this.closed }
  bufferedAmount() { return this.buffered }
  sendMessageBinary(frame) { this.sent.push(new Uint8Array(frame)); return true }
  onMessage(listener) { this.listeners.add(listener) }
  onClosed(listener) { this.closedListeners.add(listener) }
  close() { if (this.closed) return; this.closed = true; for (const listener of this.closedListeners) listener() }
  emit(frame) { for (const listener of this.listeners) listener(new Uint8Array(frame)) }
}

class Peer {
  static instance
  channels = new Map()
  constructor() { Peer.instance = this }
  onLocalDescription(listener) { this.localDescription = listener }
  onLocalCandidate() {}
  onStateChange(listener) { this.state = listener }
  onDataChannel() {}
  createDataChannel(label) {
    const channel = new Channel(label)
    this.channels.set(label, channel)
    if (label === 'assets') queueMicrotask(() => this.localDescription('offer-sdp', 'offer'))
    return channel
  }
  setRemoteDescription() {
    queueMicrotask(() => this.state('connected'))
  }
  addRemoteCandidate() {}
  close() { for (const channel of this.channels.values()) channel.close() }
}

test('Desktop native offerer establishes four isolated lanes and exposes the framed application transport', async () => {
  let signalListener = () => {}
  const signaling = {
    onMessage(listener) { signalListener = listener; return () => { signalListener = () => {} } },
    send(message) {
      if (message.type === 'offer') queueMicrotask(() => signalListener({ type: 'answer', sdp: 'answer-sdp' }))
    },
    sign(message) { return message },
    verify(message) { return message },
  }
  const transport = await createDesktopWebRtcTransport({
    peerId: 'desktop-peer',
    ...identity,
    signaling,
    loadModule: async () => ({ PeerConnection: Peer }),
  })
  assert.deepEqual([...Peer.instance.channels.keys()], ['control', 'application', 'terminal', 'assets'])
  await transport.open()
  await transport.send(new Uint8Array([1, 2, 3]))
  assert.deepEqual([...Peer.instance.channels.get('application').sent[0]], [1, 2, 3])
  Peer.instance.channels.get('application').emit(new Uint8Array([4, 5]))
  assert.deepEqual([...(await transport.incoming[Symbol.asyncIterator]().next()).value], [4, 5])
  await transport.close()
  assert.ok([...Peer.instance.channels.values()].every(channel => channel.closed))
})

test('Desktop close discards application frames queued behind a stalled consumer', async () => {
  let signalListener = () => {}
  const signaling = {
    onMessage(listener) { signalListener = listener; return () => { signalListener = () => {} } },
    send(message) {
      if (message.type === 'offer') queueMicrotask(() => signalListener({ type: 'answer', sdp: 'answer-sdp' }))
    },
    sign(message) { return message },
    verify(message) { return message },
  }
  const transport = await createDesktopWebRtcTransport({
    peerId: 'desktop-stalled-consumer',
    ...identity,
    signaling,
    loadModule: async () => ({ PeerConnection: Peer }),
    transportOptions: { maxFrameBytes: 8, maxInboundBytes: 8 },
  })
  await transport.open()
  const application = Peer.instance.channels.get('application')
  application.emit(new Uint8Array([1, 2, 3, 4]))
  application.buffered = 6
  assert.equal(transport.bufferedBytes, 4)
  assert.equal(transport.queuedBytes, 6)

  await transport.close()

  assert.equal(transport.bufferedBytes, 0)
  assert.equal(transport.queuedBytes, 0)
  assert.deepEqual(
    await transport.incoming[Symbol.asyncIterator]().next(),
    { done: true, value: undefined },
  )
  assert.ok([...Peer.instance.channels.values()].every(channel => channel.closed))
})

test('Desktop native offerer rejects cross-server authenticated signaling and releases every lane', async () => {
  let signalListener = () => {}
  const signaling = {
    onMessage(listener) { signalListener = listener; return () => { signalListener = () => {} } },
    send(message) {
      if (message.signal?.type === 'offer') {
        queueMicrotask(() => signalListener({ serverId: 'other-server', signal: { type: 'answer', sdp: 'answer-sdp' } }))
      }
    },
    sign(message) { return { serverId: 'expected-server', signal: message } },
    verify(message) { return message.serverId === 'expected-server' ? message.signal : null },
  }
  await assert.rejects(createDesktopWebRtcTransport({
    peerId: 'desktop-cross-server',
    ...identity,
    signaling,
    loadModule: async () => ({ PeerConnection: Peer }),
  }), /authentication failed/u)
  assert.ok([...Peer.instance.channels.values()].every(channel => channel.closed))
})

test('Desktop native offerer rejects a replayed remote description before exposing a transport', async () => {
  let signalListener = () => {}
  const answer = { type: 'answer', sdp: 'answer-sdp' }
  const signaling = {
    onMessage(listener) { signalListener = listener; return () => { signalListener = () => {} } },
    send(message) {
      if (message.type === 'offer') queueMicrotask(() => {
        signalListener(answer)
        signalListener(answer)
      })
    },
    sign(message) { return message },
    verify(message) { return message },
  }
  await assert.rejects(createDesktopWebRtcTransport({
    peerId: 'desktop-replay',
    ...identity,
    signaling,
    loadModule: async () => ({ PeerConnection: Peer }),
  }), /replayed/u)
  assert.ok([...Peer.instance.channels.values()].every(channel => channel.closed))
})

test('Desktop application lane fails closed when a slow native channel remains backpressured', async () => {
  let signalListener = () => {}
  const signaling = {
    onMessage(listener) { signalListener = listener; return () => { signalListener = () => {} } },
    send(message) {
      if (message.type === 'offer') queueMicrotask(() => signalListener({ type: 'answer', sdp: 'answer-sdp' }))
    },
    sign(message) { return message },
    verify(message) { return message },
  }
  const transport = await createDesktopWebRtcTransport({
    peerId: 'desktop-slow-channel',
    ...identity,
    signaling,
    loadModule: async () => ({ PeerConnection: Peer }),
    transportOptions: { maxBufferedBytes: 16, maxFrameBytes: 8, maxWritableWaitMs: 10 },
  })
  await transport.open()
  Peer.instance.channels.get('application').buffered = 16
  await assert.rejects(transport.send(new Uint8Array([1])), /backpressured/u)
  assert.equal(transport.state, 'failed')
  assert.ok([...Peer.instance.channels.values()].every(channel => channel.closed))
})

test('Desktop closes the complete authenticated transport when an ancillary lane closes', async () => {
  let signalListener = () => {}
  const signaling = {
    onMessage(listener) { signalListener = listener; return () => { signalListener = () => {} } },
    send(message) {
      if (message.type === 'offer') queueMicrotask(() => signalListener({ type: 'answer', sdp: 'answer-sdp' }))
    },
    sign(message) { return message },
    verify(message) { return message },
  }
  const transport = await createDesktopWebRtcTransport({
    peerId: 'desktop-ancillary-close',
    ...identity,
    signaling,
    loadModule: async () => ({ PeerConnection: Peer }),
  })
  await transport.open()

  Peer.instance.channels.get('assets').close()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(transport.state, 'closed')
  assert.ok([...Peer.instance.channels.values()].every(channel => channel.closed))
})

test('Desktop abort after connection retires every WebRTC lane', async () => {
  let signalListener = () => {}
  const signaling = {
    onMessage(listener) { signalListener = listener; return () => { signalListener = () => {} } },
    send(message) {
      if (message.type === 'offer') queueMicrotask(() => signalListener({ type: 'answer', sdp: 'answer-sdp' }))
    },
    sign(message) { return message },
    verify(message) { return message },
  }
  const controller = new AbortController()
  const transport = await createDesktopWebRtcTransport({
    peerId: 'desktop-connected-abort',
    ...identity,
    signaling,
    signal: controller.signal,
    loadModule: async () => ({ PeerConnection: Peer }),
  })
  await transport.open()

  controller.abort(new Error('scripted Desktop abort'))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(transport.state, 'closed')
  assert.ok([...Peer.instance.channels.values()].every(channel => channel.closed))
})
