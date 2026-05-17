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
  private currentAdoptedSessionId: string | null = null
  private currentCreatedSessionId: string | null = null
  private readonly sessions = new Map<string, PairingSession>()
  private readonly pendingRegistrations = new Map<string, PendingPairing>()

  adoptSession(options: {
    expiresAt: string
    origin: string
    pairingSessionId: string
    pairingToken: string
  }): void {
    const expiresAt = Date.parse(options.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('This pairing code has expired.')
    }

    if (this.currentAdoptedSessionId) {
      this.sessions.delete(this.currentAdoptedSessionId)
    }

    this.sessions.set(options.pairingSessionId, {
      expiresAt,
      id: options.pairingSessionId,
      origin: options.origin,
      tokenHash: hashToken(options.pairingToken),
    })
    this.currentAdoptedSessionId = options.pairingSessionId
  }

  create(origin: string): PairingPayload {
    const token = randomBytes(32).toString('base64url')
    const sessionId = randomUUID()
    const expiresAt = Date.now() + PAIRING_TTL_MS

    if (this.currentCreatedSessionId) {
      this.sessions.delete(this.currentCreatedSessionId)
    }

    this.sessions.set(sessionId, {
      expiresAt,
      id: sessionId,
      origin,
      tokenHash: hashToken(token),
    })
    this.currentCreatedSessionId = sessionId

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
    return this.currentCreatedSessionId
      ? this.sessions.get(this.currentCreatedSessionId)?.expiresAt ?? null
      : null
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
    this.sessions.delete(pairingSessionId)
    if (this.currentCreatedSessionId === pairingSessionId) {
      this.currentCreatedSessionId = null
    }
    if (this.currentAdoptedSessionId === pairingSessionId) {
      this.currentAdoptedSessionId = null
    }
  }

  private assertValidSession(pairingSessionId: string, pairingToken: string, origin: string): PairingSession {
    const session = this.sessions.get(pairingSessionId)
    if (!session) {
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
