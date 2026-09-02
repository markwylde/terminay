import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const [{ RemoteAccessService }, { runHost }] = await Promise.all([
  importRemoteAccessService(),
  importWebRtcHost(),
])

test('generic hosted-manager fixture installs the real server archive through one binary WebRTC exchange', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-real-archive-proof-'))
  const renderer = join(root, 'renderer')
  await mkdir(join(renderer, 'assets', 'nested'), { recursive: true })
  await writeFile(join(renderer, 'server.html'), '<!doctype html><script type="module" src="./assets/nested/opaque-runtime.js"></script>')
  await writeFile(join(renderer, 'assets', 'nested', 'opaque-runtime.js'), 'globalThis.realArchiveProof = true')
  const service = new RemoteAccessService({
    createWebRtcHostWindow: () => { throw new Error('fixture supplies its own authenticated host bridge') },
    getControllableSession: () => null,
    getRemoteAccessSettings: () => ({
      webRtcHostedDomain: 'localhost', webRtcIceServers: '',
    }),
    notifyTerminalRemoteSizeOverride: () => {}, onStatusChanged: () => {}, publicDir: join(root, 'public'),
    rendererDistDir: renderer, saveGeneratedTlsPaths: () => {}, userDataPath: root,
    serverId: 'archive-proof-server',
  })
  const fixture = new GenericHostedManagerFixture()
  const peer = new FixturePeer(fixture.channel)
  const cleanup = await runHost(hostConfig(), {
    api: {
      attachTerminal: async () => {}, closeTerminal: () => {},
      getUiArchive: () => service.getWebRtcUiArchive(),
      getConfig: async () => null,
      handleApiRequest: async () => ({}), handleTerminalMessage: () => {},
      onConfig: () => () => {}, onSignalMessage: () => () => {}, onTerminalCloseRequest: () => () => {}, onTerminalMessage: () => () => {},
      openSignal: () => {}, sendSignalMessage: () => {},
    },
    createPeerConnection: () => peer,
  })
  try {
    await fixture.install()
    const installed = fixture.installedArchive()
    assert.equal(fixture.requests, 1)
    assert.equal(fixture.sawBase64, false)
    assert.equal(installed.metadata.archiveFormatVersion, 1)
    assert.equal(typeof installed.metadata.bundleId, 'string')
    // The fixture learns the executable entry only from archive metadata; it
    // has no Terminay filename or source-layout allowlist.
    assert.equal(installed.files.get(installed.metadata.entryPath)?.toString('utf8').includes('opaque-runtime.js'), true)
    assert.equal(installed.files.get('assets/nested/opaque-runtime.js')?.toString('utf8'), 'globalThis.realArchiveProof = true')
    assert.equal(fixture.chunkIndexes.every((index, expected) => index === expected), true)
  } finally {
    cleanup()
  }
})

class GenericHostedManagerFixture {
  constructor() {
    this.channel = new FixtureDataChannel('asset', this)
    this.chunkIndexes = []
    this.frames = []
    this.requests = 0
    this.sawBase64 = false
    this.started = null
    this.completed = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject })
  }

  async install() {
    this.requests += 1
    this.channel.dispatchMessage(JSON.stringify({ archiveFormatVersion: 1, id: 'generic-host-install', type: 'asset:get-bundle' }))
    await this.completed
  }

  receive(raw) {
    if (typeof raw === 'string') {
      const message = JSON.parse(raw)
      this.sawBase64 ||= JSON.stringify(message).includes('base64')
      if (message.type === 'asset:bundle-start') {
        this.started = message
      } else if (message.type === 'asset:bundle-complete') {
        this.resolve()
      } else if (message.type === 'asset:bundle-error') {
        this.reject(new Error(`${message.code}: ${message.message}`))
      }
      return
    }
    assert.equal(raw instanceof ArrayBuffer, true)
    const frame = new Uint8Array(raw)
    assert.deepEqual([...frame.subarray(0, 4)], [0x54, 0x42, 0x01, 0x01])
    const index = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(4, false)
    this.chunkIndexes.push(index)
    this.frames.push(Buffer.from(frame.subarray(8)))
    this.channel.dispatchMessage(JSON.stringify({ id: 'generic-host-install', index, type: 'asset:bundle-ack' }))
  }

  installedArchive() {
    assert.ok(this.started)
    const bytes = Buffer.concat(this.frames)
    assert.equal(bytes.byteLength, this.started.compressedBytes)
    const files = readTar(gunzipSync(bytes))
    const metadata = JSON.parse(files.get('terminay-bundle.json').toString('utf8'))
    return { files, metadata }
  }
}

class FixtureDataChannel extends EventTarget {
  constructor(label, fixture) { super(); this.label = label; this.fixture = fixture; this.readyState = 'open' }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')) }
  dispatchMessage(data) { this.dispatchEvent(new MessageEvent('message', { data })) }
  send(raw) { this.fixture.receive(raw) }
}

class FixturePeer extends EventTarget {
  constructor(assetChannel) { super(); this.assetChannel = assetChannel; this.connectionState = 'new'; this.iceConnectionState = 'new' }
  addIceCandidate() { return Promise.resolve() }
  close() { this.connectionState = 'closed' }
  createDataChannel(label) { return label === 'asset' ? this.assetChannel : new FixtureDataChannel(label, { receive() {} }) }
  createOffer() { return Promise.resolve({ sdp: 'v=0\r\n', type: 'offer' }) }
  setLocalDescription() { return Promise.resolve() }
  setRemoteDescription() { return Promise.resolve() }
}

function hostConfig() {
  return {
    appOrigin: 'https://fixture-session.terminay.test', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    iceServers: [], relayJoinTokenHash: 'fixture-relay', roomId: 'fixture-room', sessionId: 'fixture-session',
    signalingUrl: 'wss://fixture-session.terminay.test/signal',
  }
}

function readTar(bytes) {
  const files = new Map(); let offset = 0
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512); offset += 512
    if (header.every((byte) => byte === 0)) break
    const name = tarText(header.subarray(0, 100)); const prefix = tarText(header.subarray(345, 500))
    const size = Number.parseInt(tarText(header.subarray(124, 136)).trim() || '0', 8)
    files.set(prefix ? `${prefix}/${name}` : name, Buffer.from(bytes.subarray(offset, offset + size)))
    offset += Math.ceil(size / 512) * 512
  }
  return files
}
function tarText(bytes) { const end = bytes.indexOf(0); return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString('utf8') }

async function importRemoteAccessService() {
  const root = await mkdtemp(join(tmpdir(), 'terminay-real-archive-service-'))
  const outputPath = join(root, 'service.cjs')
  await build({ bundle: true, entryPoints: [new URL('../electron/remote/service.ts', import.meta.url).pathname], format: 'cjs', outfile: outputPath, platform: 'node', target: 'node24' })
  return import(outputPath)
}
async function importWebRtcHost() {
  const root = await mkdtemp(join(tmpdir(), 'terminay-real-archive-host-'))
  const outputPath = join(root, 'host.mjs')
  await build({ bundle: true, entryPoints: [new URL('./support/webRtcHostRuntime.ts', import.meta.url).pathname], format: 'esm', outfile: outputPath, platform: 'node', target: 'node24' })
  return import(outputPath)
}
