import { createHash, randomBytes, randomUUID } from 'node:crypto'

export type WebRtcPairingPayload = {
  appOrigin: string
  expiresAt: string
  pairing: {
    expiresAt: string
    sessionId: string
    token: string
  }
  pairingUrl: string
  relayJoinToken: string
  relayJoinTokenHash: string
  roomId: string
  signalingAuthToken: string
  signalingUrl: string
}

const WEBRTC_PAIRING_TTL_MS = 10 * 60 * 1000
const DEFAULT_WEBRTC_CONNECT_URL = 'https://app.terminay.com/connect'

function normalizeConnectUrl(connectUrl: string): string {
  const url = new URL(connectUrl.trim() || DEFAULT_WEBRTC_CONNECT_URL)
  if (url.protocol !== 'https:') {
    throw new Error('WebRTC connect URL must use https://')
  }

  url.search = ''
  url.hash = ''
  return url.toString()
}

function createSignalingUrl(connectUrl: string): string {
  const url = new URL(connectUrl)
  url.protocol = 'wss:'
  url.pathname = '/signal'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function createAppOrigin(connectUrl: string): string {
  return new URL(connectUrl).origin
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

export class WebRtcPairingManager {
  create(connectUrl: string): WebRtcPairingPayload {
    const sessionId = randomUUID()
    const pairingToken = randomBytes(32).toString('base64url')
    const relayJoinToken = randomBytes(32).toString('base64url')
    const relayJoinTokenHash = hashToken(relayJoinToken)
    const signalingAuthToken = randomBytes(32).toString('base64url')
    const roomId = randomUUID()
    const expiresAt = new Date(Date.now() + WEBRTC_PAIRING_TTL_MS).toISOString()
    const normalizedConnectUrl = normalizeConnectUrl(connectUrl)
    const url = new URL(normalizedConnectUrl)
    const signalingUrl = createSignalingUrl(normalizedConnectUrl)
    const appOrigin = createAppOrigin(normalizedConnectUrl)

    url.searchParams.set('mode', 'webrtc')
    url.searchParams.set('v', '1')
    url.searchParams.set('roomId', roomId)
    if (signalingUrl !== 'wss://app.terminay.com/signal') {
      url.searchParams.set('signalingUrl', signalingUrl)
    }
    const fragment = new URLSearchParams()
    fragment.set('relayJoinToken', relayJoinToken)
    fragment.set('pairingSessionId', sessionId)
    fragment.set('pairingToken', pairingToken)
    fragment.set('pairingExpiresAt', expiresAt)
    fragment.set('signalingAuthToken', signalingAuthToken)
    url.hash = fragment.toString()

    return {
      appOrigin,
      expiresAt,
      pairing: {
        expiresAt,
        sessionId,
        token: pairingToken,
      },
      pairingUrl: url.toString(),
      relayJoinToken,
      relayJoinTokenHash,
      roomId,
      signalingAuthToken,
      signalingUrl,
    }
  }
}
