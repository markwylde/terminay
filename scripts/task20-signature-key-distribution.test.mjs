import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import {
  signKeyDistribution,
  verifyDetachedArtifactSignature,
  verifyKeyDistribution,
} from './task20-signature-key-distribution.mjs'

const NOW = new Date('2026-07-28T12:00:00.000Z')
const artifact = Buffer.from('terminay-server-1.2.3.tgz')
const digest = createHash('sha256').update(artifact).digest('hex')

function fixture({ revoked = false, notAfter = '2026-08-01T00:00:00.000Z' } = {}) {
  const root = generateKeyPairSync('ed25519')
  const release = generateKeyPairSync('ed25519')
  const attacker = generateKeyPairSync('ed25519')
  const distribution = signKeyDistribution({
    version: 1,
    generatedAt: '2026-07-28T00:00:00.000Z',
    keys: [{
      keyId: 'release-2026-07',
      algorithm: 'ed25519',
      publicKey: release.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      notBefore: '2026-07-01T00:00:00.000Z',
      notAfter,
      revoked,
    }],
  }, root.privateKey)
  return { root, release, attacker, distribution }
}

test('a root-authenticated distributed key verifies the detached artifact signature', () => {
  const { root, release, distribution } = fixture()
  const trusted = verifyKeyDistribution(distribution, root.publicKey, { now: NOW })
  const signature = sign(null, artifact, release.privateKey).toString('base64')
  assert.deepEqual(
    verifyDetachedArtifactSignature({ bytes: artifact, signature, keyId: 'release-2026-07', sha256: digest }, trusted),
    { keyId: 'release-2026-07', algorithm: 'ed25519', sha256: digest },
  )
})

test('embedded-key substitution, altered distribution, revoked and expired distributed keys fail closed', () => {
  const { root, release, attacker, distribution } = fixture()
  const _signature = sign(null, artifact, release.privateKey).toString('base64')
  const trusted = verifyKeyDistribution(distribution, root.publicKey, { now: NOW })
  assert.throws(() => verifyDetachedArtifactSignature({ bytes: artifact, signature: sign(null, artifact, attacker.privateKey).toString('base64'), keyId: 'release-2026-07', sha256: digest }, trusted), /verification failed/u)
  const substituted = structuredClone(distribution)
  substituted.keys[0].publicKey = attacker.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  assert.throws(() => verifyKeyDistribution(substituted, root.publicKey, { now: NOW }), /root signature verification failed/u)

  const revoked = fixture({ revoked: true })
  const revokedTrusted = verifyKeyDistribution(revoked.distribution, revoked.root.publicKey, { now: NOW })
  assert.throws(() => verifyDetachedArtifactSignature({ bytes: artifact, signature: sign(null, artifact, revoked.release.privateKey).toString('base64'), keyId: 'release-2026-07', sha256: digest }, revokedTrusted), /revoked/u)

  const expired = fixture({ notAfter: '2026-07-27T00:00:00.000Z' })
  const expiredTrusted = verifyKeyDistribution(expired.distribution, expired.root.publicKey, { now: NOW })
  assert.throws(() => verifyDetachedArtifactSignature({ bytes: artifact, signature: sign(null, artifact, expired.release.privateKey).toString('base64'), keyId: 'release-2026-07', sha256: digest }, expiredTrusted), /validity window/u)
})

test('artifact digest substitution and non-Ed25519 release keys fail closed', () => {
  const { root, release, distribution } = fixture()
  const trusted = verifyKeyDistribution(distribution, root.publicKey, { now: NOW })
  const signature = sign(null, artifact, release.privateKey).toString('base64')
  assert.throws(
    () => verifyDetachedArtifactSignature({
      bytes: artifact,
      signature,
      keyId: 'release-2026-07',
      sha256: 'a'.repeat(64),
    }, trusted),
    /claimed SHA-256/u,
  )

  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  assert.throws(
    () => signKeyDistribution({
      version: 2,
      generatedAt: '2026-07-28T00:00:00.000Z',
      keys: [{
        keyId: 'rsa-labelled-ed25519',
        algorithm: 'ed25519',
        publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        notBefore: '2026-07-01T00:00:00.000Z',
        notAfter: '2026-08-01T00:00:00.000Z',
        revoked: false,
      }],
    }, root.privateKey),
    /not Ed25519/u,
  )
})
