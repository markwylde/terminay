import { createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type ReconnectGrantLifetime = '1h' | '24h' | '7d' | 'until-revoked'

export type ReconnectGrantRecord = {
  createdAt: string
  deviceId: string
  expiresAt: string | null
  grantHash: string
  handle: string
  id: string
  label: string
  lastUsedAt: string | null
  origin: string
  proofVerifier: string
  protocolVersion: 'v1'
  revokedAt: string | null
  rotatedFromHandle: string | null
  sessionId: string
  updatedAt: string
}

export type IssuedReconnectGrant = {
  expiresAt: string | null
  grant: string
  handle: string
  issuedAt: string
  origin: string
  protocolVersion: 'v1'
  sessionId: string
}

export type ReconnectChallengePayload = {
  action: 'reconnect'
  attemptId: string
  clientNonce: string
  expiresAt: string
  handle: string
  issuedAt: string
  nonce: string
  origin: string
  protocolVersion: 'v1'
  sessionId: string
}

export type ReconnectGrantSummary = {
  expiresAt: string | null
  handle: string | null
  label: string | null
  lastUsedAt: string | null
  status: 'none' | 'valid' | 'expired' | 'revoked'
}

type PendingReconnectAttempt = {
  clientNonce: string
  expiresAt: number
  grantId: string
  payload: ReconnectChallengePayload
  signingInput: string
}

const CHALLENGE_TTL_MS = 60 * 1000
const GRANT_SECRET_BYTES = 32
const HANDLE_BYTES = 32
const PROTOCOL_VERSION = 'v1'
const RECONNECT_CHALLENGE_DOMAIN = 'terminay\u0000v1\u0000reconnect-challenge\u0000'
const MAX_PENDING_ATTEMPTS = 64
const MAX_PENDING_ATTEMPTS_PER_SESSION = 4
const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PERSISTED_TEXT_LENGTH = 4_096

const LIFETIME_MS: Record<Exclude<ReconnectGrantLifetime, 'until-revoked'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

export function resolveReconnectGrantLifetime(value: string | null | undefined): ReconnectGrantLifetime {
  return value === '1h' || value === '24h' || value === '7d' || value === 'until-revoked' ? value : '24h'
}

export function serializeReconnectChallenge(payload: ReconnectChallengePayload): string {
  return RECONNECT_CHALLENGE_DOMAIN + JSON.stringify({
    action: payload.action,
    attemptId: payload.attemptId,
    clientNonce: payload.clientNonce,
    expiresAt: payload.expiresAt,
    handle: payload.handle,
    issuedAt: payload.issuedAt,
    nonce: payload.nonce,
    origin: payload.origin,
    protocolVersion: payload.protocolVersion,
    sessionId: payload.sessionId,
  })
}

export function createReconnectProof(grant: string, signingInput: string): string {
  return createHmac('sha256', deriveProofVerifier(grant)).update(signingInput).digest('base64url')
}

function hashGrant(grant: string): string {
  return createHash('sha256').update(grant).digest('base64url')
}

function deriveProofVerifier(grant: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(grant, 'base64url'),
      Buffer.alloc(0),
      'terminay remote v1 reconnect proof verifier',
      32,
    ),
  )
}

function createSecret(): string {
  return randomBytes(GRANT_SECRET_BYTES).toString('base64url')
}

function createHandle(): string {
  return randomBytes(HANDLE_BYTES).toString('base64url')
}

function resolveExpiresAt(issuedAtMs: number, lifetime: ReconnectGrantLifetime): string | null {
  if (lifetime === 'until-revoked') {
    return null
  }

  return new Date(issuedAtMs + LIFETIME_MS[lifetime]).toISOString()
}

function compareBase64Url(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'base64url')
  const actualBytes = Buffer.from(actual, 'base64url')
  return expectedBytes.byteLength === actualBytes.byteLength && timingSafeEqual(expectedBytes, actualBytes)
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PERSISTED_TEXT_LENGTH
}

function isBoundedLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PERSISTED_TEXT_LENGTH
}

function isValidTimestamp(value: unknown): value is string {
  return isBoundedText(value) && Number.isFinite(Date.parse(value))
}

function isPersistedGrant(value: unknown): value is ReconnectGrantRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const grant = value as Partial<ReconnectGrantRecord>
  if (
    !isValidTimestamp(grant.createdAt) ||
    !isValidTimestamp(grant.updatedAt) ||
    !isBoundedText(grant.deviceId) ||
    !isBoundedText(grant.origin) ||
    !isBoundedText(grant.sessionId) ||
    !isBoundedLabel(grant.label) ||
    !UUID_PATTERN.test(grant.id ?? '') ||
    !BASE64URL_32_BYTE_PATTERN.test(grant.handle ?? '') ||
    !BASE64URL_32_BYTE_PATTERN.test(grant.grantHash ?? '') ||
    !BASE64URL_32_BYTE_PATTERN.test(grant.proofVerifier ?? '') ||
    grant.protocolVersion !== PROTOCOL_VERSION
  ) {
    return false
  }
  if (grant.expiresAt !== null && !isValidTimestamp(grant.expiresAt)) return false
  if (grant.lastUsedAt !== null && !isValidTimestamp(grant.lastUsedAt)) return false
  if (grant.revokedAt !== null && !isValidTimestamp(grant.revokedAt)) return false
  if (
    grant.rotatedFromHandle !== null &&
    (typeof grant.rotatedFromHandle !== 'string' || !BASE64URL_32_BYTE_PATTERN.test(grant.rotatedFromHandle))
  ) return false
  return true
}

function isPersistedHostRegistrationToken(value: unknown): value is string {
  return typeof value === 'string' && BASE64URL_32_BYTE_PATTERN.test(value)
}

export class ReconnectGrantStore {
  private readonly attempts = new Map<string, PendingReconnectAttempt>()
  private grants = new Map<string, ReconnectGrantRecord>()
  private hostRegistrationTokens = new Map<string, string>()

  constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as
        | ReconnectGrantRecord[]
        | { grants?: ReconnectGrantRecord[]; hostRegistrationTokens?: Record<string, string> }
      const grants = Array.isArray(parsed) ? parsed : parsed.grants
      const validGrants = Array.isArray(grants) ? grants.filter(isPersistedGrant) : []
      const uniqueGrants = validGrants.filter((grant, index, records) =>
        records.findIndex((candidate) => candidate.id === grant.id || candidate.handle === grant.handle) === index,
      )
      this.grants = new Map(uniqueGrants.map((grant) => [grant.id, grant]))
      this.hostRegistrationTokens = new Map(
        !Array.isArray(parsed) && parsed.hostRegistrationTokens
          ? Object.entries(parsed.hostRegistrationTokens).filter(([sessionId, token]) =>
            isBoundedText(sessionId) && isPersistedHostRegistrationToken(token),
          )
          : [],
      )
    } catch {
      this.grants = new Map()
      this.hostRegistrationTokens = new Map()
    }
  }

  listActive(): ReconnectGrantRecord[] {
    return Array.from(this.grants.values()).filter((grant) => this.isGrantUsable(grant))
  }

  getSummaryForDevice(deviceId: string): ReconnectGrantSummary {
    const grants = Array.from(this.grants.values())
      .filter((grant) => grant.deviceId === deviceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const grant = grants[0]
    if (!grant) {
      return { expiresAt: null, handle: null, label: null, lastUsedAt: null, status: 'none' }
    }

    return {
      expiresAt: grant.expiresAt,
      handle: grant.revokedAt ? null : grant.handle,
      label: grant.label || null,
      lastUsedAt: grant.lastUsedAt,
      status: this.getGrantStatus(grant),
    }
  }

  async issueGrant(options: {
    deviceId: string
    label?: string | null
    lifetime?: ReconnectGrantLifetime | string | null
    origin: string
    rotatedFromHandle?: string | null
    sessionId: string
  }): Promise<IssuedReconnectGrant> {
    const issuedAt = this.now()
    const grantSecret = createSecret()
    const record: ReconnectGrantRecord = {
      createdAt: issuedAt.toISOString(),
      deviceId: options.deviceId,
      expiresAt: resolveExpiresAt(issuedAt.getTime(), resolveReconnectGrantLifetime(options.lifetime)),
      grantHash: hashGrant(grantSecret),
      handle: createHandle(),
      id: randomUUID(),
      label: options.label?.trim() || '',
      lastUsedAt: null,
      origin: options.origin,
      proofVerifier: deriveProofVerifier(grantSecret).toString('base64url'),
      protocolVersion: PROTOCOL_VERSION,
      revokedAt: null,
      rotatedFromHandle: options.rotatedFromHandle ?? null,
      sessionId: options.sessionId,
      updatedAt: issuedAt.toISOString(),
    }

    for (const existing of this.grants.values()) {
      if (existing.deviceId === options.deviceId && existing.origin === options.origin && existing.revokedAt === null) {
        existing.revokedAt = issuedAt.toISOString()
        existing.updatedAt = issuedAt.toISOString()
      }
    }

    this.grants.set(record.id, record)
    await this.persist()

    return {
      expiresAt: record.expiresAt,
      grant: grantSecret,
      handle: record.handle,
      issuedAt: record.createdAt,
      origin: record.origin,
      protocolVersion: record.protocolVersion,
      sessionId: record.sessionId,
    }
  }

  async createChallenge(options: {
    clientNonce: string
    handle: string
    origin: string
    sessionId?: string | null
  }): Promise<{ payload: ReconnectChallengePayload; signingInput: string }> {
    const grant = this.requireUsableGrantByHandle(options.handle, options.origin, options.sessionId)
    const issuedAt = this.now()
    this.pruneAttempts(issuedAt.getTime())
    const attemptsForSession = Array.from(this.attempts.values())
      .filter((attempt) => attempt.payload.sessionId === grant.sessionId)
      .length
    if (
      this.attempts.size >= MAX_PENDING_ATTEMPTS ||
      attemptsForSession >= MAX_PENDING_ATTEMPTS_PER_SESSION
    ) {
      throw new Error('Too many reconnect challenges are active. Retry after an existing attempt expires.')
    }
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS)
    const payload: ReconnectChallengePayload = {
      action: 'reconnect',
      attemptId: randomUUID(),
      clientNonce: options.clientNonce,
      expiresAt: expiresAt.toISOString(),
      handle: grant.handle,
      issuedAt: issuedAt.toISOString(),
      nonce: randomBytes(24).toString('base64url'),
      origin: grant.origin,
      protocolVersion: grant.protocolVersion,
      sessionId: grant.sessionId,
    }
    const signingInput = serializeReconnectChallenge(payload)

    this.attempts.set(payload.attemptId, {
      clientNonce: options.clientNonce,
      expiresAt: expiresAt.getTime(),
      grantId: grant.id,
      payload,
      signingInput,
    })

    return { payload, signingInput }
  }

  async getOrCreateHostRegistrationToken(sessionId: string): Promise<string> {
    const existing = this.hostRegistrationTokens.get(sessionId)
    if (existing) return existing
    const token = createSecret()
    this.hostRegistrationTokens.set(sessionId, token)
    await this.persist()
    return token
  }

  cancelChallenge(attemptId: string): void {
    this.attempts.delete(attemptId)
  }

  async verifyProof(options: {
    attemptId: string
    clientNonce: string
    handle: string
    lifetime?: ReconnectGrantLifetime | string | null
    origin: string
    proof: string
    verifyDeviceProof?: (deviceId: string, signingInput: string) => boolean
  }): Promise<ReconnectGrantRecord> {
    const attempt = this.attempts.get(options.attemptId)
    if (!attempt) {
      throw new Error('This reconnect challenge is no longer valid.')
    }
    if (attempt.expiresAt < this.now().getTime()) {
      this.attempts.delete(options.attemptId)
      throw new Error('This reconnect challenge has expired.')
    }

    const grant = this.grants.get(attempt.grantId)
    if (!grant || !this.isGrantUsable(grant)) {
      throw new Error('This reconnect grant is no longer valid.')
    }

    if (
      grant.handle !== options.handle ||
      grant.origin !== options.origin ||
      attempt.clientNonce !== options.clientNonce ||
      attempt.payload.handle !== options.handle ||
      attempt.payload.origin !== options.origin
    ) {
      throw new Error('This reconnect proof does not match this grant or origin.')
    }

    const expectedProof = createHmac('sha256', Buffer.from(grant.proofVerifier, 'base64url'))
      .update(attempt.signingInput)
      .digest('base64url')

    if (!compareBase64Url(expectedProof, options.proof)) {
      throw new Error('This reconnect proof is invalid.')
    }
    if (options.verifyDeviceProof && !options.verifyDeviceProof(grant.deviceId, attempt.signingInput)) {
      throw new Error('This reconnect device-key proof is invalid.')
    }

    this.attempts.delete(options.attemptId)
    const verifiedAt = this.now()
    grant.lastUsedAt = verifiedAt.toISOString()
    if (options.lifetime !== undefined) {
      grant.expiresAt = resolveExpiresAt(verifiedAt.getTime(), resolveReconnectGrantLifetime(options.lifetime))
    }
    grant.updatedAt = grant.lastUsedAt
    await this.persist()
    return grant
  }

  async rotateGrant(options: {
    handle: string
    lifetime?: ReconnectGrantLifetime | string | null
    origin: string
  }): Promise<IssuedReconnectGrant> {
    const existing = this.requireUsableGrantByHandle(options.handle, options.origin)
    return this.issueGrant({
      deviceId: existing.deviceId,
      lifetime: options.lifetime,
      origin: existing.origin,
      rotatedFromHandle: existing.handle,
      sessionId: existing.sessionId,
    })
  }

  async revokeForDevice(deviceId: string): Promise<void> {
    const revokedAt = this.now().toISOString()
    let changed = false

    for (const grant of this.grants.values()) {
      if (grant.deviceId === deviceId && grant.revokedAt === null) {
        grant.revokedAt = revokedAt
        grant.updatedAt = revokedAt
        changed = true
      }
    }

    if (changed) {
      await this.persist()
    }
  }

  private requireUsableGrantByHandle(handle: string, origin: string, sessionId?: string | null): ReconnectGrantRecord {
    const grant = Array.from(this.grants.values()).find((candidate) => candidate.handle === handle)
    if (!grant || !this.isGrantUsable(grant)) {
      throw new Error('This reconnect grant is no longer valid.')
    }

    if (grant.origin !== origin) {
      throw new Error('This reconnect grant is bound to a different origin.')
    }

    if (sessionId && grant.sessionId !== sessionId) {
      throw new Error('This reconnect grant is bound to a different session.')
    }

    return grant
  }

  private getGrantStatus(grant: ReconnectGrantRecord): ReconnectGrantSummary['status'] {
    if (grant.revokedAt) {
      return 'revoked'
    }

    if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= this.now().getTime()) {
      return 'expired'
    }

    return 'valid'
  }

  private isGrantUsable(grant: ReconnectGrantRecord): boolean {
    return this.getGrantStatus(grant) === 'valid'
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify({
      grants: Array.from(this.grants.values()),
      hostRegistrationTokens: Object.fromEntries(this.hostRegistrationTokens),
    }, null, 2), { encoding: 'utf8', mode: 0o600 })
  }

  private pruneAttempts(now: number): void {
    for (const [attemptId, attempt] of this.attempts) {
      if (attempt.expiresAt <= now) this.attempts.delete(attemptId)
    }
  }
}
