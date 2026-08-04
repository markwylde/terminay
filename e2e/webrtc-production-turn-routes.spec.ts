import { createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Browser } from '@playwright/test'
import { runHost, type HostApi, type HostConfig } from '../scripts/support/webRtcHostRuntime'

const dependencyRoot = process.env.TERMINAY_WEBRTC_SPIKE_ROOT
const turnConfigPath = process.env.TERMINAY_TURN_CONFIG_PATH
const turnPort = Number(process.env.TERMINAY_TURN_PORT)
const turnRouteOnly = process.env.TERMINAY_TURN_ROUTE_ONLY === '1'
test.skip(
  !dependencyRoot,
  'requires the isolated secure-Werift proof wrapper',
)

const weriftRuntime = dependencyRoot
  ? await import(pathToFileURL(path.join(
    dependencyRoot,
    'node_modules',
    '@terminay',
    'werift-runtime-proof',
    'lib',
    'index.mjs',
  )).href)
  : null
const { RTCPeerConnection: WeriftPeerConnection } = (weriftRuntime ?? {}) as {
  RTCPeerConnection?: new (configuration: RTCConfiguration) => RTCPeerConnection
}

type SignalRecord = Record<string, unknown>

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function canonicalSignalPayload(message: SignalRecord): string {
  const payload: SignalRecord = {
    nonce: message.nonce,
    roomId: message.roomId,
    type: message.type,
  }
  if ('candidate' in message) payload.candidate = message.candidate
  if ('sdp' in message) payload.sdp = message.sdp
  return stableJson(payload)
}

function signSignal(token: string, message: SignalRecord): SignalRecord {
  const signed = { ...message, nonce: crypto.randomUUID() }
  return {
    ...signed,
    signature: createHmac('sha256', Buffer.from(token, 'base64url'))
      .update(canonicalSignalPayload(signed))
      .digest('base64url'),
  }
}

function parseTurnSecret(raw: string): string {
  const line = raw.split(/\r?\n/).find((entry) => entry.startsWith('static-auth-secret='))
  if (!line) throw new Error('The isolated coturn config has no REST secret.')
  return line.slice('static-auth-secret='.length)
}

function turnCredentials(
  secret: string,
  expiresAtSeconds: number,
  identity: string,
): Pick<RTCIceServer, 'credential' | 'username'> {
  const username = `${expiresAtSeconds}:${identity}`
  return {
    credential: createHmac('sha1', secret).update(username).digest('base64'),
    username,
  }
}

function createWeriftPeer(configuration: RTCConfiguration): RTCPeerConnection {
  if (!WeriftPeerConnection) throw new Error('The secure Werift runtime is unavailable.')
  const peer = new WeriftPeerConnection({
    ...configuration,
    iceAdditionalHostAddresses: ['127.0.0.1'],
    iceUseIpv4: true,
    iceUseIpv6: false,
    maxMessageSize: 1024 * 1024,
  } as RTCConfiguration)
  const adapted = peer as RTCPeerConnection & {
    addEventListener: RTCPeerConnection['addEventListener']
    setRemoteDescription: RTCPeerConnection['setRemoteDescription']
  }
  const addEventListener = peer.addEventListener.bind(peer)
  const setRemoteDescription = peer.setRemoteDescription.bind(peer)
  const queuedIce: Array<() => void> = []
  let remoteDescriptionInstalled = false
  adapted.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    if (type !== 'icecandidate') {
      addEventListener(type as keyof RTCPeerConnectionEventMap, listener as EventListener, options as never)
      return
    }
    addEventListener('icecandidate', ((event: Event) => {
      const candidate = (event as unknown as RTCPeerConnectionIceEvent).candidate
      const json = candidate
        ? JSON.parse(JSON.stringify(candidate.toJSON())) as RTCIceCandidateInit
        : null
      const deliver = () => {
        const normalized = {
          candidate: json ? { toJSON: () => json } : null,
          type: 'icecandidate',
        } as unknown as Event
        if (typeof listener === 'function') listener(normalized)
        else listener.handleEvent(normalized)
      }
      if (remoteDescriptionInstalled) deliver()
      else queuedIce.push(deliver)
    }) as EventListener, options as never)
  }) as RTCPeerConnection['addEventListener']
  adapted.setRemoteDescription = (async (description: RTCSessionDescriptionInit) => {
    await setRemoteDescription(description)
    remoteDescriptionInstalled = true
    for (const deliver of queuedIce.splice(0)) deliver()
  }) as RTCPeerConnection['setRemoteDescription']
  return adapted
}

async function selectedPair(peer: RTCPeerConnection): Promise<{
  localType: string
  protocol: string
  remoteType: string
} | null> {
  const stats = await peer.getStats()
  const entries = [...stats.values()]
  const transport = entries.find((entry) =>
    entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string')
  const pair = transport
    ? stats.get(transport.selectedCandidatePairId)
    : entries.find((entry) =>
      entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded')
  if (!pair?.nominated || pair.state !== 'succeeded') return null
  const local = stats.get(pair.localCandidateId)
  const remote = stats.get(pair.remoteCandidateId)
  if (!local || !remote) return null
  return {
    localType: local.candidateType,
    protocol: local.protocol,
    remoteType: remote.candidateType,
  }
}

async function exerciseRoute(
  browser: Browser,
  iceServers: RTCIceServer[],
  policy: RTCIceTransportPolicy,
  shouldConnect: boolean,
): Promise<{
  browserPair: Awaited<ReturnType<typeof selectedPair>>
  hostPair: Awaited<ReturnType<typeof selectedPair>>
}> {
  const roomId = crypto.randomUUID()
  const signalingAuthToken = randomBytes(32).toString('base64url')
  const inbound = new Set<(message: unknown) => void>()
  const errors: string[] = []
  let hostPeer: RTCPeerConnection | null = null
  let cleanupHost: (() => void) | null = null
  let terminalPayload = ''
  const page = await browser.newPage()

  const emitToHost = (message: SignalRecord) => {
    for (const listener of inbound) listener(signSignal(signalingAuthToken, message))
  }
  await page.exposeFunction('terminayRouteSignal', emitToHost)
  await page.evaluate(({ iceServers, policy, roomId }) => {
    type RouteWindow = Window & {
      routeCandidateErrors?: Array<Record<string, unknown>>
      routePeer?: RTCPeerConnection
      receiveRouteSignal?: (message: Record<string, unknown>) => Promise<void>
      terminayRouteSignal?: (message: Record<string, unknown>) => Promise<void>
    }
    const routeWindow = window as RouteWindow
    const peer = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy })
    routeWindow.routePeer = peer
    routeWindow.routeCandidateErrors = []
    const pendingHostIce: RTCIceCandidateInit[] = []
    const pendingClientIce: RTCIceCandidateInit[] = []
    let remoteDescriptionInstalled = false
    let answerSent = false

    const sendCandidate = (candidate: RTCIceCandidateInit) => {
      void routeWindow.terminayRouteSignal?.({ candidate, roomId, type: 'ice' })
    }
    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      const candidate = event.candidate.toJSON()
      if (answerSent) sendCandidate(candidate)
      else pendingClientIce.push(candidate)
    }
    peer.addEventListener('icecandidateerror', (event) => {
      const failure = event as RTCPeerConnectionIceErrorEvent
      routeWindow.routeCandidateErrors?.push({
        errorCode: failure.errorCode,
        errorText: failure.errorText,
        url: failure.url,
      })
    })
    peer.ondatachannel = (event) => {
      if (event.channel.label !== 'terminal') return
      event.channel.onopen = () => {
        event.channel.send(JSON.stringify({ ticket: 'route-proof', type: 'terminal-auth' }))
        setTimeout(() => event.channel.send('route-ok'), 25)
      }
    }
    routeWindow.receiveRouteSignal = async (message) => {
      if (message.type === 'offer') {
        await peer.setRemoteDescription(message.sdp as RTCSessionDescriptionInit)
        remoteDescriptionInstalled = true
        for (const candidate of pendingHostIce.splice(0)) await peer.addIceCandidate(candidate)
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        await routeWindow.terminayRouteSignal?.({
          roomId,
          sdp: { sdp: answer.sdp ?? '', type: answer.type },
          type: 'answer',
        })
        answerSent = true
        setTimeout(() => {
          for (const candidate of pendingClientIce.splice(0)) sendCandidate(candidate)
        }, 25)
      } else if (message.type === 'ice') {
        const candidate = message.candidate as RTCIceCandidateInit
        if (remoteDescriptionInstalled) await peer.addIceCandidate(candidate)
        else pendingHostIce.push(candidate)
      }
    }
  }, { iceServers, policy, roomId })

  const api: HostApi = {
    async attachTerminal() {},
    closeTerminal() {},
    async getAsset() {
      return { bodyBase64: '', contentType: 'application/octet-stream' }
    },
    async getAssetManifest() {
      return { assets: [] }
    },
    async getConfig() {
      return null
    },
    async handleApiRequest() {
      return {}
    },
    handleTerminalMessage(_channelId, message) {
      terminalPayload += message
    },
    onConfig() {
      return () => {}
    },
    onSignalMessage(listener) {
      inbound.add(listener)
      return () => inbound.delete(listener)
    },
    onTerminalCloseRequest() {
      return () => {}
    },
    onTerminalMessage() {
      return () => {}
    },
    openSignal() {
      queueMicrotask(() => {
        for (const listener of inbound) {
          listener({ roomId, type: 'host-registered' })
          listener({ roomId, type: 'client-join' })
        }
      })
    },
    sendSignalMessage(message) {
      void page.evaluate(async (signal) => {
        const receive = (window as Window & {
          receiveRouteSignal?: (message: Record<string, unknown>) => Promise<void>
        }).receiveRouteSignal
        await receive?.(signal)
      }, message as SignalRecord).catch((error) => {
        errors.push(error instanceof Error ? error.message : String(error))
      })
    },
    updateStatus(message) {
      if (message.type === 'error') errors.push(message.detail ?? 'unknown error')
    },
  }

  try {
    const config: HostConfig = {
      appOrigin: 'https://route-proof.invalid',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      iceServers,
      relayJoinTokenHash: randomBytes(32).toString('base64url'),
      roomId,
      signalingAuthToken,
      signalingUrl: 'wss://route-proof.invalid/signal',
    }
    cleanupHost = await runHost(config, {
      api,
      createPeerConnection(configuration) {
        hostPeer = createWeriftPeer({
          ...configuration,
          iceTransportPolicy: policy,
        })
        return hostPeer
      },
    })

    if (shouldConnect) {
      try {
        await expect.poll(() => terminalPayload, { timeout: 20_000 }).toBe('route-ok')
      } catch (error) {
        const browserState = await page.evaluate(async () => {
          const routeWindow = window as Window & {
            routeCandidateErrors?: Array<Record<string, unknown>>
            routePeer?: RTCPeerConnection
          }
          const peer = routeWindow.routePeer
          if (!peer) return null
          const stats = [...(await peer.getStats()).values()]
          return {
            candidates: stats.filter((entry) =>
              entry.type === 'local-candidate' || entry.type === 'remote-candidate').map((entry) => ({
              candidateType: entry.candidateType,
              protocol: entry.protocol,
              type: entry.type,
            })),
            candidateErrors: routeWindow.routeCandidateErrors ?? [],
            connectionState: peer.connectionState,
            iceConnectionState: peer.iceConnectionState,
            iceGatheringState: peer.iceGatheringState,
          }
        })
        const hostStats = hostPeer ? [...(await hostPeer.getStats()).values()] : []
        const hostState = hostPeer ? {
          candidates: hostStats.filter((entry) =>
            entry.type === 'local-candidate' || entry.type === 'remote-candidate').map((entry) => ({
            candidateType: entry.candidateType,
            protocol: entry.protocol,
            type: entry.type,
          })),
          connectionState: hostPeer.connectionState,
          iceConnectionState: hostPeer.iceConnectionState,
          iceGatheringState: hostPeer.iceGatheringState,
        } : null
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} ` +
          `route=${JSON.stringify({ browserState, errors, hostState })}`,
        )
      }
      expect(errors).toEqual([])
    } else {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      expect(terminalPayload).toBe('')
    }

    const browserPair = await page.evaluate(async () => {
      const peer = (window as Window & { routePeer?: RTCPeerConnection }).routePeer
      if (!peer) return null
      const stats = await peer.getStats()
      const entries = [...stats.values()]
      const pair = entries.find((entry) =>
        entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded')
      if (!pair) return null
      return {
        localType: stats.get(pair.localCandidateId)?.candidateType ?? '',
        protocol: stats.get(pair.localCandidateId)?.protocol ?? '',
        remoteType: stats.get(pair.remoteCandidateId)?.candidateType ?? '',
      }
    })
    return {
      browserPair,
      hostPair: hostPeer ? await selectedPair(hostPeer) : null,
    }
  } finally {
    cleanupHost?.()
    await page.close()
  }
}

async function exerciseWeriftRoute(
  iceServers: RTCIceServer[],
  policy: RTCIceTransportPolicy,
  shouldConnect: boolean,
): Promise<{
  clientPair: Awaited<ReturnType<typeof selectedPair>>
  hostPair: Awaited<ReturnType<typeof selectedPair>>
}> {
  const roomId = crypto.randomUUID()
  const signalingAuthToken = randomBytes(32).toString('base64url')
  const inbound = new Set<(message: unknown) => void>()
  const errors: string[] = []
  const pendingHostIce: RTCIceCandidateInit[] = []
  const pendingClientIce: RTCIceCandidateInit[] = []
  let hostPeer: RTCPeerConnection | null = null
  let clientPeer: RTCPeerConnection | null = null
  let cleanupHost: (() => void) | null = null
  let terminalPayload = ''
  let answerSent = false

  const emitToHost = (message: SignalRecord) => {
    for (const listener of inbound) listener(signSignal(signalingAuthToken, message))
  }
  const installClient = async (offer: RTCSessionDescriptionInit) => {
    clientPeer = createWeriftPeer({ iceServers, iceTransportPolicy: policy })
    clientPeer.addEventListener('datachannel', ((event: RTCDataChannelEvent) => {
      if (event.channel.label !== 'terminal') return
      event.channel.addEventListener('open', () => {
        event.channel.send(JSON.stringify({ ticket: 'route-proof', type: 'terminal-auth' }))
        setTimeout(() => event.channel.send('route-ok'), 25)
      })
    }) as EventListener)
    clientPeer.addEventListener('icecandidate', ((event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) return
      const candidate = event.candidate.toJSON()
      if (answerSent) {
        emitToHost({ candidate, roomId, type: 'ice' })
      } else {
        pendingClientIce.push(candidate)
      }
    }) as EventListener)
    await clientPeer.setRemoteDescription(offer)
    for (const candidate of pendingHostIce.splice(0)) await clientPeer.addIceCandidate(candidate)
    const answer = await clientPeer.createAnswer()
    await clientPeer.setLocalDescription(answer)
    emitToHost({
      roomId,
      sdp: { sdp: answer.sdp ?? '', type: answer.type },
      type: 'answer',
    })
    answerSent = true
    setTimeout(() => {
      for (const candidate of pendingClientIce.splice(0)) {
        emitToHost({ candidate, roomId, type: 'ice' })
      }
    }, 25)
  }

  const api: HostApi = {
    async attachTerminal() {},
    closeTerminal() {},
    async getAsset() {
      return { bodyBase64: '', contentType: 'application/octet-stream' }
    },
    async getAssetManifest() {
      return { assets: [] }
    },
    async getConfig() {
      return null
    },
    async handleApiRequest() {
      return {}
    },
    handleTerminalMessage(_channelId, message) {
      terminalPayload += message
    },
    onConfig() {
      return () => {}
    },
    onSignalMessage(listener) {
      inbound.add(listener)
      return () => inbound.delete(listener)
    },
    onTerminalCloseRequest() {
      return () => {}
    },
    onTerminalMessage() {
      return () => {}
    },
    openSignal() {
      queueMicrotask(() => {
        for (const listener of inbound) {
          listener({ roomId, type: 'host-registered' })
          listener({ roomId, type: 'client-join' })
        }
      })
    },
    sendSignalMessage(message) {
      void (async () => {
        const signal = message as SignalRecord
        if (signal.type === 'offer') {
          await installClient(signal.sdp as RTCSessionDescriptionInit)
        } else if (signal.type === 'ice' && clientPeer) {
          await clientPeer.addIceCandidate(signal.candidate as RTCIceCandidateInit)
        } else if (signal.type === 'ice') {
          pendingHostIce.push(signal.candidate as RTCIceCandidateInit)
        }
      })().catch((error) => {
        errors.push(error instanceof Error ? error.message : String(error))
      })
    },
    updateStatus(message) {
      if (message.type === 'error') errors.push(message.detail ?? 'unknown error')
    },
  }

  try {
    cleanupHost = await runHost({
      appOrigin: 'https://route-proof.invalid',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      iceServers,
      relayJoinTokenHash: randomBytes(32).toString('base64url'),
      roomId,
      signalingAuthToken,
      signalingUrl: 'wss://route-proof.invalid/signal',
    }, {
      api,
      createPeerConnection(configuration) {
        hostPeer = createWeriftPeer({
          ...configuration,
          iceTransportPolicy: policy,
        })
        return hostPeer
      },
    })
    if (shouldConnect) {
      await expect.poll(() => terminalPayload, { timeout: 20_000 }).toBe('route-ok')
      expect(errors).toEqual([])
    } else {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      expect(terminalPayload).toBe('')
    }
    return {
      clientPair: clientPeer ? await selectedPair(clientPeer) : null,
      hostPair: hostPeer ? await selectedPair(hostPeer) : null,
    }
  } finally {
    cleanupHost?.()
    clientPeer?.close()
  }
}

test('secure Werift connects to native Chromium through a mock hosted signaling peer', async ({ browser }) => {
  test.setTimeout(90_000)
  const direct = await exerciseRoute(browser, [], 'all', true)
  expect(direct.hostPair?.localType).toBe('host')
  expect(['host', 'prflx', 'srflx']).toContain(direct.hostPair?.remoteType)
  expect(['host', 'prflx', 'srflx']).toContain(direct.browserPair?.localType)
  expect(['host', 'prflx', 'srflx']).toContain(direct.browserPair?.remoteType)
})

test('secure Werift rejects invalid and expired TURN credentials', async () => {
  test.skip(!turnConfigPath || !Number.isInteger(turnPort), 'requires the isolated coturn proof wrapper')
  test.setTimeout(90_000)
  const secret = parseTurnSecret(await readFile(turnConfigPath!, 'utf8'))
  const now = Math.floor(Date.now() / 1_000)
  const turnUrl = `turn:127.0.0.1:${turnPort}?transport=udp`
  const invalid = {
    ...turnCredentials(secret, now + 60, 'invalid-route'),
    credential: randomBytes(20).toString('base64'),
    urls: turnUrl,
  }
  const expired = {
    urls: turnUrl,
    ...turnCredentials(secret, now - 60, 'expired-route'),
  }
  for (const [label, server] of [['invalid', invalid], ['expired', expired]] as const) {
    const rejected = await exerciseWeriftRoute([server], 'relay', false)
    expect(rejected.hostPair, `${label} credential host route`).toBeNull()
    expect(rejected.clientPair, `${label} credential client route`).toBeNull()
  }
})

test('secure Werift selects direct and authenticated TURN-only routes', async ({ browser }) => {
  test.skip(!turnConfigPath || !Number.isInteger(turnPort), 'requires the isolated coturn proof wrapper')
  test.setTimeout(90_000)
  const secret = parseTurnSecret(await readFile(turnConfigPath!, 'utf8'))
  const now = Math.floor(Date.now() / 1_000)
  const turnUrl = `turn:127.0.0.1:${turnPort}?transport=udp`

  if (!turnRouteOnly) {
    const direct = await exerciseRoute(browser, [], 'all', true)
    expect(direct.hostPair?.localType).toBe('host')
    expect(['host', 'prflx', 'srflx']).toContain(direct.hostPair?.remoteType)
    expect(direct.browserPair?.localType).toBe('host')
    expect(['host', 'prflx', 'srflx']).toContain(direct.browserPair?.remoteType)
  }

  const relayed = await exerciseRoute(browser, [{
    urls: turnUrl,
    ...turnCredentials(secret, now + 60, 'valid-route'),
  }], 'relay', true)
  expect(relayed.hostPair).toEqual({
    localType: 'relay',
    protocol: 'udp',
    remoteType: 'relay',
  })
  expect(relayed.browserPair).toEqual({
    localType: 'relay',
    protocol: 'udp',
    remoteType: 'relay',
  })
})
