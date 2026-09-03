import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Main-process-only device credentials for Remote Access.  This deliberately
 * has no preload surface: renderers receive a transient key handle and auth
 * ticket, never a private key or decrypted record.
 */
export type DesktopDeviceKeyRef = Readonly<{ keyId: string }>

export type ProtectedValueCodec = Readonly<{
  /** Electron's `basic_text` backend is not OS-backed encryption. */
  backend?: () => string | undefined
  decrypt: (encrypted: Buffer) => string
  encrypt: (plainText: string) => Buffer
  isAvailable: () => boolean
}>

/** Authenticated process-lifetime protection for isolated Desktop automation. */
export function createEphemeralTestProtectedValueCodec(): ProtectedValueCodec {
  const key = randomBytes(32)
  return Object.freeze({
    backend: () => 'terminay_test_ephemeral',
    decrypt: (encrypted: Buffer) => {
      if (encrypted.length < 29 || encrypted[0] !== 1) throw new Error('Test credential ciphertext is invalid.')
      const nonce = encrypted.subarray(1, 13)
      const tag = encrypted.subarray(13, 29)
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(encrypted.subarray(29)), decipher.final()]).toString('utf8')
    },
    encrypt: (plainText: string) => {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
      return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext])
    },
    isAvailable: () => true,
  })
}

export type PinnedDesktopHostKey = Readonly<{
  algorithm: 'ed25519'
  publicKey: string
}>

type StoredDeviceCredential = Readonly<{
  deviceId: string
  deviceName: string
  origin: string
  privateKeyPem: string
  publicKeyPem: string
  schema: 2 | 3
  hostPin?: PinnedDesktopHostKey
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

/**
 * Main-process shape consumed by the transport-neutral device pairing flow.
 * The private key is an opaque pending-key handle; it never crosses a preload
 * or renderer boundary. The verified host pin is stored in the same encrypted
 * record as the device key.
 */
export type EstablishedDesktopDevicePairing = Readonly<{
	pairing: Readonly<{
		deviceId: string
		deviceName: string
		origin: string
		privateKey: DesktopDeviceKeyRef
		hostPin?: PinnedDesktopHostKey
	}>
}>

const ORIGIN_PATTERN = /^(https:|http:)$/
const PEM_MAX_LENGTH = 32_768
const SECRET_MAX_LENGTH = 65_536
const HOST_PIN_KEY = /^[A-Za-z0-9_-]{43}$/u

function normalizeOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Remote credential origin is invalid.')
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new TypeError('Remote credential origin is invalid.') }
  const loopback = parsed.protocol === 'http:' &&
    (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.hostname.toLowerCase().endsWith('.localhost'))
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

function parseHostPin(value: unknown): PinnedDesktopHostKey {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Remote host pin is invalid.')
  }
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).length !== 2 ||
    input.algorithm !== 'ed25519' ||
    typeof input.publicKey !== 'string' ||
    !HOST_PIN_KEY.test(input.publicKey)
  ) {
    throw new TypeError('Remote host pin is invalid.')
  }
  return Object.freeze({ algorithm: 'ed25519', publicKey: input.publicKey })
}

function parseRecord(value: unknown, expectedOrigin: string): StoredDeviceCredential {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Remote credential record is invalid.')
  const input = value as Record<string, unknown>
  const allowed = new Set(['schema', 'origin', 'deviceId', 'deviceName', 'publicKeyPem', 'privateKeyPem', 'hostPin'])
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new TypeError('Remote credential record contains an unknown field.')
  if (input.schema !== 2 && input.schema !== 3) throw new TypeError('Remote credential record schema is invalid.')
  const origin = normalizeOrigin(input.origin)
  if (origin !== expectedOrigin) throw new TypeError('Remote credential record belongs to another origin.')
  assertText(input.deviceId, 'Remote device id', 256)
  assertText(input.deviceName, 'Remote device name', 256)
  assertText(input.publicKeyPem, 'Remote public key', PEM_MAX_LENGTH)
  assertText(input.privateKeyPem, 'Remote private key', PEM_MAX_LENGTH)
  if (input.schema === 2) {
    if (input.hostPin !== undefined) throw new TypeError('Remote credential record schema is invalid.')
    return Object.freeze({
      schema: 2 as const,
      origin,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      publicKeyPem: input.publicKeyPem,
      privateKeyPem: input.privateKeyPem,
    })
  }
  return Object.freeze({
    schema: 3 as const,
    origin,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    publicKeyPem: input.publicKeyPem,
    privateKeyPem: input.privateKeyPem,
    hostPin: parseHostPin(input.hostPin),
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

	/** Persist the device key, public registration, and verified host pin in one encrypted record. */
	async saveDeviceIdentity(input: EstablishedDesktopDevicePairing['pairing']): Promise<void> {
		this.assertAvailable()
		const origin = normalizeOrigin(input.origin)
		const pending = this.pendingKeys.get(input.privateKey?.keyId)
		if (pending === undefined || pending.origin !== origin) {
			throw new Error('The device key handle is invalid or belongs to another origin.')
		}
		assertText(input.deviceId, 'Remote device id', 256)
		assertText(input.deviceName, 'Remote device name', 256)
		const hostPin = input.hostPin === undefined ? undefined : parseHostPin(input.hostPin)
		await this.write(Object.freeze({
			schema: hostPin === undefined ? 2 : 3,
			origin,
			deviceId: input.deviceId,
			deviceName: input.deviceName,
			publicKeyPem: pending.publicKeyPem,
			privateKeyPem: pending.privateKeyPem,
			...(hostPin === undefined ? {} : { hostPin }),
		}))
		this.pendingKeys.delete(input.privateKey.keyId)
	}

  /**
   * Atomically rewrite the origin's credential with the verified host pin.
   * A changed pin is an explicit server identity change, not a silent rotation.
   */
  async pinHostKey(originInput: string, hostPin: PinnedDesktopHostKey): Promise<void> {
    this.assertAvailable()
    const origin = normalizeOrigin(originInput)
    const pin = parseHostPin(hostPin)
    const credential = await this.readRequired(origin)
    if (credential.hostPin !== undefined &&
      (credential.hostPin.algorithm !== pin.algorithm || credential.hostPin.publicKey !== pin.publicKey)) {
      throw new Error('Server host identity changed; explicit re-pairing is required.')
    }
    await this.write(Object.freeze({
      ...credential,
      schema: 3 as const,
      hostPin: pin,
    }))
  }

  async loadPinnedHostKey(originInput: string): Promise<PinnedDesktopHostKey | null> {
    const credential = await this.read(normalizeOrigin(originInput))
    if (credential === null) return null
    return credential.hostPin === undefined ? null : credential.hostPin
  }

  async loadDevice(originInput: string): Promise<PublicDesktopDeviceCredential | null> {
    const credential = await this.read(normalizeOrigin(originInput))
    if (credential === null) return null
    // Do not accidentally widen this response: key material remains private.
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

  async remove(originInput: string): Promise<void> {
    const origin = normalizeOrigin(originInput)
    for (const [keyId, key] of this.pendingKeys) if (key.origin === origin) this.pendingKeys.delete(keyId)
    await rm(recordPath(this.options.directory, origin), { force: true })
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
    let envelope: { encrypted: string; schema: 2 }
    try {
      envelope = JSON.parse(await readFile(target, 'utf8')) as { encrypted: string; schema: 2 }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('Unable to read protected remote credentials.')
    }
    if (envelope?.schema !== 2 || typeof envelope.encrypted !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(envelope.encrypted)) {
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
    const envelope = JSON.stringify({ schema: 2, encrypted: this.options.codec.encrypt(JSON.stringify(record)).toString('base64') })
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
