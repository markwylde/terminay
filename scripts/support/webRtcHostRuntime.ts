export type HostConfig = {
  appOrigin: string
  expiresAt: string
  iceServers?: RTCIceServer[]
  relayJoinTokenHash: string
  reconnect?: {
    attemptId: string
    protocolVersion: 'v1'
    reconnectHandle: string
    savedSessionExpiresAt: string
    sessionId: string
  }
  roomId: string
  sessionId?: string
  signalingAuthToken: string
  signalingUrl: string
}

export type HostApi = {
  attachApplication?(channelId: string, ticket: string, channel: RTCDataChannel): Promise<void>
  closeApplication?(channelId: string, reason?: string): void
  attachTerminal(channelId: string, ticket: string): Promise<void>
  closeTerminal(channelId: string, reason?: string): void
  getAsset(path: string): Promise<unknown>
  getAssetManifest(): Promise<unknown>
  getConfig(): Promise<HostConfig | null>
  handleApiRequest(pathname: string, body: Record<string, unknown>, appOrigin: string): Promise<unknown>
  handleTerminalMessage(channelId: string, message: string): void
  updateStatus?(message: { detail?: string; type: string }): void
  openSignal(): void
  sendSignalMessage(message: unknown): void
  onTerminalCloseRequest(listener: (message: { channelId: string; reason?: string }) => void): () => void
  onConfig(listener: (config: HostConfig) => void): () => void
  onSignalMessage(listener: (message: unknown) => void): () => void
  onTerminalMessage(listener: (message: { channelId: string; message: string }) => void): () => void
}

const ASSET_CHUNK_BODY_CHARS = 64 * 1024
const ASSET_CHUNK_WINDOW = 4
const ASSET_TRANSFER_TIMEOUT_MS = 15_000
// The bundled browser installs its manifest and assets sequentially. One
// active request is therefore sufficient for product behavior and prevents a
// hostile peer from multiplying the per-transfer acknowledgement window.
const MAX_ACTIVE_ASSET_REQUESTS = 1
const MAX_UNACKNOWLEDGED_ASSET_BODY_CHARS =
  MAX_ACTIVE_ASSET_REQUESTS * ASSET_CHUNK_WINDOW * ASSET_CHUNK_BODY_CHARS
const MAX_INBOUND_PROTOCOL_BYTES = 128 * 1024
const DEFAULT_ICE_RECOVERY_GRACE_MS = 5_000

type AssetTransfer = {
  acknowledged: Set<number>
  cancelled: boolean
  notify: Set<() => void>
  sent: number
}

export type WebRtcHostRuntimeDependencies = {
  api?: HostApi
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection
  iceRecoveryGraceMs?: number
}

class WebRtcPeerLifecycle {
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private terminal = false

  constructor(
    private readonly peer: RTCPeerConnection,
    private readonly recoveryGraceMs: number,
    private readonly closeSession: (reason: string) => void,
  ) {}

  observe(source: 'peer' | 'ice'): void {
    if (this.stopped || this.terminal) return
    const peerState = this.peer.connectionState
    const iceState = this.peer.iceConnectionState
    if (isTerminalWebRtcState(peerState) || isTerminalWebRtcState(iceState)) {
      const reason = source === 'peer' && isTerminalWebRtcState(peerState)
        ? `WebRTC peer connection ${peerState}.`
        : source === 'ice' && isTerminalWebRtcState(iceState)
          ? `WebRTC ICE connection ${iceState}.`
          : `WebRTC connection failed (peer: ${peerState}, ICE: ${iceState}).`
      this.fail(reason)
      return
    }
    if (peerState === 'disconnected' || iceState === 'disconnected') {
      this.recoveryTimer ??= setTimeout(() => {
        this.recoveryTimer = undefined
        if (this.stopped || this.terminal) return
        const currentPeerState = this.peer.connectionState
        const currentIceState = this.peer.iceConnectionState
        if (currentPeerState === 'disconnected' || currentIceState === 'disconnected') {
          this.fail(
            `WebRTC recovery grace period expired (peer: ${currentPeerState}, ICE: ${currentIceState}).`,
          )
        } else {
          this.cancelRecovery()
        }
      }, this.recoveryGraceMs)
      return
    }
    this.cancelRecovery()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.cancelRecovery()
  }

  fail(reason: string): void {
    if (this.terminal || this.stopped) return
    this.terminal = true
    this.cancelRecovery()
    this.closeSession(reason)
  }

  private cancelRecovery(): void {
    if (this.recoveryTimer === undefined) return
    clearTimeout(this.recoveryTimer)
    this.recoveryTimer = undefined
  }
}

function isTerminalWebRtcState(state: RTCPeerConnectionState | RTCIceConnectionState): boolean {
  return state === 'closed' || state === 'failed'
}

function resolveIceRecoveryGraceMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_ICE_RECOVERY_GRACE_MS
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 60_000) {
    throw new RangeError('WebRTC ICE recovery grace period must be between 1ms and 60 seconds.')
  }
  return resolved
}

declare global {
  interface Window {
    terminayWebRtcHost?: HostApi
  }
}

function decodeTextData(raw: unknown, maximumBytes = MAX_INBOUND_PROTOCOL_BYTES): string | null {
  if (typeof raw === 'string') {
    return new TextEncoder().encode(raw).byteLength <= maximumBytes ? raw : null
  }

  let bytes: Uint8Array
  if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw)
  } else if (ArrayBuffer.isView(raw)) {
    bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  } else {
    return null
  }
  if (bytes.byteLength > maximumBytes) return null

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  const text = decodeTextData(raw)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function base64UrlToBytes(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function canonicalSignalPayload(message: Record<string, unknown>): string {
  const reconnect = typeof message.type === 'string' && message.type.startsWith('reconnect-')
  const payload: Record<string, unknown> = reconnect
    ? {
        attemptId: message.attemptId ?? '',
        nonce: message.nonce,
        protocolVersion: message.protocolVersion ?? '',
        reconnectHandle: message.reconnectHandle ?? '',
        savedSessionExpiresAt: message.savedSessionExpiresAt ?? '',
        sessionId: message.sessionId ?? '',
        type: message.type,
      }
    : {
        nonce: message.nonce,
        roomId: message.roomId,
        type: message.type,
      }
  if ('candidate' in message) payload.candidate = message.candidate
  if ('sdp' in message) payload.sdp = message.sdp
  return stableJson(payload)
}

function assertSignalContext(config: HostConfig, message: Record<string, unknown>): void {
  if (!config.reconnect) return
  if (
    message.attemptId !== config.reconnect.attemptId ||
    message.protocolVersion !== config.reconnect.protocolVersion ||
    message.reconnectHandle !== config.reconnect.reconnectHandle ||
    message.sessionId !== config.reconnect.sessionId
  ) {
    throw new Error('The browser sent WebRTC signaling for a different reconnect attempt.')
  }
}

function isSignalForRoom(message: Record<string, unknown>, roomId: string): boolean {
  return !('roomId' in message) || message.roomId === roomId
}

async function createSignalingAuthKey(token: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(token),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  )
}

async function signSignalMessage(authKey: CryptoKey, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  const signedMessage = {
    ...message,
    nonce: typeof message.nonce === 'string' && message.nonce ? message.nonce : crypto.randomUUID(),
  }
  const signature = await crypto.subtle.sign('HMAC', authKey, new TextEncoder().encode(canonicalSignalPayload(signedMessage)))
  return { ...signedMessage, signature: bytesToBase64Url(signature) }
}

function createOutboundSignalPayload(config: HostConfig, message: Record<string, unknown>): Record<string, unknown> {
  if (config.reconnect) {
    const payload: Record<string, unknown> = {
      ...message,
      attemptId: config.reconnect.attemptId,
      protocolVersion: config.reconnect.protocolVersion,
      reconnectHandle: config.reconnect.reconnectHandle,
      sessionId: config.reconnect.sessionId,
      type: message.type === 'offer'
        ? 'reconnect-offer'
        : message.type === 'ice'
          ? 'reconnect-ice'
          : message.type,
    }
    if (config.reconnect.savedSessionExpiresAt) {
      payload.savedSessionExpiresAt = config.reconnect.savedSessionExpiresAt
    }
    return payload
  }

  return {
    ...message,
    roomId: config.roomId,
  }
}

async function verifySignalMessage(authKey: CryptoKey, message: Record<string, unknown>): Promise<boolean> {
  if (typeof message.signature !== 'string') return false
  return crypto.subtle.verify(
    'HMAC',
    authKey,
    base64UrlToBytes(message.signature),
    new TextEncoder().encode(canonicalSignalPayload(message)),
  )
}

function notifyAssetTransfer(transfer: AssetTransfer): void {
  for (const notify of transfer.notify) notify()
  transfer.notify.clear()
}

async function waitForAssetTransfer(
  transfer: AssetTransfer,
  predicate: () => boolean,
): Promise<void> {
  while (!predicate()) {
    if (transfer.cancelled) {
      throw new Error('Asset transfer was cancelled.')
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        transfer.notify.delete(onProgress)
        reject(new Error('Asset transfer acknowledgement timed out.'))
      }, ASSET_TRANSFER_TIMEOUT_MS)
      const onProgress = () => {
        clearTimeout(timeout)
        resolve()
      }
      transfer.notify.add(onProgress)
    })
  }
}

async function sendAssetResponse(
  channel: RTCDataChannel,
  transfers: Map<string, AssetTransfer>,
  id: string,
  response: unknown,
): Promise<void> {
  const bodyBase64 = typeof response === 'object' && response !== null && 'bodyBase64' in response
    ? (response as { bodyBase64?: unknown }).bodyBase64
    : null

  if (typeof bodyBase64 !== 'string' || bodyBase64.length <= ASSET_CHUNK_BODY_CHARS) {
    channel.send(JSON.stringify({ ...response as Record<string, unknown>, id }))
    return
  }

  const total = Math.ceil(bodyBase64.length / ASSET_CHUNK_BODY_CHARS)
  const metadata = { ...response as Record<string, unknown> }
  delete metadata.bodyBase64
  const transfer: AssetTransfer = {
    acknowledged: new Set(),
    cancelled: false,
    notify: new Set(),
    sent: 0,
  }
  transfers.set(id, transfer)
  try {
    for (let index = 0; index < total; index += 1) {
      await waitForAssetTransfer(
        transfer,
        () => transfer.sent - transfer.acknowledged.size < ASSET_CHUNK_WINDOW,
      )
      if (channel.readyState !== 'open') {
        throw new Error('Asset channel closed during transfer.')
      }
      channel.send(JSON.stringify({
        ...metadata,
        bodyBase64Chunk: bodyBase64.slice(index * ASSET_CHUNK_BODY_CHARS, (index + 1) * ASSET_CHUNK_BODY_CHARS),
        id,
        index,
        total,
        type: 'asset:chunk',
      }))
      transfer.sent += 1
      // Yield so API and terminal stream callbacks are not monopolized by a
      // large cached UI asset.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    await waitForAssetTransfer(
      transfer,
      () => transfer.acknowledged.size === total,
    )
  } finally {
    transfers.delete(id)
  }
}

export async function runHost(
  config: HostConfig,
  dependencies: WebRtcHostRuntimeDependencies = {},
): Promise<() => void> {
  const api = dependencies.api ?? window.terminayWebRtcHost
  if (!api) throw new Error('WebRTC host bridge is unavailable.')

  const signalingAuthKey = await createSignalingAuthKey(config.signalingAuthToken)
  const peerConfiguration: RTCConfiguration = {
    iceServers: config.iceServers?.length ? config.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }],
  }
  const peer = dependencies.createPeerConnection
    ? dependencies.createPeerConnection(peerConfiguration)
    : new RTCPeerConnection(peerConfiguration)
  const channels = {
    api: peer.createDataChannel('api'),
    asset: peer.createDataChannel('asset'),
    control: peer.createDataChannel('control'),
    application: peer.createDataChannel('application'),
    terminal: peer.createDataChannel('terminal'),
    assets: peer.createDataChannel('assets'),
  }
  const applicationChannelId = crypto.randomUUID()
  const terminalChannelId = crypto.randomUUID()
  const assetTransfers = new Map<string, AssetTransfer>()
  const activeAssetRequestIds = new Set<string>()
  let terminalClosed = false
  let applicationClosed = false
  let terminalAuthenticated = false
  const seenSignalNonces = new Set<string>()
  const closeTerminal = (reason = 'WebRTC terminal channel closed.') => {
    if (terminalClosed) return
    terminalClosed = true
    api.closeTerminal(terminalChannelId, reason)
  }
  const closeApplication = (reason = 'WebRTC application channel closed.') => {
    if (applicationClosed) return
    applicationClosed = true
    api.closeApplication?.(applicationChannelId, reason)
  }
  const lifecycle = new WebRtcPeerLifecycle(
    peer,
    resolveIceRecoveryGraceMs(dependencies.iceRecoveryGraceMs),
    (reason) => {
      closeApplication(reason)
      closeTerminal(reason)
    },
  )

  peer.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return
    void signSignalMessage(signalingAuthKey, createOutboundSignalPayload(config, {
      candidate: event.candidate.toJSON(),
      type: 'ice',
    })).then((message) => api.sendSignalMessage(message))
  })

  const bindAssetProtocol = (channel: RTCDataChannel) => channel.addEventListener('message', (event) => {
    void (async () => {
      const request = parseJson(event.data)
      if (!request || typeof request.id !== 'string') return
      if (request.type === 'asset:ack') {
        const transfer = assetTransfers.get(request.id)
        const index = Number(request.index)
        if (
          transfer &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < transfer.sent
        ) {
          transfer.acknowledged.add(index)
          notifyAssetTransfer(transfer)
        }
        return
      }
      if (request.type === 'asset:cancel') {
        const transfer = assetTransfers.get(request.id)
        if (transfer) {
          transfer.cancelled = true
          notifyAssetTransfer(transfer)
        }
        return
      }
      if (
        activeAssetRequestIds.has(request.id) ||
        activeAssetRequestIds.size >= MAX_ACTIVE_ASSET_REQUESTS
      ) {
        channel.send(JSON.stringify({
          error:
            `Asset request limit reached. Terminay permits ${MAX_ACTIVE_ASSET_REQUESTS} ` +
            `active request and ${MAX_UNACKNOWLEDGED_ASSET_BODY_CHARS} ` +
            'unacknowledged Base64 body characters per peer.',
          id: request.id,
        }))
        return
      }
      activeAssetRequestIds.add(request.id)
      try {
        const response = request.type === 'asset:get-manifest'
          ? await api.getAssetManifest()
          : await api.getAsset(String(request.path ?? ''))
        await sendAssetResponse(channel, assetTransfers, request.id, response)
      } catch (error) {
        channel.send(JSON.stringify({
          error: error instanceof Error ? error.message : 'Asset request failed.',
          id: request.id,
        }))
      } finally {
        activeAssetRequestIds.delete(request.id)
      }
    })()
  })
  // `assets` is the canonical authenticated lane used by native Desktop.
  // Singular `asset` is a version-1 browser compatibility adapter and is not
  // exposed through the canonical host context.
  bindAssetProtocol(channels.assets)
  bindAssetProtocol(channels.asset)

  channels.api.addEventListener('message', (event) => {
    void (async () => {
      const request = parseJson(event.data)
      if (request?.type !== 'api-request' || typeof request.id !== 'string') return
      try {
        const body = await api.handleApiRequest(
          String(request.pathname ?? ''),
          (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>,
          config.appOrigin,
        )
        channels.api.send(JSON.stringify({ body, id: request.id, ok: true, type: 'api-response' }))
      } catch (error) {
        channels.api.send(JSON.stringify({
          error: error instanceof Error ? error.message : 'Request failed.',
          id: request.id,
          ok: false,
          type: 'api-response',
        }))
      }
    })()
  })

  channels.control.addEventListener('message', (event) => {
    void (async () => {
      const request = parseJson(event.data)
      if (
        request?.type !== 'application-auth' ||
        typeof request.id !== 'string' ||
        typeof request.ticket !== 'string'
      ) return
      try {
        if (!api.attachApplication) {
          throw new Error('The canonical application host is unavailable.')
        }
        await api.attachApplication(applicationChannelId, request.ticket, channels.application)
        channels.control.send(JSON.stringify({
          id: request.id,
          ok: true,
          type: 'application-authenticated',
        }))
      } catch (error) {
        channels.control.send(JSON.stringify({
          error: error instanceof Error ? error.message : 'Application authentication failed.',
          id: request.id,
          ok: false,
          type: 'application-authenticated',
        }))
      }
    })()
  })
  for (const channel of [channels.control, channels.application, channels.terminal, channels.assets]) {
    channel.addEventListener('close', () => {
      lifecycle.fail(`WebRTC ${channel.label} channel closed.`)
    })
    channel.addEventListener('error', () => {
      lifecycle.fail(`WebRTC ${channel.label} channel failed.`)
    })
  }

  channels.terminal.addEventListener('message', (event) => {
    const request = parseJson(event.data)
    if (request?.type === 'terminal-auth' && typeof request.ticket === 'string') {
      void api.attachTerminal(terminalChannelId, request.ticket).then(() => {
        terminalAuthenticated = true
      }).catch((error) => {
        channels.terminal.send(JSON.stringify({
          message: error instanceof Error ? error.message : 'Terminal authentication failed.',
          type: 'error',
        }))
      })
      return
    }
    const terminalMessage = decodeTextData(event.data)
    if (terminalAuthenticated && terminalMessage !== null) {
      api.handleTerminalMessage(terminalChannelId, terminalMessage)
    }
  })
  peer.addEventListener('connectionstatechange', () => {
    lifecycle.observe('peer')
  })

  peer.addEventListener('iceconnectionstatechange', () => {
    lifecycle.observe('ice')
  })

  const stopTerminalMessages = api.onTerminalMessage((message) => {
    if (message.channelId !== terminalChannelId || channels.terminal.readyState !== 'open') return
    channels.terminal.send(message.message)
  })
  const stopTerminalCloseRequests = api.onTerminalCloseRequest((message) => {
    if (message.channelId !== terminalChannelId) return
    const reason = message.reason || 'Remote connection closed by Terminay.'
    lifecycle.fail(reason)
    if (channels.terminal.readyState === 'open' || channels.terminal.readyState === 'connecting') {
      channels.terminal.close()
    }
  })

  const stopSignalMessages = api.onSignalMessage((rawMessage) => {
    void (async () => {
      const message = rawMessage && typeof rawMessage === 'object' ? rawMessage as Record<string, unknown> : null
      if (!message) return
      if (!isSignalForRoom(message, config.roomId)) return
      if (message.type === 'host-registered') {
        api.updateStatus?.({ type: 'host-registered' })
      } else if (message.type === 'client-join') {
        api.updateStatus?.({ type: 'client-join' })
        const offer = await peer.createOffer()
        const offerInit: RTCSessionDescriptionInit = {
          sdp: offer.sdp ?? '',
          type: offer.type,
        }
        await peer.setLocalDescription(offerInit)
        const signedOffer = await signSignalMessage(
          signalingAuthKey,
          createOutboundSignalPayload(config, { sdp: offerInit, type: 'offer' }),
        )
        api.sendSignalMessage(signedOffer)
      } else if ((message.type === 'answer' || message.type === 'reconnect-answer') && message.sdp && typeof message.sdp === 'object') {
        assertSignalContext(config, message)
        if (!await verifySignalMessage(signalingAuthKey, message)) {
          throw new Error('The browser sent an unauthenticated WebRTC answer.')
        }
        rejectSignalReplay(message, seenSignalNonces)
        await peer.setRemoteDescription(message.sdp as RTCSessionDescriptionInit)
      } else if ((message.type === 'ice' || message.type === 'reconnect-ice') && message.candidate && typeof message.candidate === 'object') {
        assertSignalContext(config, message)
        if (!await verifySignalMessage(signalingAuthKey, message)) {
          throw new Error('The browser sent an unauthenticated WebRTC candidate.')
        }
        rejectSignalReplay(message, seenSignalNonces)
        await peer.addIceCandidate(message.candidate as RTCIceCandidateInit)
      } else if (message.type === 'error') {
        api.updateStatus?.({
          detail: typeof message.message === 'string' ? message.message : undefined,
          type: 'error',
        })
      }
    })().catch((error) => {
      api.updateStatus?.({
        detail: error instanceof Error ? error.message : 'WebRTC host signaling failed.',
        type: 'error',
      })
    })
  })

  api.openSignal()

  return () => {
    lifecycle.stop()
    stopSignalMessages()
    stopTerminalMessages()
    stopTerminalCloseRequests()
    closeApplication('WebRTC host window stopped.')
    closeTerminal('WebRTC host window stopped.')
    for (const transfer of assetTransfers.values()) {
      transfer.cancelled = true
      notifyAssetTransfer(transfer)
    }
    assetTransfers.clear()
    activeAssetRequestIds.clear()
    peer.close()
  }
}

function rejectSignalReplay(message: Record<string, unknown>, seenSignalNonces: Set<string>): void {
  if (typeof message.nonce !== 'string' || !message.nonce) {
    throw new Error('WebRTC signaling message was missing replay protection.')
  }
  if (seenSignalNonces.has(message.nonce)) {
    throw new Error('WebRTC signaling message was replayed.')
  }
  seenSignalNonces.add(message.nonce)
}
