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
	/** One immutable gzip-compressed tar bundle from the authenticated server. */
	getUiArchive(): Promise<unknown>
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

export const UI_ARCHIVE_CHUNK_BYTES = 64 * 1024
export const UI_ARCHIVE_CHUNK_WINDOW = 4
export const UI_ARCHIVE_TRANSFER_TIMEOUT_MS = 15_000
export const UI_ARCHIVE_FORMAT_VERSION = 1
const MAX_ACTIVE_UI_ARCHIVE_REQUESTS = 1
const MAX_INBOUND_PROTOCOL_BYTES = 128 * 1024
const DEFAULT_ICE_RECOVERY_GRACE_MS = 5_000

type UiArchiveTransfer = {
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

function notifyUiArchiveTransfer(transfer: UiArchiveTransfer): void {
  for (const notify of transfer.notify) notify()
  transfer.notify.clear()
}

async function waitForUiArchiveTransfer(
	transfer: UiArchiveTransfer,
  predicate: () => boolean,
): Promise<void> {
  while (!predicate()) {
    if (transfer.cancelled) {
		throw new Error('UI archive transfer was cancelled.')
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        transfer.notify.delete(onProgress)
			reject(new Error('UI archive transfer acknowledgement timed out.'))
		}, UI_ARCHIVE_TRANSFER_TIMEOUT_MS)
      const onProgress = () => {
        clearTimeout(timeout)
        resolve()
      }
      transfer.notify.add(onProgress)
    })
  }
}

function sendUiArchiveError(
	channel: RTCDataChannel,
	id: string,
	code: 'cancelled' | 'internal' | 'invalid-request' | 'timeout' | 'unavailable',
	message: string,
): void {
	if (channel.readyState !== 'open') return
	channel.send(JSON.stringify({ code, id, message, type: 'asset:bundle-error' }))
}

function asUiArchive(value: unknown): Readonly<{
	archiveFormatVersion: number
	bundleId: string
	bytes: Uint8Array
	compressedBytes: number
}> {
	if (typeof value !== 'object' || value === null) throw new TypeError('Server UI archive response is invalid.')
	const archive = value as Record<string, unknown>
	if (
		archive.archiveFormatVersion !== UI_ARCHIVE_FORMAT_VERSION ||
		typeof archive.bundleId !== 'string' ||
		archive.bundleId.length < 8 ||
		!(archive.bytes instanceof Uint8Array) ||
		!Number.isSafeInteger(archive.compressedBytes) ||
		archive.compressedBytes !== archive.bytes.byteLength ||
		archive.compressedBytes < 1
	) throw new TypeError('Server UI archive response is invalid.')
	return archive as Readonly<{ archiveFormatVersion: number; bundleId: string; bytes: Uint8Array; compressedBytes: number }>
}

function binaryUiArchiveChunk(index: number, bytes: Uint8Array): ArrayBuffer {
	const frame = new Uint8Array(8 + bytes.byteLength)
	frame.set([0x54, 0x42, UI_ARCHIVE_FORMAT_VERSION, 0x01], 0)
	new DataView(frame.buffer).setUint32(4, index, false)
	frame.set(bytes, 8)
	return frame.buffer
}

async function sendUiArchive(
	channel: RTCDataChannel,
	transfers: Map<string, UiArchiveTransfer>,
	id: string,
	archive: unknown,
): Promise<void> {
	const bundle = asUiArchive(archive)
	const chunks = Math.ceil(bundle.compressedBytes / UI_ARCHIVE_CHUNK_BYTES)
	if (chunks < 1 || chunks > 0xffff_ffff) throw new RangeError('Server UI archive chunk count is invalid.')
	const transfer: UiArchiveTransfer = {
		acknowledged: new Set(),
    cancelled: false,
    notify: new Set(),
    sent: 0,
  }
	transfers.set(id, transfer)
	try {
		channel.send(JSON.stringify({
			archiveFormatVersion: UI_ARCHIVE_FORMAT_VERSION,
			bundleId: bundle.bundleId,
			chunkBytes: UI_ARCHIVE_CHUNK_BYTES,
			chunks,
			compressedBytes: bundle.compressedBytes,
			id,
			type: 'asset:bundle-start',
		}))
		for (let index = 0; index < chunks; index += 1) {
			await waitForUiArchiveTransfer(
				transfer,
				() => transfer.sent - transfer.acknowledged.size < UI_ARCHIVE_CHUNK_WINDOW,
			)
			if (channel.readyState !== 'open') {
				throw new Error('UI archive channel closed during transfer.')
			}
			const offset = index * UI_ARCHIVE_CHUNK_BYTES
			channel.send(binaryUiArchiveChunk(index, bundle.bytes.subarray(offset, offset + UI_ARCHIVE_CHUNK_BYTES)))
			transfer.sent += 1
			await new Promise<void>((resolve) => setTimeout(resolve, 0))
		}
		await waitForUiArchiveTransfer(
			transfer,
			() => transfer.acknowledged.size === chunks,
		)
		if (channel.readyState === 'open') channel.send(JSON.stringify({ id, type: 'asset:bundle-complete' }))
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
	const uiArchiveTransfers = new Map<string, UiArchiveTransfer>()
	const activeUiArchiveRequestIds = new Set<string>()
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

  const bindUiArchiveProtocol = (channel: RTCDataChannel) => channel.addEventListener('message', (event) => {
    void (async () => {
      const request = parseJson(event.data)
      if (!request || typeof request.id !== 'string') return
      if (request.type === 'asset:bundle-ack') {
        const transfer = uiArchiveTransfers.get(request.id)
        const index = Number(request.index)
        if (
          transfer &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < transfer.sent
        ) {
          transfer.acknowledged.add(index)
          notifyUiArchiveTransfer(transfer)
        }
        return
      }
      if (request.type === 'asset:bundle-cancel') {
        const transfer = uiArchiveTransfers.get(request.id)
        if (transfer) {
          transfer.cancelled = true
          notifyUiArchiveTransfer(transfer)
        }
        return
      }
      if (
        activeUiArchiveRequestIds.has(request.id) ||
        activeUiArchiveRequestIds.size >= MAX_ACTIVE_UI_ARCHIVE_REQUESTS
      ) {
        sendUiArchiveError(channel, request.id, 'unavailable', 'A UI archive transfer is already active for this peer.')
        return
      }
      if (request.type !== 'asset:get-bundle' || request.archiveFormatVersion !== UI_ARCHIVE_FORMAT_VERSION) {
        sendUiArchiveError(channel, request.id, 'invalid-request', 'The requested UI archive format is unsupported.')
        return
      }
      activeUiArchiveRequestIds.add(request.id)
      try {
        await sendUiArchive(channel, uiArchiveTransfers, request.id, await api.getUiArchive())
      } catch (error) {
			const message = error instanceof Error ? error.message : 'UI archive transfer failed.'
			const code = /cancelled/iu.test(message) ? 'cancelled' : /timed out/iu.test(message) ? 'timeout' : 'internal'
			sendUiArchiveError(channel, request.id, code, message)
      } finally {
        activeUiArchiveRequestIds.delete(request.id)
      }
    })()
  })
	// `assets` is canonical; the existing singular browser lane carries the
	// exact same archive protocol during the manager migration.
	bindUiArchiveProtocol(channels.assets)
	bindUiArchiveProtocol(channels.asset)

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
	for (const transfer of uiArchiveTransfers.values()) {
		transfer.cancelled = true
		notifyUiArchiveTransfer(transfer)
	}
	uiArchiveTransfers.clear()
	activeUiArchiveRequestIds.clear()
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
