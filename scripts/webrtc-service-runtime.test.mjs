import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { generateKeyPairSync, scryptSync, sign } from 'node:crypto'

const {
  createWebRtcSignalingSocketOptions,
  parseWebRtcIceServers,
  RemoteAccessService,
} = await importRemoteAccessService()

test('WebRTC ICE settings preserve TURN credentials and reject invalid input', () => {
  assert.deepEqual(parseWebRtcIceServers(JSON.stringify([{
    credential: 'turn-pass',
    urls: 'turn:turn.example.test:3478?transport=udp',
    username: 'turn-user',
  }])), [{
    credential: 'turn-pass',
    urls: 'turn:turn.example.test:3478?transport=udp',
    username: 'turn-user',
  }])
  assert.throws(
    () => parseWebRtcIceServers('[{"urls":"stun:stun.example.test","username":"user","credential":"pass"}]'),
    /TURN/,
  )
})

test('WebRTC local session signaling resolves localhost only for local development', async () => {
  const local = createWebRtcSignalingSocketOptions(
    'ws://session123.localhost:18080/signal',
    'http://session123.localhost:18080',
  )
  assert.equal(typeof local.lookup, 'function')
  const result = await new Promise((resolve, reject) => {
    local.lookup('session123.localhost', {}, (error, address, family) => {
      if (error) reject(error)
      else resolve({ address, family })
    })
  })
  assert.deepEqual(result, { address: '127.0.0.1', family: 4 })
  const remote = createWebRtcSignalingSocketOptions(
    'wss://session123.terminay.com/signal',
    'https://session123.terminay.com',
  )
  assert.equal(remote.lookup, undefined)
})

test('RemoteAccessService creates and rotates WebRTC pairing rooms without a local listener', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-service-test-'))
  const hostWindows = []
  const service = createTestService({ hostWindows, tempDir })

  const first = await service.toggle()
  const firstConfig = hostWindows[0].configs[0]
  assert.equal(first.isRunning, true)
  assert.equal(first.webRtcStatus, 'registering')
  assert.equal(new URL(first.webRtcPairingUrl).pathname, '/v1/')
  assert.equal(firstConfig.appOrigin, new URL(first.webRtcPairingUrl).origin)
  assert.deepEqual(Object.keys(firstConfig).sort(), [
    'appOrigin', 'expiresAt', 'iceServers', 'relayJoinTokenHash', 'roomId',
    'sessionId', 'signalingUrl',
  ])

  service.handleWebRtcHostStatus(hostWindows[0].webContentsId, { type: 'host-registered' })
  assert.equal(service.getStatus().webRtcStatus, 'pairing-ready')
  service.handleWebRtcHostStatus(hostWindows[0].webContentsId, { type: 'client-join' })
  await waitFor(() => hostWindows.length === 2)
  assert.notEqual(hostWindows[1].configs[0].roomId, firstConfig.roomId)
  assert.equal(hostWindows[1].configs[0].sessionId, firstConfig.sessionId)

  await service.toggle()
  assert.equal(service.getStatus().isRunning, false)
  assert.equal(hostWindows.every((hostWindow) => hostWindow.closed), true)
})

test('RemoteAccessService enrolls once and reconnects with only the paired device key', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-device-key-test-'))
  const pin = '123456'
  const service = createTestService({ pairingPinHash: createTestPairingPinHash(pin), tempDir })
  const appOrigin = 'https://session123.remote.example.com'
  const pairingSessionId = 'pairing-session'
  const pairingToken = 'pairing-token'
  service.pairingManager.adoptSession({
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    origin: appOrigin,
    pairingSessionId,
    pairingToken,
  })
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })

  const enrolled = await service.handleWebRtcApiRequest('/api/devices/enroll', {
    deviceName: 'Browser', pairingPin: pin, pairingSessionId, pairingToken, publicKeyPem: publicKey,
  }, appOrigin)
  assert.equal(typeof enrolled.ticket, 'string')
  assert.equal(service.deviceStore.listActive().length, 1)
  await assert.rejects(
    service.handleWebRtcApiRequest('/api/devices/enroll', {
      deviceName: 'Browser', pairingPin: pin, pairingSessionId, pairingToken, publicKeyPem: publicKey,
    }, appOrigin),
    /no longer valid/,
  )

  const challenge = await service.handleWebRtcApiRequest('/api/devices/challenge', {
    deviceId: enrolled.deviceId,
  }, appOrigin)
  const deviceSignature = sign('sha256', Buffer.from(challenge.signingInput), {
    key: privateKey,
    padding: 6,
    saltLength: 32,
  }).toString('base64url')
  const verified = await service.handleWebRtcApiRequest('/api/devices/verify', {
    challengeId: challenge.challenge.challengeId,
    deviceId: enrolled.deviceId,
    deviceSignature,
  }, appOrigin)
  assert.equal(typeof verified.ticket, 'string')
})

test('RemoteAccessService caches one server UI archive for browser clients', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-host-context-test-'))
  await writeFile(join(tempDir, 'server.html'), '<!doctype html><title>Terminay Server UI</title>')
  const service = createTestService({ serverId: 'server-context-proof', tempDir })
  const archive = await service.getWebRtcUiArchive()
  assert.strictEqual(await service.getWebRtcUiArchive(), archive)
  const context = await service.handleWebRtcApiRequest('/api/host-context', {}, 'https://session-proof.remote.example.com')
  assert.equal(context.serverId, 'server-context-proof')
  assert.equal(context.bundleId, archive.bundleId)
  assert.equal(context.hostKind, 'browser')
})

function createTestService({ hostWindows = [], pairingPinHash = 'configured-pin-hash', tempDir, serverId }) {
  return new RemoteAccessService({
    userDataPath: tempDir,
    serverId,
    createWebRtcHostWindow: () => {
      const hostWindow = {
        closed: false,
        close() { this.closed = true },
        closeTerminal() {},
        configs: [],
        sendConfig(config) { this.configs.push(config) },
        sendSignalMessage() {},
        sendTerminalMessage() {},
        webContentsId: hostWindows.length + 1,
      }
      hostWindows.push(hostWindow)
      return hostWindow
    },
    getControllableSession: () => null,
    getRemoteAccessSettings: () => ({
      pairingPinHash,
      pinFailureLimit: 3,
      webRtcHostedDomain: 'remote.example.com',
      webRtcIceServers: '',
    }),
    notifyTerminalRemoteSizeOverride: () => {},
    onStatusChanged: () => {},
    publicDir: tempDir,
    rendererDistDir: tempDir,
  })
}

function createTestPairingPinHash(pin) {
  const salt = 'terminay-test-salt'
  const key = scryptSync(pin, salt, 32).toString('base64url')
  return `scrypt-v1:${salt}:${key}`
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('Timed out waiting for condition.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function importRemoteAccessService() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-remote-service-test-'))
  const outputPath = join(tempDir, 'service.cjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/remote/service.ts', import.meta.url).pathname],
    format: 'cjs',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
