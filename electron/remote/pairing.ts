import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

type PairingSession = {
  expiresAt: number
  id: string
  origin: string
  tokenHash: Buffer
}

type PendingPairing = {
  deviceName: string
  expiresAt: number
  origin: string
  pairingSessionId: string
  publicKeyPem: string
}

export type PairingPayload = {
  host: string
  pairingExpiresAt: string
  pairingSessionId: string
  pairingToken: string
  pairingUrl: string
}

export type PendingRegistration = {
  provisionalDeviceId: string
}

const PAIRING_TTL_MS = 10 * 60 * 1000

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export class PairingManager {
  private currentSession: PairingSession | null = null
  private readonly pendingRegistrations = new Map<string, PendingPairing>()

  create(origin: string): PairingPayload {
    const token = randomBytes(32).toString('base64url')
    const sessionId = randomUUID()
    const expiresAt = Date.now() + PAIRING_TTL_MS

    this.currentSession = {
      expiresAt,
      id: sessionId,
      origin,
      tokenHash: hashToken(token),
    }

    const pairingUrl = new URL(origin)
    pairingUrl.searchParams.set('pairingSessionId', sessionId)
    pairingUrl.searchParams.set('pairingToken', token)
    pairingUrl.searchParams.set('pairingExpiresAt', new Date(expiresAt).toISOString())

    return {
      host: pairingUrl.host,
      pairingExpiresAt: new Date(expiresAt).toISOString(),
      pairingSessionId: sessionId,
      pairingToken: token,
      pairingUrl: pairingUrl.toString(),
    }
  }

  getExpiresAt(): number | null {
    return this.currentSession?.expiresAt ?? null
  }

  startRegistration(options: {
    deviceName: string
    origin: string
    pairingSessionId: string
    pairingToken: string
    publicKeyPem: string
  }): PendingRegistration {
    const session = this.assertValidSession(options.pairingSessionId, options.pairingToken, options.origin)
    const provisionalDeviceId = randomUUID()

    this.pendingRegistrations.set(provisionalDeviceId, {
      deviceName: options.deviceName,
      expiresAt: session.expiresAt,
      origin: options.origin,
      pairingSessionId: session.id,
      publicKeyPem: options.publicKeyPem,
    })

    return {
      provisionalDeviceId,
    }
  }

  consumeRegistration(options: {
    origin: string
    provisionalDeviceId: string
  }): PendingPairing {
    const pending = this.pendingRegistrations.get(options.provisionalDeviceId)
    if (!pending) {
      throw new Error('This pairing attempt is no longer active.')
    }

    this.pendingRegistrations.delete(options.provisionalDeviceId)

    if (pending.expiresAt < Date.now()) {
      throw new Error('This pairing code has expired.')
    }

    if (pending.origin !== options.origin) {
      throw new Error('This pairing request is bound to a different origin.')
    }

    return pending
  }

  invalidateSession(pairingSessionId: string): void {
    if (this.currentSession?.id === pairingSessionId) {
      this.currentSession = null
    }
  }

  private assertValidSession(pairingSessionId: string, pairingToken: string, origin: string): PairingSession {
    const session = this.currentSession
    if (!session || session.id !== pairingSessionId) {
      throw new Error('This pairing code is no longer valid.')
    }

    if (session.expiresAt < Date.now()) {
      throw new Error('This pairing code has expired.')
    }

    if (session.origin !== origin) {
      throw new Error('This pairing code was created for a different origin.')
    }

    const tokenHash = hashToken(pairingToken)
    if (
      tokenHash.byteLength !== session.tokenHash.byteLength ||
      !timingSafeEqual(tokenHash, session.tokenHash)
    ) {
      throw new Error('This pairing code is invalid.')
    }

    return session
  }
}
