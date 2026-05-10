import { createHash, randomBytes, randomUUID } from 'node:crypto'

export type WebRtcPairingPayload = {
  expiresAt: string
  pairing: {
    expiresAt: string
    sessionId: string
    token: string
  }
  pairingUrl: string
  relayJoinToken: string
  roomId: string
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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

export class WebRtcPairingManager {
  create(connectUrl: string): WebRtcPairingPayload {
    const sessionId = randomUUID()
    const pairingToken = randomBytes(32).toString('base64url')
    const relayJoinToken = randomBytes(32).toString('base64url')
    const roomId = randomUUID()
    const expiresAt = new Date(Date.now() + WEBRTC_PAIRING_TTL_MS).toISOString()
    const url = new URL(normalizeConnectUrl(connectUrl))

    url.searchParams.set('mode', 'webrtc')
    url.searchParams.set('v', '1')
    url.searchParams.set('roomId', roomId)
    url.searchParams.set('relayJoinToken', relayJoinToken)
    url.searchParams.set('relayJoinTokenHash', hashToken(relayJoinToken))
    url.searchParams.set('pairingSessionId', sessionId)
    url.searchParams.set('pairingToken', pairingToken)
    url.searchParams.set('pairingTokenHash', hashToken(pairingToken))
    url.searchParams.set('pairingExpiresAt', expiresAt)

    return {
      expiresAt,
      pairing: {
        expiresAt,
        sessionId,
        token: pairingToken,
      },
      pairingUrl: url.toString(),
      relayJoinToken,
      roomId,
    }
  }
}
