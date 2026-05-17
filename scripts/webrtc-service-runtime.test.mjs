import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, connect } from 'node:net'
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
      pinFailureLimit: 3,
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

test('RemoteAccessService does not bind the Local Network server in WebRTC mode', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-no-lan-test-'))
  const port = await getUnusedPort()
  const hostWindows = []
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
      origin: `https://127.0.0.1:${port}`,
      pairingMode: 'webrtc',
      pinFailureLimit: 3,
      pairingPinHash: 'configured-pin-hash',
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

  const status = await service.toggle()

  assert.equal(status.isRunning, true)
  assert.equal(status.pairingMode, 'webrtc')
  assert.equal(status.lanPairingUrl, null)
  assert.equal(status.lanPairingQrCodeDataUrl, null)
  assert.deepEqual(status.availableAddresses, [])
  assert.equal(status.webRtcPairingUrl.startsWith('https://'), true)
  assert.equal(hostWindows.length, 1)
  assert.equal(await canConnect(port), false)

  await service.toggle()
})

test('RemoteAccessService does not create WebRTC pairing state in Local Network mode', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-lan-no-webrtc-test-'))
  const port = await getUnusedPort()
  const hostWindows = []

  const service = new RemoteAccessService({
    app: {
      getPath: () => tempDir,
    },
    createWebRtcHostWindow: () => {
      const hostWindow = {
        close() {},
        closeTerminal() {},
        sendConfig() {},
        sendSignalMessage() {},
        sendTerminalMessage() {},
        webContentsId: 1,
      }
      hostWindows.push(hostWindow)
      return hostWindow
    },
    getControllableSession: () => null,
    getRemoteAccessSettings: () => ({
      bindAddress: '127.0.0.1',
      origin: `https://127.0.0.1:${port}`,
      pairingMode: 'lan',
      pinFailureLimit: 3,
      pairingPinHash: 'configured-pin-hash',
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

  const status = await service.toggle()

  assert.equal(status.isRunning, true)
  assert.equal(status.pairingMode, 'lan')
  assert.equal(typeof status.lanPairingUrl, 'string')
  assert.equal(status.webRtcPairingUrl, null)
  assert.equal(status.webRtcPairingQrCodeDataUrl, null)
  assert.equal(hostWindows.length, 0)
  assert.equal(await canConnect(port), true)

  await service.toggle()
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

test('RemoteAccessService revokes a WebRTC device after repeated wrong PIN attempts', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-pin-revoke-test-'))
  const pairingPin = '123456'
  const service = createTestService({
    pairingPinHash: createTestPairingPinHash(pairingPin),
    pinFailureLimit: 3,
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
    name: 'Wrong PIN browser',
    origin: deviceOrigin,
    publicKeyPem: publicKey,
  })

  await assert.rejects(
    verifyWebRtcAuth({ appOrigin, deviceId: device.id, pairingPin: '000000', privateKey, service }),
    /Remote PIN was missing or incorrect/,
  )
  await assert.rejects(
    verifyWebRtcAuth({ appOrigin, deviceId: device.id, pairingPin: '000000', privateKey, service }),
    /Remote PIN was missing or incorrect/,
  )
  await assert.rejects(
    verifyWebRtcAuth({ appOrigin, deviceId: device.id, pairingPin: '000000', privateKey, service }),
    /Too many incorrect PIN attempts/,
  )

  assert.equal(service.deviceStore.get(device.id), null)
  await assert.rejects(
    verifyWebRtcAuth({ appOrigin, deviceId: device.id, pairingPin, privateKey, service }),
    /This device is not paired with this host/,
  )
})

test('RemoteAccessService refuses WebRTC terminal tickets when no desktop PIN is configured', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-no-pin-test-'))
  const service = createTestService({ pairingPinHash: '', tempDir })
  const appOrigin = 'https://session123.remote.example.com'
  const deviceOrigin = `${appOrigin}#transport=webrtc:${appOrigin}`
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  const device = await service.deviceStore.create({
    name: 'No PIN browser',
    origin: deviceOrigin,
    publicKeyPem: publicKey,
  })

  await assert.rejects(
    verifyWebRtcAuth({ appOrigin, deviceId: device.id, pairingPin: '123456', privateKey, service }),
    /Remote PIN was missing or incorrect/,
  )
})

function createTestService({ pairingPinHash, pinFailureLimit = 3, tempDir }) {
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
      pinFailureLimit,
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

function getUnusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(port)
        }
      })
    })
  })
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
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
