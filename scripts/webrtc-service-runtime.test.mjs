import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { constants, generateKeyPairSync, scryptSync, sign } from 'node:crypto'

const { RemoteAccessService } = await importRemoteAccessService()

test('RemoteAccessService rotates WebRTC QR rooms without closing existing host peers', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-service-test-'))
  const hostWindows = []
  const statuses = []
  let nextWebContentsId = 1

  const service = new RemoteAccessService({
    app: {
      getPath: () => tempDir,
    },
    createWebRtcHostWindow: () => {
      const hostWindow = {
        closed: false,
        configs: [],
        sentSignalMessages: [],
        sentTerminalMessages: [],
        webContentsId: nextWebContentsId,
        close() {
          this.closed = true
        },
        closeTerminal() {},
        sendConfig(config) {
          this.configs.push(config)
        },
        sendSignalMessage(message) {
          this.sentSignalMessages.push(message)
        },
        sendTerminalMessage(channelId, message) {
          this.sentTerminalMessages.push({ channelId, message })
        },
      }
      nextWebContentsId += 1
      hostWindows.push(hostWindow)
      return hostWindow
    },
    getControllableSession: () => null,
    getRemoteAccessSettings: () => ({
      bindAddress: '127.0.0.1',
      origin: 'https://127.0.0.1:9443',
      pairingMode: 'webrtc',
      pairingPinHash: 'configured-pin-hash',
      tlsCertPath: '',
      tlsKeyPath: '',
      webRtcHostedDomain: 'remote.example.com',
      webRtcIceServers: '',
    }),
    notifyTerminalRemoteSizeOverride: () => {},
    onStatusChanged: (status) => statuses.push(status),
    publicDir: tempDir,
    rendererDistDir: tempDir,
    saveGeneratedTlsPaths: () => {},
  })

  await service.rotateWebRtcPairingCode()
  const firstWindow = hostWindows[0]
  const firstConfig = firstWindow.configs[0]

  await service.rotateWebRtcPairingCode()
  const secondWindow = hostWindows[1]
  const secondConfig = secondWindow.configs[0]

  assert.equal(hostWindows.length, 2)
  assert.equal(firstWindow.closed, false)
  assert.equal(secondWindow.closed, false)
  assert.equal(firstConfig.sessionId, secondConfig.sessionId)
  assert.notEqual(firstConfig.roomId, secondConfig.roomId)
  assert.equal(firstConfig.appOrigin, secondConfig.appOrigin)
  assert.equal(new URL(service.getStatus().webRtcPairingUrl).hostname, `${firstConfig.sessionId}.remote.example.com`)
  assert.equal(service.getStatus().webRtcRoomId, secondConfig.roomId)

  service.handleWebRtcHostStatus(firstWindow.webContentsId, { type: 'host-registered' })
  assert.equal(service.getStatus().webRtcStatus, 'peer-handler-unavailable')

  service.handleWebRtcHostStatus(secondWindow.webContentsId, { type: 'host-registered' })
  assert.equal(service.getStatus().webRtcStatus, 'pairing-ready')
  assert.equal(statuses.at(-1).webRtcRoomId, secondConfig.roomId)
})

test('RemoteAccessService requires the desktop PIN before issuing a WebRTC terminal ticket', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-auth-test-'))
  const pairingPin = '123456'
  const service = createTestService({
    pairingPinHash: createTestPairingPinHash(pairingPin),
    tempDir,
  })
  const appOrigin = 'https://session123.remote.example.com'
  const deviceOrigin = `${appOrigin}#transport=webrtc:${appOrigin}`
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  const device = await service.deviceStore.create({
    name: 'Test browser',
    origin: deviceOrigin,
    publicKeyPem: publicKey,
  })

  await assert.rejects(
    verifyWebRtcAuth({ appOrigin, deviceId: device.id, pairingPin: '', privateKey, service }),
    /Remote PIN was missing or incorrect/,
  )
  await assert.rejects(
    verifyWebRtcAuth({ appOrigin, deviceId: device.id, pairingPin: '000000', privateKey, service }),
    /Remote PIN was missing or incorrect/,
  )

  const verified = await verifyWebRtcAuth({
    appOrigin,
    deviceId: device.id,
    pairingPin,
    privateKey,
    service,
  })
  assert.equal(typeof verified.ticket, 'string')
  assert.ok(verified.ticket.length > 0)
})

function createTestService({ pairingPinHash, tempDir }) {
  return new RemoteAccessService({
    app: {
      getPath: () => tempDir,
    },
    createWebRtcHostWindow: () => ({
      close() {},
      closeTerminal() {},
      sendConfig() {},
      sendSignalMessage() {},
      sendTerminalMessage() {},
      webContentsId: 1,
    }),
    getControllableSession: () => null,
    getRemoteAccessSettings: () => ({
      bindAddress: '127.0.0.1',
      origin: 'https://127.0.0.1:9443',
      pairingMode: 'webrtc',
      pairingPinHash,
      reconnectGrantLifetime: '24h',
      tlsCertPath: '',
      tlsKeyPath: '',
      webRtcHostedDomain: 'remote.example.com',
      webRtcIceServers: '',
    }),
    notifyTerminalRemoteSizeOverride: () => {},
    onStatusChanged: () => {},
    publicDir: tempDir,
    rendererDistDir: tempDir,
    saveGeneratedTlsPaths: () => {},
  })
}

async function verifyWebRtcAuth({ appOrigin, deviceId, pairingPin, privateKey, service }) {
  const options = await service.handleWebRtcApiRequest('/api/auth/options', { deviceId }, appOrigin)
  const deviceSignature = sign('sha256', Buffer.from(options.signingInput), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString('base64url')

  return service.handleWebRtcApiRequest('/api/auth/verify', {
    challengeId: options.deviceChallenge.challengeId,
    deviceId,
    deviceSignature,
    pairingPin,
  }, appOrigin)
}

function createTestPairingPinHash(pin) {
  const salt = 'terminay-test-salt'
  const key = scryptSync(pin, salt, 32).toString('base64url')
  return `scrypt-v1:${salt}:${key}`
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
