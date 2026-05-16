import { useEffect } from 'react'

type HostConfig = {
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

type HostApi = {
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

declare global {
  interface Window {
    terminayWebRtcHost?: HostApi
  }
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as unknown
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
  const payload: Record<string, unknown> = {
    nonce: message.nonce,
    roomId: message.roomId ?? message.sessionId,
    type: message.type,
  }
  if ('candidate' in message) payload.candidate = message.candidate
  if ('sdp' in message) payload.sdp = message.sdp
  return stableJson(payload)
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

function sendAssetResponse(channel: RTCDataChannel, id: string, response: unknown): void {
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

  for (let index = 0; index < total; index += 1) {
    channel.send(JSON.stringify({
      ...metadata,
      bodyBase64Chunk: bodyBase64.slice(index * ASSET_CHUNK_BODY_CHARS, (index + 1) * ASSET_CHUNK_BODY_CHARS),
      id,
      index,
      total,
      type: 'asset:chunk',
    }))
  }
}

export async function runHost(config: HostConfig): Promise<() => void> {
  const api = window.terminayWebRtcHost
  if (!api) throw new Error('WebRTC host bridge is unavailable.')

  const signalingAuthKey = await createSignalingAuthKey(config.signalingAuthToken)
  const peer = new RTCPeerConnection({
    iceServers: config.iceServers?.length ? config.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }],
  })
  const channels = {
    api: peer.createDataChannel('api'),
    asset: peer.createDataChannel('asset'),
    terminal: peer.createDataChannel('terminal'),
  }
  const terminalChannelId = crypto.randomUUID()
  let terminalClosed = false
  let terminalCloseReason = 'WebRTC terminal channel closed.'
  let terminalAuthenticated = false
  const seenSignalNonces = new Set<string>()
  const closeTerminal = (reason = 'WebRTC terminal channel closed.') => {
    if (terminalClosed) return
    terminalClosed = true
    api.closeTerminal(terminalChannelId, reason)
  }

  peer.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return
    void signSignalMessage(signalingAuthKey, createOutboundSignalPayload(config, {
      candidate: event.candidate.toJSON(),
      type: 'ice',
    })).then((message) => api.sendSignalMessage(message))
  })

  channels.asset.addEventListener('message', (event) => {
    void (async () => {
      const request = parseJson(event.data)
      if (!request || typeof request.id !== 'string') return
      try {
        const response = request.type === 'asset:get-manifest'
          ? await api.getAssetManifest()
          : await api.getAsset(String(request.path ?? ''))
        sendAssetResponse(channels.asset, request.id, response)
      } catch (error) {
        channels.asset.send(JSON.stringify({
          error: error instanceof Error ? error.message : 'Asset request failed.',
          id: request.id,
        }))
      }
    })()
  })

  channels.api.addEventListener('message', (event) => {
    void (async () => {
      const request = parseJson(event.data)
      if (!request || request.type !== 'api-request' || typeof request.id !== 'string') return
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
    if (terminalAuthenticated && typeof event.data === 'string') {
      api.handleTerminalMessage(terminalChannelId, event.data)
    }
  })
  channels.terminal.addEventListener('close', () => closeTerminal(terminalCloseReason))
  channels.terminal.addEventListener('error', () => closeTerminal('WebRTC terminal channel failed.'))

  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'closed' || peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
      closeTerminal(`WebRTC peer connection ${peer.connectionState}.`)
    }
  })

  peer.addEventListener('iceconnectionstatechange', () => {
    if (peer.iceConnectionState === 'closed' || peer.iceConnectionState === 'disconnected' || peer.iceConnectionState === 'failed') {
      closeTerminal(`WebRTC ICE connection ${peer.iceConnectionState}.`)
    }
  })

  const stopTerminalMessages = api.onTerminalMessage((message) => {
    if (message.channelId !== terminalChannelId || channels.terminal.readyState !== 'open') return
    channels.terminal.send(message.message)
  })
  const stopTerminalCloseRequests = api.onTerminalCloseRequest((message) => {
    if (message.channelId !== terminalChannelId) return
    const reason = message.reason || 'Remote connection closed by Terminay.'
    terminalCloseReason = reason
    if (channels.terminal.readyState === 'open' || channels.terminal.readyState === 'connecting') {
      channels.terminal.close()
    }
    closeTerminal(reason)
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
        await peer.setLocalDescription(offer)
        const signedOffer = await signSignalMessage(signalingAuthKey, createOutboundSignalPayload(config, { sdp: offer, type: 'offer' }))
        api.sendSignalMessage(signedOffer)
      } else if ((message.type === 'answer' || message.type === 'reconnect-answer') && message.sdp && typeof message.sdp === 'object') {
        rejectSignalReplay(message, seenSignalNonces)
        if (!await verifySignalMessage(signalingAuthKey, message)) return
        await peer.setRemoteDescription(message.sdp as RTCSessionDescriptionInit)
      } else if ((message.type === 'ice' || message.type === 'reconnect-ice') && message.candidate && typeof message.candidate === 'object') {
        rejectSignalReplay(message, seenSignalNonces)
        if (!await verifySignalMessage(signalingAuthKey, message)) return
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
    stopSignalMessages()
    stopTerminalMessages()
    stopTerminalCloseRequests()
    closeTerminal('WebRTC host window stopped.')
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

export function WebRtcHost() {
  useEffect(() => {
    const cleanups = new Map<string, () => void>()
    const startVersions = new Map<string, number>()
    let cancelled = false
    const start = (config: HostConfig) => {
      const key = config.roomId
      if (startVersions.has(key)) return
      const version = (startVersions.get(key) ?? 0) + 1
      startVersions.set(key, version)
      void runHost(config)
        .then((nextCleanup) => {
          if (cancelled || startVersions.get(key) !== version) {
            nextCleanup()
          } else {
            cleanups.get(key)?.()
            cleanups.set(key, nextCleanup)
          }
        })
        .catch((error) => {
          api?.updateStatus?.({
            detail: error instanceof Error ? error.message : 'WebRTC host failed to start.',
            type: 'error',
          })
        })
    }

    const api = window.terminayWebRtcHost
    const offConfig = api?.onConfig(start)
    let configPollAttempts = 0
    const pollConfig = () => {
      void api?.getConfig().then((config) => {
        if (cancelled) return
        if (config) {
          start(config)
          return
        }
        configPollAttempts += 1
        if (configPollAttempts < 40) {
          setTimeout(pollConfig, 50)
        }
      })
    }
    pollConfig()

    return () => {
      cancelled = true
      offConfig?.()
      for (const cleanup of cleanups.values()) {
        cleanup()
      }
      cleanups.clear()
    }
  }, [])

  return null
}
