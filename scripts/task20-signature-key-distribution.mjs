import {
  createHash,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto'

const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SHA256 = /^[a-f0-9]{64}$/u

/**
 * Canonical bytes for a distributed signing-key document.  The root signature
 * deliberately excludes itself: callers must verify those exact bytes with a
 * separately distributed root key before trusting any release key in it.
 */
export function canonicalKeyDistribution({ version, generatedAt, keys }) {
  validateDistributionFields({ version, generatedAt, keys })
  return Buffer.from(`${JSON.stringify({
    version,
    generatedAt,
    keys: [...keys]
      .map((key) => ({ ...key }))
      .sort((left, right) => left.keyId.localeCompare(right.keyId)),
  })}\n`)
}

export function signKeyDistribution(distribution, rootPrivateKey) {
  const canonical = canonicalKeyDistribution(distribution)
  return Object.freeze({
    ...JSON.parse(canonical.toString('utf8')),
    rootAlgorithm: 'ed25519',
    rootSignature: sign(null, canonical, rootPrivateKey).toString('base64'),
  })
}

/** Verify the root-signed keyring before resolving a release signing key. */
export function verifyKeyDistribution(signedDistribution, rootPublicKey, { now = new Date() } = {}) {
  if (!signedDistribution || typeof signedDistribution !== 'object') throw new TypeError('key distribution is required')
  if (signedDistribution.rootAlgorithm !== 'ed25519' || typeof signedDistribution.rootSignature !== 'string') {
    throw new Error('key distribution root signature metadata is invalid')
  }
  const distribution = {
    version: signedDistribution.version,
    generatedAt: signedDistribution.generatedAt,
    keys: signedDistribution.keys,
  }
  const canonical = canonicalKeyDistribution(distribution)
  if (!verify(null, canonical, rootPublicKey, Buffer.from(signedDistribution.rootSignature, 'base64'))) {
    throw new Error('key distribution root signature verification failed')
  }
  const instant = requireInstant(now, 'verification time')
  const keys = new Map()
  for (const key of distribution.keys) {
    const notBefore = requireInstant(key.notBefore, `key ${key.keyId} notBefore`)
    const notAfter = requireInstant(key.notAfter, `key ${key.keyId} notAfter`)
    if (notAfter <= notBefore) throw new Error(`key validity window is invalid: ${key.keyId}`)
    keys.set(key.keyId, Object.freeze({ ...key, notBefore, notAfter }))
  }
  return Object.freeze({ version: distribution.version, generatedAt: distribution.generatedAt, keys, now: instant })
}

/**
 * Verify a detached Ed25519 release signature against the root-authenticated
 * keyring. The key bundled beside an artifact is never consulted.
 */
export function verifyDetachedArtifactSignature({ bytes, signature, keyId, sha256 }, trustedDistribution) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError('artifact bytes are required')
  if (typeof signature !== 'string' || signature.length === 0) throw new TypeError('artifact signature is required')
  if (!KEY_ID.test(keyId ?? '')) throw new TypeError('artifact key id is invalid')
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new TypeError('artifact SHA-256 is invalid')
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')
  if (actualSha256 !== sha256) throw new Error('artifact bytes do not match the claimed SHA-256')
  if (!trustedDistribution?.keys || !(trustedDistribution.keys instanceof Map)) throw new TypeError('verified key distribution is required')
  const key = trustedDistribution.keys.get(keyId)
  if (!key) throw new Error(`artifact signing key is not distributed: ${keyId}`)
  if (key.revoked === true) throw new Error(`artifact signing key is revoked: ${keyId}`)
  if (trustedDistribution.now < key.notBefore || trustedDistribution.now > key.notAfter) {
    throw new Error(`artifact signing key is outside its validity window: ${keyId}`)
  }
  if (!verify(null, bytes, key.publicKey, Buffer.from(signature, 'base64'))) {
    throw new Error(`artifact detached signature verification failed: ${keyId}`)
  }
  return Object.freeze({ keyId, algorithm: 'ed25519', sha256 })
}

function validateDistributionFields({ version, generatedAt, keys }) {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('key distribution version is invalid')
  requireInstant(generatedAt, 'key distribution generatedAt')
  if (!Array.isArray(keys) || keys.length === 0) throw new TypeError('key distribution keys are required')
  const ids = new Set()
  for (const key of keys) {
    if (!key || typeof key !== 'object' || !KEY_ID.test(key.keyId ?? '') || ids.has(key.keyId)) throw new TypeError('key distribution key id is invalid')
    ids.add(key.keyId)
    if (key.algorithm !== 'ed25519' || typeof key.publicKey !== 'string' || key.publicKey.length === 0 || typeof key.revoked !== 'boolean') {
      throw new TypeError(`key distribution key metadata is invalid: ${key.keyId}`)
    }
    const publicKey = createPublicKey(key.publicKey)
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new TypeError(`key distribution public key is not Ed25519: ${key.keyId}`)
    }
    requireInstant(key.notBefore, `key ${key.keyId} notBefore`)
    requireInstant(key.notAfter, `key ${key.keyId} notAfter`)
  }
}

function requireInstant(value, label) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) throw new TypeError(`${label} is invalid`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw new TypeError(`${label} is invalid`)
  return parsed
}
