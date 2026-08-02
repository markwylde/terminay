import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, connect } from 'node:net'
import { build } from 'esbuild'
import { WebSocketServer } from 'ws'
import {
  constants,
  createHmac,
  generateKeyPairSync,
  hkdfSync,
  scryptSync,
  sign,
} from 'node:crypto'

const {
  createReconnectLeaseTiming,
  parseWebRtcIceServers,
  RemoteAccessService,
} = await importRemoteAccessService()

async function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for condition.')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('WebRTC ICE settings preserve structured TURN credentials with strict redacted validation', () => {
  const credential = 'temporary-turn-credential-do-not-echo'
  assert.deepEqual(parseWebRtcIceServers(JSON.stringify([
    { urls: 'stun:stun.example.test:3478' },
    {
      credential,
      urls: [
        'turn:turn.example.test:3478?transport=udp',
        'turns:turn.example.test:5349?transport=tcp',
      ],
      username: 'temporary-user',
    },
  ])), [
    { urls: 'stun:stun.example.test:3478' },
    {
      credential,
      urls: [
        'turn:turn.example.test:3478?transport=udp',
        'turns:turn.example.test:5349?transport=tcp',
      ],
      username: 'temporary-user',
    },
  ])
  assert.deepEqual(parseWebRtcIceServers(
    'stun:one.example.test:3478, turn:two.example.test:3478',
  ), [
    { urls: 'stun:one.example.test:3478' },
    { urls: 'turn:two.example.test:3478' },
  ])

  const invalidInputs = [
    '[{"urls":"turn:turn.example.test:3478","username":"user"}]',
    '[{"urls":"stun:stun.example.test:3478","username":"user","credential":"secret"}]',
    '[{"urls":"turn:user:secret@turn.example.test:3478"}]',
    '[{"urls":"https://turn.example.test"}]',
    '[{"urls":"turn:turn.example.test:3478","username":"user","credential":"secret","extra":true}]',
    '[',
  ]
  for (const input of invalidInputs) {
    assert.throws(
      () => parseWebRtcIceServers(input),
      (error) => error instanceof Error &&
        /WebRTC|TURN/.test(error.message) &&
        !error.message.includes('secret') &&
        !error.message.includes(credential),
    )
  }
})

test('reconnect availability refreshes well inside each authenticated lease', () => {
  let now = Date.parse('2030-01-01T00:00:00.000Z')
  for (const random of [0, 0.5, 1, 0.25, 0.75]) {
    const lease = createReconnectLeaseTiming(now, random)
    const expiresAt = Date.parse(lease.expiresAt)
    assert.equal(lease.refreshDelayMs >= 45_000, true)
    assert.equal(lease.refreshDelayMs <= 75_000, true)
    assert.equal(expiresAt - now, 5 * 60 * 1000)
    assert.equal(now + lease.refreshDelayMs < expiresAt, true)
    now += lease.refreshDelayMs
  }
  assert.equal(now >= Date.parse('2030-01-01T00:05:00.000Z'), true)
})

test('RemoteAccessService waits for hosted reconnect availability registration before returning', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-reconnect-availability-test-'))
  const port = await getUnusedPort()
  const server = new WebSocketServer({ host: '127.0.0.1', port })
  await new Promise((resolve) => server.once('listening', resolve))
  const received = []
  let releaseRegistration
  const registrationGate = new Promise((resolve) => { releaseRegistration = resolve })

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      received.push(message)
      if (message.type !== 'reconnect-host-ready') return
      void registrationGate.then(() => {
        socket.send(JSON.stringify({
          sessionIds: message.sessionIds,
          type: 'reconnect-host-registered',
        }))
      })
    })
  })

  try {
    const service = createTestService({ pairingPinHash: '', tempDir })
    await service.reconnectGrantStore.load()
    await service.reconnectGrantStore.issueGrant({
      deviceId: 'device-1',
      label: 'Test device',
      lifetime: '24h',
      origin: `http://127.0.0.1:${port}#transport=webrtc:http://127.0.0.1:${port}`,
      sessionId: 'session123',
    })

    const sync = service.syncWebRtcReconnectAvailability()
    await waitFor(() => received.some((message) => message.type === 'reconnect-host-ready'))
    const runtimeBeforeAck = service.webRtcReconnectAvailabilityBySessionId.get('session123')
    assert.equal(runtimeBeforeAck?.registered, false)

    releaseRegistration()
    await sync

    const runtimeAfterAck = service.webRtcReconnectAvailabilityBySessionId.get('session123')
    assert.equal(runtimeAfterAck?.registered, true)
  } finally {
    for (const client of server.clients) client.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('RemoteAccessService distinguishes registering, ready, relay-loss, and premature-close states', async () => {
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
        destroy() {
          this.destroyedListener?.()
        },
        onDestroyed(listener) {
          this.destroyedListener = listener
          return () => {
            if (this.destroyedListener === listener) this.destroyedListener = undefined
          }
        },
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
      webRtcIceServers: JSON.stringify([{
        credential: 'turn-pass',
        urls: 'turn:turn.example.test:3478?transport=udp',
        username: 'turn-user',
      }]),
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
  assert.deepEqual(firstConfig.iceServers, [{
    credential: 'turn-pass',
    urls: 'turn:turn.example.test:3478?transport=udp',
    username: 'turn-user',
  }])
  assert.equal(new URL(service.getStatus().webRtcPairingUrl).hostname, `${firstConfig.sessionId}.remote.example.com`)
  assert.equal(service.getStatus().webRtcRoomId, secondConfig.roomId)

  service.handleWebRtcHostStatus(firstWindow.webContentsId, { type: 'host-registered' })
  assert.equal(service.getStatus().webRtcStatus, 'registering')
  assert.equal(
    service.getStatus().webRtcStatusMessage,
    'WebRTC relay room is registering. Keep Terminay open while the browser connects.',
  )

  service.handleWebRtcHostStatus(secondWindow.webContentsId, { type: 'host-registered' })
  assert.equal(service.getStatus().webRtcStatus, 'pairing-ready')
  assert.equal(
    service.getStatus().webRtcStatusMessage,
    'WebRTC relay room is ready. Scan the QR code to connect another browser.',
  )
  assert.equal(statuses.at(-1).webRtcRoomId, secondConfig.roomId)

  service.handleWebRtcHostStatus(secondWindow.webContentsId, { type: 'closed' })
  assert.equal(service.getStatus().webRtcStatus, 'error')
  assert.equal(
    service.getStatus().webRtcStatusMessage,
    'The WebRTC signaling connection was lost after this Terminay host became ready. Retry to advertise a fresh pairing room.',
  )

  await service.rotateWebRtcPairingCode()
  const thirdWindow = hostWindows[2]
  assert.equal(service.getStatus().webRtcStatus, 'registering')
  service.handleWebRtcHostStatus(thirdWindow.webContentsId, { type: 'closed' })
  assert.equal(service.getStatus().webRtcStatus, 'error')
  assert.equal(
    service.getStatus().webRtcStatusMessage,
    'The WebRTC signaling connection closed before this Terminay host became ready. Retry or check Remote Access settings.',
  )

  await service.rotateWebRtcPairingCode()
  const fourthWindow = hostWindows[3]
  service.handleWebRtcHostStatus(secondWindow.webContentsId, {
    detail: 'Relay registration rejected.',
    type: 'error',
  })
  assert.equal(service.getStatus().webRtcStatus, 'registering')
  service.handleWebRtcHostStatus(fourthWindow.webContentsId, {
    detail: 'Relay registration rejected.',
    type: 'error',
  })
  assert.equal(service.getStatus().webRtcStatus, 'error')
  assert.equal(service.getStatus().webRtcStatusMessage, 'Relay registration rejected.')

  fourthWindow.destroy()
  fourthWindow.destroy()
  assert.equal(fourthWindow.closed, true)
  assert.equal(service.webRtcHostRuntimesByWebContentsId.has(fourthWindow.webContentsId), false)
  assert.equal(service.webRtcHostConfigByWebContentsId.has(fourthWindow.webContentsId), false)
  assert.equal(service.getStatus().webRtcStatus, 'error')
  assert.equal(
    service.getStatus().webRtcStatusMessage,
    'The WebRTC host renderer closed unexpectedly. Retry to advertise a fresh pairing room.',
  )
})

test('RemoteAccessService keeps the fresh advertised room healthy when pairing peers lose signaling', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-auto-rotate-test-'))
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
    onStatusChanged: () => {},
    publicDir: tempDir,
    rendererDistDir: tempDir,
    saveGeneratedTlsPaths: () => {},
  })

  await service.rotateWebRtcPairingCode()
  const firstWindow = hostWindows[0]
  const firstRoomId = firstWindow.configs[0].roomId
  service.handleWebRtcHostStatus(firstWindow.webContentsId, { type: 'host-registered' })
  service.handleWebRtcHostStatus(firstWindow.webContentsId, { type: 'client-join' })

  await waitFor(() => hostWindows.length === 2)
  const secondWindow = hostWindows[1]
  const secondRoomId = secondWindow.configs[0].roomId
  service.handleWebRtcHostStatus(secondWindow.webContentsId, { type: 'host-registered' })
  service.handleWebRtcHostStatus(secondWindow.webContentsId, { type: 'client-join' })

  await waitFor(() => hostWindows.length === 3)

  const status = service.getStatus()
  assert.equal(firstWindow.closed, false)
  assert.equal(secondWindow.closed, false)
  assert.equal(status.activeConnectionCount, 0)
  assert.equal(status.pendingWebRtcConnectionCount, 2)
  assert.notEqual(status.webRtcRoomId, firstRoomId)
  assert.notEqual(status.webRtcRoomId, secondRoomId)
  assert.equal(service.pairingManager.sessions.has(firstRoomId), true)
  assert.equal(service.pairingManager.sessions.has(secondRoomId), true)
  assert.equal(hostWindows[2].closed, false)

  const activeRoomId = status.webRtcRoomId
  service.handleWebRtcHostStatus(firstWindow.webContentsId, { type: 'closed' })
  assert.equal(service.getStatus().pendingWebRtcConnectionCount, 1)
  assert.equal(service.getStatus().webRtcRoomId, activeRoomId)
  assert.equal(service.getStatus().webRtcStatus, 'registering')
  assert.equal(
    service.getStatus().webRtcStatusMessage,
    'WebRTC relay room is registering. Keep Terminay open while the browser connects.',
  )

  service.handleWebRtcHostStatus(secondWindow.webContentsId, { type: 'closed' })
  assert.equal(service.getStatus().pendingWebRtcConnectionCount, 0)
  assert.equal(service.getStatus().webRtcRoomId, activeRoomId)
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
  assert.equal(status.webRtcStatus, 'registering')
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

test('RemoteAccessService reconnect requires both the grant and its bound device private key', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-webrtc-two-factor-reconnect-'))
  const hostWindows = []
  const service = createTestService({
    hostWindows,
    pairingPinHash: createTestPairingPinHash('123456'),
    tempDir,
  })
  const appOrigin = 'https://session-two-factor.remote.example.com'
  const origin = `${appOrigin}#transport=webrtc:${appOrigin}`
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  const device = await service.deviceStore.create({
    name: 'Two-factor browser',
    origin,
    publicKeyPem: publicKey,
  })
  const issued = await service.reconnectGrantStore.issueGrant({
    deviceId: device.id,
    origin,
    sessionId: 'session-two-factor',
  })
  const sent = []
  const socket = {
    readyState: 1,
    send(raw) {
      sent.push(JSON.parse(raw))
    },
  }
  const config = {
    appOrigin,
    expiresAt: '',
    iceServers: [],
    relayJoinTokenHash: '',
    reconnectRegistrationToken: 'registration-token',
    roomId: 'session-two-factor',
    sessionId: 'session-two-factor',
    signalingAuthToken: '',
    signalingUrl: 'wss://session-two-factor.remote.example.com/signal',
  }
  await service.handleWebRtcReconnectRelayMessage(config, socket, {
    clientNonce: 'two-factor-client',
    reconnectHandle: issued.handle,
    sessionId: issued.sessionId,
    type: 'reconnect-intent',
  })
  const verifier = Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(issued.grant, 'base64url'),
    Buffer.alloc(0),
    'terminay remote v1 reconnect proof verifier',
    32,
  ))
  const createProofMessage = (challenge, clientNonce) => {
    const signingInput = serializeReconnectChallengeForTest(challenge)
    const proof = createHmac('sha256', verifier).update(signingInput).digest('base64url')
    return {
      attemptId: challenge.attemptId,
      clientNonce,
      deviceProof: sign('sha256', Buffer.from(signingInput), {
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      }).toString('base64url'),
      proof,
      protocolVersion: 'v1',
      reconnectHandle: issued.handle,
      sessionId: issued.sessionId,
      type: 'reconnect-proof',
    }
  }
  let proofMessage = createProofMessage(sent.at(-1), 'two-factor-client')

  await assert.rejects(
    service.handleWebRtcReconnectRelayMessage(config, socket, {
      ...proofMessage,
      proof: Buffer.alloc(32, 7).toString('base64url'),
    }),
    /reconnect proof is invalid/,
  )
  await service.handleWebRtcReconnectRelayMessage(config, socket, {
    clientNonce: 'two-factor-client-2',
    reconnectHandle: issued.handle,
    sessionId: issued.sessionId,
    type: 'reconnect-intent',
  })
  proofMessage = createProofMessage(sent.at(-1), 'two-factor-client-2')
  await assert.rejects(
    service.handleWebRtcReconnectRelayMessage(config, socket, {
      ...proofMessage,
      deviceProof: Buffer.alloc(256, 9).toString('base64url'),
    }),
    /device-key proof is invalid/,
  )

  await service.handleWebRtcReconnectRelayMessage(config, socket, {
    clientNonce: 'two-factor-client-3',
    reconnectHandle: issued.handle,
    sessionId: issued.sessionId,
    type: 'reconnect-intent',
  })
  proofMessage = createProofMessage(sent.at(-1), 'two-factor-client-3')
  await service.handleWebRtcReconnectRelayMessage(config, socket, proofMessage)
  assert.deepEqual(sent.slice(-2).map((message) => message.type), [
    'reconnect-accepted',
    'reconnect-signal-auth',
  ])
  assert.equal('signalingAuthToken' in sent.at(-2), false)
  assert.match(sent.at(-1).salt, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(hostWindows.length, 1)
  assert.notEqual(hostWindows[0].configs[0].signalingAuthToken, proofMessage.proof)
  await service.handleWebRtcReconnectRelayMessage(config, socket, {
    attemptId: proofMessage.attemptId,
    protocolVersion: 'v1',
    reconnectHandle: issued.handle,
    sessionId: issued.sessionId,
    type: 'reconnect-complete',
  })
  assert.equal(hostWindows[0].closed, false)
})

function serializeReconnectChallengeForTest(challenge) {
  return `terminay\u0000v1\u0000reconnect-challenge\u0000${JSON.stringify({
    action: challenge.action,
    attemptId: challenge.attemptId,
    clientNonce: challenge.clientNonce,
    expiresAt: challenge.expiresAt,
    handle: challenge.handle,
    issuedAt: challenge.issuedAt,
    nonce: challenge.nonce,
    origin: challenge.origin,
    protocolVersion: challenge.protocolVersion,
    sessionId: challenge.sessionId,
  })}`
}

test('RemoteAccessService removes remote sessions when their PTY exits', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-remote-exit-test-'))
  const service = createTestService({ pairingPinHash: '', tempDir })
  const sentMessages = []
  const socket = {
    close() {},
    getReadyState: () => 1,
    send(message) {
      sentMessages.push(JSON.parse(message))
    },
  }
  const connection = service.connectionStore.register(socket, 'connection-1', 'device-1')

  service.ensureSession('terminal-1')
  connection.attachedSessionIds.add('terminal-1')
  sentMessages.length = 0

  service.markSessionExit('terminal-1', 0)

  assert.deepEqual(sentMessages.map((message) => message.type), ['exit', 'session-closed'])
  assert.equal(sentMessages[0].sessionId, 'terminal-1')
  assert.equal(sentMessages[0].exitCode, 0)
  assert.equal(sentMessages[1].id, 'terminal-1')
  assert.equal(connection.attachedSessionIds.has('terminal-1'), false)
  assert.equal(service.sessions.has('terminal-1'), false)
})

test('RemoteAccessService forwards one authorized remote input payload to the controllable session', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-remote-input-test-'))
  const writes = []
  const service = createTestService({
    getControllableSession: (sessionId) => ({
      close() {},
      resize() {},
      write: (data) => writes.push({ data, sessionId }),
    }),
    pairingPinHash: '',
    tempDir,
  })
  const connection = service.connectionStore.register({
    close() {},
    getReadyState: () => 1,
    send() {},
  }, 'connection-1', 'device-1')
  service.ensureSession('terminal-1')
  connection.attachedSessionIds.add('terminal-1')

  await service.handleClientMessage('connection-1', {
    connectionId: 'connection-1',
    payload: 'remote payload',
    seq: 1,
    sessionId: 'terminal-1',
    type: 'write',
  })

  assert.deepEqual(writes, [{ data: 'remote payload', sessionId: 'terminal-1' }])
})

test('RemoteAccessService serializes accepted remote writes for one connection', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-remote-operation-order-test-'))
  const calls = []
  let releaseFirstWrite
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve })
  const service = createTestService({
    getControllableSession: () => ({
      close() {},
      resize() {},
      async write(data) {
        calls.push(`start:${data}`)
        if (data === 'first') await firstWrite
        calls.push(`finish:${data}`)
      },
    }),
    pairingPinHash: '',
    tempDir,
  })
  const connection = service.connectionStore.register({
    close() {},
    getReadyState: () => 1,
    send() {},
  }, 'connection-1', 'device-1')
  service.ensureSession('terminal-1')
  connection.attachedSessionIds.add('terminal-1')

  const first = service.handleClientMessage('connection-1', {
    connectionId: 'connection-1', payload: 'first', seq: 1, sessionId: 'terminal-1', type: 'write',
  })
  const second = service.handleClientMessage('connection-1', {
    connectionId: 'connection-1', payload: 'second', seq: 2, sessionId: 'terminal-1', type: 'write',
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(calls, ['start:first'])

  releaseFirstWrite()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['start:first', 'finish:first', 'start:second', 'finish:second'])
})

test('RemoteAccessService updates remote resize ownership only after accepted resize', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-remote-resize-acceptance-test-'))
  const overrides = []
  const sent = []
  let rejectResize = true
  const service = createTestService({
    getControllableSession: () => ({
      close() {},
      async resize() {
        if (rejectResize) throw new Error('rejected by authority')
      },
      write() {},
    }),
    pairingPinHash: '',
    tempDir,
  })
  service.notifyTerminalRemoteSizeOverride = (sessionId, override) => overrides.push({ sessionId, override })
  const connection = service.connectionStore.register({
    close() {},
    getReadyState: () => 1,
    send(message) { sent.push(JSON.parse(message)) },
  }, 'connection-1', 'device-1')
  service.ensureSession('terminal-1')
  connection.attachedSessionIds.add('terminal-1')

  await service.handleClientMessage('connection-1', {
    cols: 120, connectionId: 'connection-1', rows: 40, seq: 1, sessionId: 'terminal-1', type: 'resize',
  })
  assert.deepEqual(overrides, [])
  assert.equal(service.remoteSizeOverrideOwners.has('terminal-1'), false)
  assert.equal(service.sessions.get('terminal-1').cols, 80)
  assert.equal(sent.at(-1).message, 'Terminal resize was rejected.')

  rejectResize = false
  await service.handleClientMessage('connection-1', {
    cols: 120, connectionId: 'connection-1', rows: 40, seq: 2, sessionId: 'terminal-1', type: 'resize',
  })
  assert.deepEqual(overrides, [{
    override: { active: true, cols: 120, rows: 40 }, sessionId: 'terminal-1',
  }])
  assert.equal(service.sessions.get('terminal-1').cols, 80)
})

function createTestService({
  getControllableSession = () => null,
  hostWindows,
  pairingPinHash,
  pinFailureLimit = 3,
  tempDir,
}) {
  return new RemoteAccessService({
    userDataPath: tempDir,
    createWebRtcHostWindow: () => {
      const hostWindow = {
        closed: false,
        close() { this.closed = true },
        closeTerminal() {},
        configs: [],
        sendConfig(config) {
          this.configs.push(config)
        },
        sendSignalMessage() {},
        sendTerminalMessage() {},
        webContentsId: (hostWindows?.length ?? 0) + 1,
      }
      hostWindows?.push(hostWindow)
      return hostWindow
    },
    getControllableSession,
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
