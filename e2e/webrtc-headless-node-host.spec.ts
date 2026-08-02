import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { createPairingPinHash } from '../electron/remote/pin'
import { RemoteAccessService } from '../electron/remote/service'
import { runHost, type HostApi, type HostConfig } from '../scripts/support/webRtcHostRuntime'
import { startHostedServer } from './support/hosted-server'

const runtimeName = process.env.TERMINAY_WEBRTC_SPIKE_RUNTIME ?? 'node-datachannel'
const dependencyRoot =
  process.env.TERMINAY_WEBRTC_SPIKE_ROOT ??
  process.env.TERMINAY_NODE_DATACHANNEL_SPIKE_ROOT
const stagedWeriftRuntimeRoot = process.env.TERMINAY_WEBRTC_STAGED_RUNTIME_ROOT
const hostedProofScope = process.env.TERMINAY_HOSTED_PROOF_SCOPE ?? 'full'
test.skip(!dependencyRoot, 'requires an isolated headless WebRTC proof runtime')
test.skip(
  runtimeName !== 'node-datachannel' && runtimeName !== 'werift',
  'requires a supported headless WebRTC proof runtime',
)
if (hostedProofScope !== 'bootstrap' && hostedProofScope !== 'full') {
  throw new Error('TERMINAY_HOSTED_PROOF_SCOPE must be bootstrap or full.')
}
const hostedProofDescription = hostedProofScope === 'bootstrap'
  ? 'installs the server UI through authenticated hosted signaling'
  : 'pairs, reconnects, and revokes'

const requireFromSpike = dependencyRoot
  ? createRequire(path.join(dependencyRoot, 'package.json'))
  : null
const nodeDataChannel = runtimeName === 'node-datachannel'
  ? requireFromSpike?.('node-datachannel') as {
  cleanup(): void
  getLibraryVersion(): string
} | null
  : null
const nodeDataChannelPolyfill = runtimeName === 'node-datachannel'
  ? requireFromSpike?.('node-datachannel/polyfill')
  : null
const weriftRuntime = runtimeName === 'werift' && dependencyRoot
  ? await import(pathToFileURL(path.join(
    stagedWeriftRuntimeRoot ?? path.join(
      dependencyRoot,
      'node_modules',
      '@terminay',
      'werift-runtime-proof',
    ),
    'lib',
    'index.mjs',
  )).href)
  : null
const { RTCPeerConnection: HeadlessPeerConnection } = (
  nodeDataChannelPolyfill ?? weriftRuntime ?? {}
) as {
  RTCPeerConnection?: new (configuration: RTCConfiguration) => RTCPeerConnection
}

function createHeadlessPeerConnection(configuration: RTCConfiguration): RTCPeerConnection {
  if (!HeadlessPeerConnection) {
    throw new Error(`The isolated ${runtimeName} runtime is unavailable.`)
  }
  const peer = new HeadlessPeerConnection(
    runtimeName === 'werift'
      ? {
          ...configuration,
          // The production proof runs both peers on this machine. Make that
          // deterministic instead of relying on Werift to infer a routable
          // interface candidate from the host environment.
          iceAdditionalHostAddresses: ['127.0.0.1'],
          iceUseIpv4: true,
          iceUseIpv6: false,
          maxMessageSize: 1024 * 1024,
        } as RTCConfiguration
      : configuration,
  )
  if (runtimeName !== 'werift') return peer

  // Werift emits gathered candidates while setLocalDescription is still
  // producing the offer. The browser cannot apply trickled candidates until
  // that signed offer is installed, so the adapter releases them only after
  // the authenticated answer reaches the host.
  const adaptedPeer = peer as RTCPeerConnection & {
    addEventListener: RTCPeerConnection['addEventListener']
    setRemoteDescription: RTCPeerConnection['setRemoteDescription']
  }
  const addEventListener = peer.addEventListener.bind(peer)
  const setRemoteDescription = peer.setRemoteDescription.bind(peer)
  const queuedIceEvents: Array<() => void> = []
  let remoteDescriptionInstalled = false
  adaptedPeer.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    if (type !== 'icecandidate') {
      addEventListener(type as keyof RTCPeerConnectionEventMap, listener as EventListener, options as never)
      return
    }
    addEventListener('icecandidate', ((event: Event) => {
      const iceEvent = event as unknown as RTCPeerConnectionIceEvent
      const candidateJson = iceEvent.candidate
        ? JSON.parse(JSON.stringify(iceEvent.candidate.toJSON())) as RTCIceCandidateInit
        : null
      const normalizedEvent = {
        candidate: candidateJson
          ? { toJSON: () => candidateJson }
          : null,
        type: 'icecandidate',
      } as unknown as Event
      const deliver = () => {
        if (typeof listener === 'function') listener(normalizedEvent)
        else listener.handleEvent(normalizedEvent)
      }
      if (!remoteDescriptionInstalled) {
        queuedIceEvents.push(deliver)
        return
      }
      deliver()
    }) as EventListener, options as never)
  }) as RTCPeerConnection['addEventListener']
  adaptedPeer.setRemoteDescription = (async (description: RTCSessionDescriptionInit) => {
    await setRemoteDescription(description)
    remoteDescriptionInstalled = true
    for (const deliver of queuedIceEvents.splice(0)) deliver()
  }) as RTCPeerConnection['setRemoteDescription']
  return adaptedPeer
}

type HostEvidence = {
  clientSignals: Array<Record<string, unknown>>
  hostSignals: Array<Record<string, unknown>>
  statusMessages: Array<{ detail?: string; type: string }>
}

type HeadlessHostWindow = {
  close(): void
  closeTerminal(channelId: string, reason?: string): void
  evidence: HostEvidence
  sendConfig(config: HostConfig): void
  sendSignalMessage(message: unknown): void
  sendTerminalMessage(channelId: string, message: string): void
  webContentsId: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function waitFor<T>(
  read: () => T | null | undefined,
  timeoutMs = 30_000,
  phase = 'headless WebRTC condition',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const poll = () => {
      const value = read()
      if (value !== null && value !== undefined) {
        resolve(value)
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${phase}.`))
        return
      }
      setTimeout(poll, 20)
    }
    poll()
  })
}

test(`Chromium ${hostedProofDescription} through a plain-Node ${runtimeName} host`, async ({
  browser,
}) => {
  test.setTimeout(240_000)
  if (!HeadlessPeerConnection || (runtimeName === 'node-datachannel' && !nodeDataChannel)) {
    throw new Error(`The isolated ${runtimeName} runtime is unavailable.`)
  }

  const hostedServer = await startHostedServer()
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-headless-production-webrtc-'))
  const hostWindows: HeadlessHostWindow[] = []
  const statuses: ReturnType<RemoteAccessService['getStatus']>[] = []
  const terminalWrites: string[] = []
  let nextHostId = 1
  let service: RemoteAccessService

  const createHostWindow = (): HeadlessHostWindow => {
    const webContentsId = nextHostId
    nextHostId += 1
    const evidence: HostEvidence = {
      clientSignals: [],
      hostSignals: [],
      statusMessages: [],
    }
    const signalListeners = new Set<(message: unknown) => void>()
    const terminalCloseListeners = new Set<(message: { channelId: string; reason?: string }) => void>()
    const terminalMessageListeners = new Set<(message: { channelId: string; message: string }) => void>()
    let cleanupHost: (() => void) | null = null
    let closed = false

    const api: HostApi = {
      attachTerminal: (channelId, ticket) => service.attachWebRtcTerminal(webContentsId, channelId, ticket),
      closeTerminal: (channelId, reason) => service.closeWebRtcTerminal(channelId, reason),
      getAsset: (assetPath) => service.getWebRtcAsset(assetPath),
      getAssetManifest: () => service.getWebRtcAssetManifest(),
      getConfig: async () => service.getWebRtcHostConfig(webContentsId),
      handleApiRequest: (pathname, body, appOrigin) =>
        service.handleWebRtcApiRequest(pathname, body, appOrigin),
      handleTerminalMessage: (channelId, message) =>
        service.handleWebRtcTerminalMessage(channelId, message),
      onConfig: () => () => {},
      onSignalMessage(listener) {
        signalListeners.add(listener)
        return () => signalListeners.delete(listener)
      },
      onTerminalCloseRequest(listener) {
        terminalCloseListeners.add(listener)
        return () => terminalCloseListeners.delete(listener)
      },
      onTerminalMessage(listener) {
        terminalMessageListeners.add(listener)
        return () => terminalMessageListeners.delete(listener)
      },
      openSignal: () => service.handleWebRtcHostSignalReady(webContentsId),
      sendSignalMessage(message) {
        const record = asRecord(message)
        if (record) evidence.hostSignals.push(record)
        service.handleWebRtcHostSignalMessage(webContentsId, message)
      },
      updateStatus(message) {
        evidence.statusMessages.push(message)
        service.handleWebRtcHostStatus(webContentsId, message)
      },
    }

    const hostWindow: HeadlessHostWindow = {
      close() {
        if (closed) return
        closed = true
        cleanupHost?.()
        cleanupHost = null
      },
      closeTerminal(channelId, reason) {
        for (const listener of terminalCloseListeners) listener({ channelId, reason })
      },
      evidence,
      sendConfig(config) {
        void runHost(config, {
          api,
          createPeerConnection: createHeadlessPeerConnection,
        }).then((cleanup) => {
          if (closed) {
            cleanup()
          } else {
            cleanupHost = cleanup
          }
        }).catch((error) => {
          api.updateStatus?.({
            detail: error instanceof Error ? error.message : 'Plain-Node host failed.',
            type: 'error',
          })
        })
      },
      sendSignalMessage(message) {
        const record = asRecord(message)
        if (record) evidence.clientSignals.push(record)
        for (const listener of signalListeners) listener(message)
      },
      sendTerminalMessage(channelId, message) {
        for (const listener of terminalMessageListeners) listener({ channelId, message })
      },
      webContentsId,
    }
    hostWindows.push(hostWindow)
    return hostWindow
  }

  service = new RemoteAccessService({
    userDataPath: userDataDir,
    createWebRtcHostWindow: createHostWindow,
    getControllableSession: () => ({
      close() {},
      resize() {},
      write(data) {
        terminalWrites.push(data)
        service.appendSessionData('terminal-1', data)
      },
    }),
    getRemoteAccessSettings: () => ({
      bindAddress: '127.0.0.1',
      origin: 'https://127.0.0.1:9443',
      pairingMode: 'webrtc',
      pairingPinHash: createPairingPinHash('123456'),
      pinFailureLimit: 3,
      reconnectGrantLifetime: '24h',
      tlsCertPath: '',
      tlsKeyPath: '',
      webRtcHostedDomain: hostedServer.hostedDomain,
      webRtcIceServers: '',
    }),
    notifyTerminalRemoteSizeOverride: () => {},
    onStatusChanged: (status) => statuses.push(status),
    publicDir: path.resolve('public'),
    rendererDistDir: path.resolve('dist'),
    saveGeneratedTlsPaths: () => {},
  })
  service.ensureSession('terminal-1')
  service.updateSessionMetadata('terminal-1', { title: 'Headless production proof' })
  service.appendSessionData('terminal-1', 'headless-host-ready\r\n')

  const context = await browser.newContext()
  await context.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket
    const signalLog: Array<{ data: unknown; direction: string }> = []
    Object.defineProperty(window, '__terminayHeadlessSignalLog', {
      configurable: false,
      value: signalLog,
    })
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        this.addEventListener('message', (event) => {
          let data: unknown = event.data
          try {
            data = JSON.parse(String(event.data))
          } catch {
            // Preserve the non-JSON diagnostic.
          }
          signalLog.push({ data, direction: 'in' })
        })
      }

      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        let parsed: unknown = typeof data === 'string' ? data : '[binary]'
        try {
          parsed = JSON.parse(String(data))
        } catch {
          // Preserve the non-JSON diagnostic.
        }
        signalLog.push({ data: parsed, direction: 'out' })
        super.send(data)
      }
    }
  })
  try {
    const started = await service.toggle()
    expect(started.isRunning).toBe(true)
    const pairingUrl = await waitFor(() => {
      const status = service.getStatus()
      return status.webRtcStatus === 'pairing-ready' ? status.webRtcPairingUrl : null
    }, 30_000, 'the WebRTC pairing URL').catch((error) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} ` +
        `statuses=${JSON.stringify(statuses.map((status) => ({
          message: status.webRtcStatusMessage,
          state: status.webRtcStatus,
        })))} hosts=${JSON.stringify(hostWindows.map((host) => ({
          client: host.evidence.clientSignals.map((message) => message.type),
          host: host.evidence.hostSignals.map((message) => message.type),
          status: host.evidence.statusMessages,
        })))}`,
      )
    })
    const sessionOrigin = new URL(pairingUrl).origin
    const sessionId = new URL(pairingUrl).hostname.replace(/\.localhost$/, '')

    const page = await context.newPage()
    await page.goto(pairingUrl, { waitUntil: 'domcontentloaded' })
    // This must be the browser's native WebRTC implementation.  A stubbed
    // constructor would make the headless runtime proof look interoperable
    // without exercising Chromium's SDP/data-channel implementation.
    const browserWebRtc = await page.evaluate(() => ({
      constructorSource: Function.prototype.toString.call(window.RTCPeerConnection),
      hasDataChannel: typeof window.RTCPeerConnection?.prototype.createDataChannel === 'function',
      hasSetRemoteDescription: typeof window.RTCPeerConnection?.prototype.setRemoteDescription === 'function',
    }))
    expect(browserWebRtc.constructorSource).toMatch(/\[native code\]/)
    expect(browserWebRtc.hasDataChannel).toBe(true)
    expect(browserWebRtc.hasSetRemoteDescription).toBe(true)
    if (hostedProofScope === 'bootstrap') {
      const enrollmentDialog = page.getByRole('dialog', { name: 'Enroll browser device' })
      await expect(enrollmentDialog).toBeVisible({ timeout: 45_000 })
      const installedUrl = new URL(page.url())
      expect(installedUrl.origin).toBe(sessionOrigin)
      expect(installedUrl.searchParams.get('transport')).toBe('webrtc')
      expect(installedUrl.searchParams.get('sessionId')).toBe(sessionId)
      expect(installedUrl.hash).toBe('')

      const firstRuntime = await waitFor(() => hostWindows.find((host) =>
        host.evidence.hostSignals.some((message) => message.type === 'offer') &&
        host.evidence.clientSignals.some((message) => message.type === 'answer')),
      30_000,
      'the authenticated hosted offer and answer',
      )
      for (const signal of [
        firstRuntime.evidence.hostSignals.find((message) => message.type === 'offer'),
        firstRuntime.evidence.clientSignals.find((message) => message.type === 'answer'),
      ]) {
        expect(signal?.nonce).toEqual(expect.any(String))
        expect(signal?.signature).toEqual(expect.any(String))
      }
      return
    }
    const connectDialog = page.getByRole('dialog', { name: 'Connect to Remote Server' })
    await expect(connectDialog).toBeVisible({ timeout: 45_000 })
    const handedOffPairingUrl = new URL(
      await connectDialog.getByRole('textbox', { name: 'Pairing URL' }).inputValue(),
    )
    expect(handedOffPairingUrl.origin).toBe(sessionOrigin)
    expect(handedOffPairingUrl.searchParams.get('transport')).toBe('webrtc')
    expect(handedOffPairingUrl.searchParams.get('sessionId')).toBe(sessionId)
    expect(new URLSearchParams(handedOffPairingUrl.hash.slice(1)).get('pairingToken')).toEqual(
      expect.any(String),
    )
    await connectDialog.getByRole('button', { name: 'Connect', exact: true }).click()
    try {
      await expect(page.getByLabel('Pairing PIN')).toBeVisible({ timeout: 45_000 })
    } catch (error) {
      const browserEvidence = await page.evaluate(() => ({
        signalLog: (window as Window & {
          __terminayHeadlessSignalLog?: unknown
        }).__terminayHeadlessSignalLog,
        status: document.querySelector('#status')?.textContent ?? '',
      }))
      const hostEvidence = hostWindows.map((host) => ({
        clientSignals: host.evidence.clientSignals.map((message) => message.type),
        hostSignals: host.evidence.hostSignals.map((message) => message.type),
        statusMessages: host.evidence.statusMessages,
      }))
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n` +
        `browser=${JSON.stringify(browserEvidence)}\nhost=${JSON.stringify(hostEvidence)}`,
      )
    }
    await page.getByLabel('Pairing PIN').fill('123456')
    await page.getByRole('button', { name: 'Pair and connect' }).click()
    await expect(page.locator('.app-container')).toBeVisible({ timeout: 60_000 }).catch(async (error) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} ` +
        `page=${JSON.stringify(await page.locator('body').innerText().catch(() => ''))}`,
      )
    })
    await expect(page.locator('.xterm-rows')).toContainText('headless-host-ready', { timeout: 30_000 })
    await expect.poll(() => service.getStatus().activeConnectionCount).toBe(1)

    const firstDevice = service.getStatus().pairedDevices[0]
    expect(firstDevice?.reconnectGrantStatus).toBe('valid')
    const stored = await page.evaluate((origin) => new Promise<{
      deviceId: string
      grantSessionId: string
      handleSessionId: string
      hasPrivateKey: boolean
      hasSignalingKey: boolean
      origin: string
    }>((resolve, reject) => {
      const storageOrigin = `${origin}#transport=webrtc:${origin}`
      const request = indexedDB.open('terminay-remote', 2)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(
          ['pairings', 'reconnectGrants', 'reconnectHandles'],
          'readonly',
        )
        const pairing = transaction.objectStore('pairings').get(storageOrigin)
        const grant = transaction.objectStore('reconnectGrants').get(storageOrigin)
        const handle = transaction.objectStore('reconnectHandles').get(storageOrigin)
        transaction.oncomplete = () => {
          resolve({
            deviceId: pairing.result.deviceId,
            grantSessionId: grant.result.sessionId,
            handleSessionId: handle.result.sessionId,
            hasPrivateKey: Boolean(pairing.result.privateKey),
            hasSignalingKey: Boolean(grant.result.signalingKey),
            origin: pairing.result.origin,
          })
          database.close()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    }), sessionOrigin)
    expect(stored.origin).toBe(`${sessionOrigin}#transport=webrtc:${sessionOrigin}`)
    expect(stored.grantSessionId).toBe(sessionId)
    expect(stored.handleSessionId).toBe(sessionId)
    expect(stored.hasPrivateKey).toBe(true)
    expect(stored.hasSignalingKey).toBe(true)

    await expect(
      service.handleWebRtcApiRequest('/api/auth/options', {
        deviceId: stored.deviceId,
      }, 'http://different-origin.localhost'),
    ).rejects.toThrow(/different origin/)

    await page.locator('.terminal-area').click()
    const terminalInput = `${runtimeName}-terminal-input`
    await page.keyboard.type(terminalInput)
    await expect.poll(() => terminalWrites.join('')).toContain(terminalInput)

    const firstRuntime = hostWindows.find((host) =>
      host.evidence.hostSignals.some((message) => message.type === 'offer'))
    expect(firstRuntime).toBeTruthy()
    const signedOffer = firstRuntime?.evidence.hostSignals.find((message) => message.type === 'offer')
    const signedAnswer = firstRuntime?.evidence.clientSignals.find((message) => message.type === 'answer')
    const signedIce = [
      ...(firstRuntime?.evidence.hostSignals ?? []),
      ...(firstRuntime?.evidence.clientSignals ?? []),
    ].find((message) => message.type === 'ice')
    for (const signal of [signedOffer, signedAnswer, signedIce]) {
      expect(signal?.nonce).toEqual(expect.any(String))
      expect(signal?.signature).toEqual(expect.any(String))
    }

    await page.close()
    await expect.poll(() => service.getStatus().activeConnectionCount).toBe(0)

    const reconnectPage = await context.newPage()
    await reconnectPage.goto(`${sessionOrigin}/v1/`, { waitUntil: 'domcontentloaded' })
    await expect(reconnectPage.locator('.app-container')).toBeVisible({ timeout: 60_000 })
    await expect(reconnectPage.getByLabel('Pairing PIN')).toHaveCount(0)
    await expect.poll(() => service.getStatus().activeConnectionCount).toBe(1)

    const reconnectRuntime = await waitFor(() => hostWindows.find((host) =>
      host.evidence.hostSignals.some((message) => message.type === 'reconnect-offer')),
    30_000,
    'the signed reconnect offer',
    ).catch(
      async (error) => {
        const browserStatus = await reconnectPage.locator('#status').textContent().catch(() => null)
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ` +
          `status=${JSON.stringify(browserStatus)} hosts=${JSON.stringify(hostWindows.map((host) => ({
            client: host.evidence.clientSignals.map((message) => message.type),
            host: host.evidence.hostSignals.map((message) => message.type),
            status: host.evidence.statusMessages,
          })))}`,
        )
      },
    )
    const reconnectOffer = reconnectRuntime.evidence.hostSignals.find(
      (message) => message.type === 'reconnect-offer',
    )
    const reconnectAnswer = reconnectRuntime.evidence.clientSignals.find(
      (message) => message.type === 'reconnect-answer',
    )
    expect(reconnectOffer).toMatchObject({
      attemptId: expect.any(String),
      nonce: expect.any(String),
      protocolVersion: 'v1',
      reconnectHandle: expect.any(String),
      sessionId,
      signature: expect.any(String),
    })
    expect(reconnectAnswer).toMatchObject({
      attemptId: reconnectOffer?.attemptId,
      nonce: expect.any(String),
      protocolVersion: 'v1',
      reconnectHandle: reconnectOffer?.reconnectHandle,
      sessionId,
      signature: expect.any(String),
    })
    const reconnectSignalLog = await reconnectPage.evaluate(() =>
      (window as Window & {
        __terminayHeadlessSignalLog?: Array<{ data?: Record<string, unknown>; direction: string }>
      }).__terminayHeadlessSignalLog ?? [])
    const reconnectMessages = reconnectSignalLog
      .map((entry) => entry.data)
      .filter((message): message is Record<string, unknown> => Boolean(message))
    expect(reconnectMessages.some((message) =>
      message.type === 'reconnect-proof' &&
      typeof message.proof === 'string' &&
      typeof message.deviceProof === 'string')).toBe(true)
    expect(reconnectMessages.some((message) =>
      message.type === 'reconnect-signal-auth' &&
      typeof message.salt === 'string' &&
      typeof message.keyId === 'string')).toBe(true)
    expect(reconnectMessages.some((message) => 'signalingAuthToken' in message)).toBe(false)

    await service.revokeDevice(stored.deviceId)
    await expect.poll(() => service.getStatus().activeConnectionCount).toBe(0)
    await expect(
      service.handleWebRtcApiRequest('/api/auth/options', {
        deviceId: stored.deviceId,
      }, sessionOrigin),
    ).rejects.toThrow(/not paired/)

    await reconnectPage.close()
    const rejectedReconnectPage = await context.newPage()
    await rejectedReconnectPage.goto(`${sessionOrigin}/v1/`, { waitUntil: 'domcontentloaded' })
    await expect(rejectedReconnectPage.locator('.app-container')).toHaveCount(0, { timeout: 20_000 })
    await expect(rejectedReconnectPage.locator('#status')).toContainText(
      /offline|revoked|no longer|not available/i,
      { timeout: 30_000 },
    )

    expect(statuses.some((status) => status.pairedDeviceCount === 1)).toBe(true)
    expect(service.getStatus().pairedDeviceCount).toBe(0)
  } finally {
    await context.close().catch(() => undefined)
    if (service.getStatus().isRunning) {
      await service.toggle().catch(() => undefined)
    }
    for (const hostWindow of hostWindows) hostWindow.close()
    nodeDataChannel?.cleanup()
    await hostedServer.stop()
    await rm(userDataDir, { force: true, recursive: true })
  }
})
