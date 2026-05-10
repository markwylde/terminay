import { useEffect } from 'react'

type HostConfig = {
  appOrigin: string
  expiresAt: string
  relayJoinTokenHash: string
  roomId: string
  signalingAuthToken: string
  signalingUrl: string
}

type HostApi = {
  attachTerminal(channelId: string, ticket: string): Promise<void>
  closeTerminal(channelId: string): void
  getAsset(path: string): Promise<unknown>
  getAssetManifest(): Promise<unknown>
  getConfig(): Promise<HostConfig | null>
  handleApiRequest(pathname: string, body: Record<string, unknown>, appOrigin: string): Promise<unknown>
  handleTerminalMessage(channelId: string, message: string): void
  onConfig(listener: (config: HostConfig) => void): () => void
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

function canonicalSignalPayload(message: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {
    roomId: message.roomId,
    type: message.type,
  }
  if ('candidate' in message) payload.candidate = message.candidate
  if ('sdp' in message) payload.sdp = message.sdp
  return JSON.stringify(payload)
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
  const signature = await crypto.subtle.sign('HMAC', authKey, new TextEncoder().encode(canonicalSignalPayload(message)))
  return { ...message, signature: bytesToBase64Url(signature) }
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

async function runHost(config: HostConfig): Promise<() => void> {
  const api = window.terminayWebRtcHost
  if (!api) throw new Error('WebRTC host bridge is unavailable.')

  const socket = new WebSocket(config.signalingUrl)
  const signalingAuthKey = await createSignalingAuthKey(config.signalingAuthToken)
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  })
  const channels = {
    api: peer.createDataChannel('api'),
    asset: peer.createDataChannel('asset'),
    terminal: peer.createDataChannel('terminal'),
  }
  const terminalChannelId = crypto.randomUUID()

  peer.addEventListener('icecandidate', (event) => {
    if (!event.candidate || socket.readyState !== WebSocket.OPEN) return
    void signSignalMessage(signalingAuthKey, {
      candidate: event.candidate.toJSON(),
      roomId: config.roomId,
      type: 'ice',
    }).then((message) => socket.send(JSON.stringify(message)))
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
      void api.attachTerminal(terminalChannelId, request.ticket).catch((error) => {
        channels.terminal.send(JSON.stringify({
          message: error instanceof Error ? error.message : 'Terminal authentication failed.',
          type: 'error',
        }))
      })
      return
    }
    if (typeof event.data === 'string') {
      api.handleTerminalMessage(terminalChannelId, event.data)
    }
  })
  channels.terminal.addEventListener('close', () => api.closeTerminal(terminalChannelId))

  const stopTerminalMessages = api.onTerminalMessage((message) => {
    if (message.channelId !== terminalChannelId || channels.terminal.readyState !== 'open') return
    channels.terminal.send(message.message)
  })

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      expiresAt: config.expiresAt,
      relayJoinTokenHash: config.relayJoinTokenHash,
      roomId: config.roomId,
      type: 'host-ready',
    }))
  })

  socket.addEventListener('message', (event) => {
    void (async () => {
      const message = parseJson(event.data)
      if (!message) return
      if (message.type === 'client-join') {
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        const signedOffer = await signSignalMessage(signalingAuthKey, { roomId: config.roomId, sdp: offer, type: 'offer' })
        socket.send(JSON.stringify(signedOffer))
      } else if (message.type === 'answer' && message.sdp && typeof message.sdp === 'object') {
        if (!await verifySignalMessage(signalingAuthKey, message)) return
        await peer.setRemoteDescription(message.sdp as RTCSessionDescriptionInit)
      } else if (message.type === 'ice' && message.candidate && typeof message.candidate === 'object') {
        if (!await verifySignalMessage(signalingAuthKey, message)) return
        await peer.addIceCandidate(message.candidate as RTCIceCandidateInit)
      }
    })()
  })

  return () => {
    stopTerminalMessages()
    api.closeTerminal(terminalChannelId)
    socket.close()
    peer.close()
  }
}

export function WebRtcHost() {
  useEffect(() => {
    let cleanup: (() => void) | null = null
    let cancelled = false
    const start = (config: HostConfig) => {
      cleanup?.()
      void runHost(config).then((nextCleanup) => {
        if (cancelled) {
          nextCleanup()
        } else {
          cleanup = nextCleanup
        }
      })
    }

    const api = window.terminayWebRtcHost
    const offConfig = api?.onConfig(start)
    void api?.getConfig().then((config) => {
      if (config) start(config)
    })

    return () => {
      cancelled = true
      offConfig?.()
      cleanup?.()
    }
  }, [])

  return null
}
