import { createHash, createHmac, generateKeyPairSync, hkdfSync, randomUUID, sign } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Main-process-only device credentials for Remote Access.  This deliberately
 * has no preload surface: renderers receive a transient key handle and auth
 * ticket, never a private key, reconnect grant, or decrypted record.
 */
export type DesktopDeviceKeyRef = Readonly<{ keyId: string }>

export type ProtectedValueCodec = Readonly<{
  /** Electron's `basic_text` backend is not OS-backed encryption. */
  backend?: () => string | undefined
  decrypt: (encrypted: Buffer) => string
  encrypt: (plainText: string) => Buffer
  isAvailable: () => boolean
}>

type StoredDeviceCredential = Readonly<{
  deviceId: string
  deviceName: string
  origin: string
  privateKeyPem: string
  publicKeyPem: string
  reconnectGrant?: string
  reconnectHandle?: string
  reconnectIssuedAt?: string
  reconnectExpiresAt?: string | null
  reconnectSessionId?: string
  schema: 1
}>

type PendingKey = Readonly<{
  origin: string
  privateKeyPem: string
  publicKeyPem: string
}>

export type PublicDesktopDeviceCredential = Readonly<{
  deviceId: string
  deviceName: string
  origin: string
  publicKeyPem: string
}>

export type ReconnectGrantForStorage = Readonly<{
  expiresAt: string | null
  grant: string
  handle: string
  issuedAt: string
  origin: string
  protocolVersion: 'v1'
	sessionId: string
}>

/**
 * Main-process shape consumed by the transport-neutral device pairing flow.
 * The private key is an opaque pending-key handle; it never crosses a preload
 * or renderer boundary.
 */
export type EstablishedDesktopDevicePairing = Readonly<{
	pairing: Readonly<{
		deviceId: string
		deviceName: string
		origin: string
		privateKey: DesktopDeviceKeyRef
		publicKeyPem: string
	}>
	reconnectGrant?: ReconnectGrantForStorage
}>

const ORIGIN_PATTERN = /^(https:|http:)$/
const PEM_MAX_LENGTH = 32_768
const SECRET_MAX_LENGTH = 65_536

function normalizeOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Remote credential origin is invalid.')
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new TypeError('Remote credential origin is invalid.') }
  const loopback = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (!ORIGIN_PATTERN.test(parsed.protocol) || (parsed.protocol !== 'https:' && !loopback)) {
    throw new TypeError('Remote credential origin must use HTTPS or loopback HTTP.')
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('Remote credential origin must be an exact origin.')
  }
  return parsed.origin
}

function assertText(value: unknown, name: string, max = SECRET_MAX_LENGTH): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new TypeError(`${name} is invalid.`)
}

function recordPath(directory: string, origin: string): string {
  return join(directory, `remote-device-${createHash('sha256').update(origin).digest('hex')}.json`)
}

function parseRecord(value: unknown, expectedOrigin: string): StoredDeviceCredential {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Remote credential record is invalid.')
  const input = value as Record<string, unknown>
  const allowed = new Set(['schema', 'origin', 'deviceId', 'deviceName', 'publicKeyPem', 'privateKeyPem', 'reconnectGrant', 'reconnectHandle', 'reconnectIssuedAt', 'reconnectExpiresAt', 'reconnectSessionId'])
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new TypeError('Remote credential record contains an unknown field.')
  if (input.schema !== 1) throw new TypeError('Remote credential record schema is invalid.')
  const origin = normalizeOrigin(input.origin)
  if (origin !== expectedOrigin) throw new TypeError('Remote credential record belongs to another origin.')
  assertText(input.deviceId, 'Remote device id', 256)
  assertText(input.deviceName, 'Remote device name', 256)
  assertText(input.publicKeyPem, 'Remote public key', PEM_MAX_LENGTH)
  assertText(input.privateKeyPem, 'Remote private key', PEM_MAX_LENGTH)
  const optionalText = (key: string, max?: number): string | undefined => {
    const candidate = input[key]
    if (candidate === undefined) return undefined
    assertText(candidate, `Remote credential ${key}`, max)
    return candidate
  }
  const reconnectKeys = ['reconnectGrant', 'reconnectHandle', 'reconnectIssuedAt', 'reconnectExpiresAt', 'reconnectSessionId']
  const reconnectFieldsPresent = reconnectKeys.filter((key) => input[key] !== undefined)
  if (reconnectFieldsPresent.length !== 0 && reconnectFieldsPresent.length !== reconnectKeys.length) {
    throw new TypeError('Remote reconnect record is incomplete.')
  }
  const reconnectExpiresAt: string | null | undefined = input.reconnectExpiresAt === undefined
    ? undefined
    : input.reconnectExpiresAt === null
      ? null
      : typeof input.reconnectExpiresAt === 'string'
        ? input.reconnectExpiresAt
        : (() => { throw new TypeError('Remote reconnect expiry is invalid.') })()
  if (reconnectFieldsPresent.length > 0) {
    if (reconnectExpiresAt !== null && (typeof reconnectExpiresAt !== 'string' || !Number.isFinite(Date.parse(reconnectExpiresAt)))) throw new TypeError('Remote reconnect expiry is invalid.')
    const issuedAt = optionalText('reconnectIssuedAt', 128)!
    if (!Number.isFinite(Date.parse(issuedAt))) throw new TypeError('Remote reconnect issued time is invalid.')
    if (typeof reconnectExpiresAt === 'string' && Date.parse(reconnectExpiresAt) < Date.parse(issuedAt)) throw new TypeError('Remote reconnect expiry precedes issuance.')
  }
  return Object.freeze({
    schema: 1,
    origin,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    publicKeyPem: input.publicKeyPem,
    privateKeyPem: input.privateKeyPem,
    ...(optionalText('reconnectGrant') === undefined ? {} : { reconnectGrant: optionalText('reconnectGrant') }),
    ...(optionalText('reconnectHandle', 1024) === undefined ? {} : { reconnectHandle: optionalText('reconnectHandle', 1024) }),
    ...(optionalText('reconnectIssuedAt', 128) === undefined ? {} : { reconnectIssuedAt: optionalText('reconnectIssuedAt', 128) }),
    ...(reconnectExpiresAt === undefined ? {} : { reconnectExpiresAt }),
    ...(optionalText('reconnectSessionId', 1024) === undefined ? {} : { reconnectSessionId: optionalText('reconnectSessionId', 1024) }),
  })
}

/** Origin-compartmented credential store backed by Electron safeStorage. */
export class DesktopDeviceCredentialStore {
  private readonly pendingKeys = new Map<string, PendingKey>()

  constructor(private readonly options: Readonly<{ directory: string; codec: ProtectedValueCodec }>) {}

  createDeviceKey(originInput: string): Readonly<{ keyRef: DesktopDeviceKeyRef; publicKeyPem: string }> {
    this.assertAvailable()
    const origin = normalizeOrigin(originInput)
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    })
    const keyId = randomUUID()
    this.pendingKeys.set(keyId, Object.freeze({ origin, privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey }))
    return Object.freeze({ keyRef: Object.freeze({ keyId }), publicKeyPem: pair.publicKey })
  }

	async savePairing(input: Readonly<{ origin: string; deviceId: string; deviceName: string; publicKeyPem: string; keyRef: DesktopDeviceKeyRef }>): Promise<void> {
		await this.saveEstablishedPairing({
			pairing: {
				origin: input.origin,
				deviceId: input.deviceId,
				deviceName: input.deviceName,
				publicKeyPem: input.publicKeyPem,
				privateKey: input.keyRef,
			},
		})
	}

	/**
	 * Persist the complete browser/desktop pairing result in one encrypted
	 * replacement.  A reconnecting client must never observe a newly paired
	 * device without the grant issued in that same protocol exchange.
	 */
	async saveEstablishedPairing(input: EstablishedDesktopDevicePairing): Promise<void> {
		this.assertAvailable()
		const origin = normalizeOrigin(input.pairing.origin)
		const pending = this.pendingKeys.get(input.pairing.privateKey?.keyId)
		if (pending === undefined || pending.origin !== origin || pending.publicKeyPem !== input.pairing.publicKeyPem) {
			throw new Error('The device key handle is invalid or belongs to another origin.')
		}
		assertText(input.pairing.deviceId, 'Remote device id', 256)
		assertText(input.pairing.deviceName, 'Remote device name', 256)
		const reconnect = input.reconnectGrant
		if (reconnect !== undefined) {
			if (normalizeOrigin(reconnect.origin) !== origin) {
				throw new Error('The reconnect grant belongs to another origin.')
			}
			assertText(reconnect.grant, 'Reconnect grant')
			assertText(reconnect.handle, 'Reconnect handle', 1024)
			assertText(reconnect.issuedAt, 'Reconnect issued time', 128)
			assertText(reconnect.sessionId, 'Reconnect session id', 1024)
			if (reconnect.protocolVersion !== 'v1') throw new TypeError('Reconnect grant protocol is invalid.')
			if (!Number.isFinite(Date.parse(reconnect.issuedAt))) throw new TypeError('Reconnect issued time is invalid.')
			if (reconnect.expiresAt !== null && !Number.isFinite(Date.parse(reconnect.expiresAt))) {
				throw new TypeError('Reconnect expiry is invalid.')
			}
			if (reconnect.expiresAt !== null && Date.parse(reconnect.expiresAt) < Date.parse(reconnect.issuedAt)) {
				throw new TypeError('Reconnect expiry precedes issuance.')
			}
		}
		await this.write(Object.freeze({
			schema: 1,
			origin,
			deviceId: input.pairing.deviceId,
			deviceName: input.pairing.deviceName,
			publicKeyPem: pending.publicKeyPem,
			privateKeyPem: pending.privateKeyPem,
			...(reconnect === undefined ? {} : this.reconnectFieldsFromGrant(reconnect)),
		}))
		this.pendingKeys.delete(input.pairing.privateKey.keyId)
	}

  async saveReconnectGrant(grant: ReconnectGrantForStorage): Promise<void> {
    this.assertAvailable()
    const origin = normalizeOrigin(grant.origin)
    assertText(grant.grant, 'Reconnect grant')
    assertText(grant.handle, 'Reconnect handle', 1024)
    assertText(grant.issuedAt, 'Reconnect issued time', 128)
    assertText(grant.sessionId, 'Reconnect session id', 1024)
    if (grant.protocolVersion !== 'v1') throw new TypeError('Reconnect grant protocol is invalid.')
    const existing = await this.readRequired(origin)
    await this.write(Object.freeze({ ...existing, ...this.reconnectFieldsFromGrant(grant) }))
  }

  async loadDevice(originInput: string): Promise<PublicDesktopDeviceCredential | null> {
    const credential = await this.read(normalizeOrigin(originInput))
    if (credential === null) return null
    // Do not accidentally widen this response: reconnect grants and key
    // material are credentials too, even though the public device label is not.
    return Object.freeze({
      origin: credential.origin,
      deviceId: credential.deviceId,
      deviceName: credential.deviceName,
      publicKeyPem: credential.publicKeyPem,
    })
  }

  async signChallenge(originInput: string, signingInput: string): Promise<string> {
    this.assertAvailable()
    assertText(signingInput, 'Device signing input')
    const credential = await this.readRequired(normalizeOrigin(originInput))
    return sign('sha256', Buffer.from(signingInput), {
      key: credential.privateKeyPem,
      padding: 6, // RSA_PKCS1_PSS_PADDING; kept numeric for Electron's Node typings.
      saltLength: 32,
    }).toString('base64url')
  }

  /** Return only the opaque reconnect handle to the privileged reconnect
   * coordinator. The grant itself remains in this encrypted record. */
  async reconnectHandle(originInput: string): Promise<string> {
    this.assertAvailable()
    const credential = await this.readRequired(normalizeOrigin(originInput))
    if (
      credential.reconnectGrant === undefined ||
      credential.reconnectHandle === undefined ||
      credential.reconnectIssuedAt === undefined ||
      credential.reconnectExpiresAt === undefined ||
      credential.reconnectSessionId === undefined
    ) {
      throw new Error('No reconnect grant exists for this paired device.')
    }
    if (credential.reconnectExpiresAt !== null && Date.parse(credential.reconnectExpiresAt) <= Date.now()) {
      throw new Error('The reconnect grant has expired. Pair this device again.')
    }
    return credential.reconnectHandle
  }

  /**
   * Produce the reconnect-grant proof wholly inside the encrypted
   * main-process credential compartment.  The caller may learn the opaque
   * handle (needed by the public challenge endpoint) and the derived proof,
   * but never the grant or private key held by this record.
   */
  async proveReconnectChallenge(originInput: string, signingInput: string): Promise<Readonly<{ handle: string; proof: string }>> {
    this.assertAvailable()
    assertText(signingInput, 'Reconnect signing input', 16_384)
    const credential = await this.readRequired(normalizeOrigin(originInput))
    const handle = await this.reconnectHandle(credential.origin)
    const grant = credential.reconnectGrant
    if (grant === undefined) throw new Error('No reconnect grant exists for this paired device.')
    const verifier = Buffer.from(hkdfSync(
      'sha256',
      Buffer.from(grant, 'base64url'),
      new Uint8Array(0),
      'terminay remote v1 reconnect proof verifier',
      32,
    )).toString('base64url')
    const proof = createHmac('sha256', Buffer.from(verifier, 'base64url'))
      .update(signingInput)
      .digest('base64url')
    return Object.freeze({ handle, proof })
  }

  async remove(originInput: string): Promise<void> {
    const origin = normalizeOrigin(originInput)
    for (const [keyId, key] of this.pendingKeys) if (key.origin === origin) this.pendingKeys.delete(keyId)
    await rm(recordPath(this.options.directory, origin), { force: true })
  }

  private reconnectFieldsFromGrant(grant: ReconnectGrantForStorage): Partial<StoredDeviceCredential> {
    return {
      reconnectGrant: grant.grant,
      reconnectHandle: grant.handle,
      reconnectIssuedAt: grant.issuedAt,
      reconnectExpiresAt: grant.expiresAt,
      reconnectSessionId: grant.sessionId,
    }
  }

  private assertAvailable(): void {
    if (!this.options.codec.isAvailable() || this.options.codec.backend?.() === 'basic_text') {
      throw new Error('OS credential encryption is not available on this system.')
    }
  }

  private async readRequired(origin: string): Promise<StoredDeviceCredential> {
    const record = await this.read(origin)
    if (record === null) throw new Error('No paired device exists for this server origin.')
    return record
  }

  private async read(origin: string): Promise<StoredDeviceCredential | null> {
    this.assertAvailable()
    const target = recordPath(this.options.directory, origin)
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Protected remote credential record is unsafe.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    let envelope: { encrypted: string; schema: 1 }
    try {
      envelope = JSON.parse(await readFile(target, 'utf8')) as { encrypted: string; schema: 1 }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('Unable to read protected remote credentials.')
    }
    if (envelope?.schema !== 1 || typeof envelope.encrypted !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(envelope.encrypted)) {
      throw new Error('Protected remote credential record is invalid.')
    }
    try {
      return parseRecord(JSON.parse(this.options.codec.decrypt(Buffer.from(envelope.encrypted, 'base64'))) as unknown, origin)
    } catch {
      throw new Error('Protected remote credential record cannot be decrypted.')
    }
  }

  private async write(record: StoredDeviceCredential): Promise<void> {
    this.assertAvailable()
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    const target = recordPath(this.options.directory, record.origin)
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Protected remote credential record is unsafe.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const envelope = JSON.stringify({ schema: 1, encrypted: this.options.codec.encrypt(JSON.stringify(record)).toString('base64') })
    const temporary = join(this.options.directory, `.${createHash('sha256').update(record.origin).digest('hex')}.${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(envelope, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }
}
