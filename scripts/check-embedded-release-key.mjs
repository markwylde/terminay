#!/usr/bin/env node
import { createPublicKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * The `terminay` CLI verifies every downloaded archive against a public key
 * committed to its own source, because an operator running `npx terminay` has
 * nothing else to trust. That embedded key must be the key the release
 * pipeline signs with: if the two ever diverge, every install of that release
 * fails verification on the operator's machine, where it is hardest to
 * diagnose. This check moves that failure into the release job.
 */

export const EMBEDDED_KEY_SOURCE = 'apps/terminay-cli/src/verify.ts'

const PEM = /-----BEGIN PUBLIC KEY-----[\sA-Za-z0-9+/=]*?-----END PUBLIC KEY-----/u

export function extractEmbeddedKey(source) {
  const match = PEM.exec(source)
  if (match === null) throw new Error(`no public key is embedded in ${EMBEDDED_KEY_SOURCE}`)
  if (PEM.exec(source.slice(match.index + match[0].length)) !== null) {
    throw new Error(`more than one public key is embedded in ${EMBEDDED_KEY_SOURCE}`)
  }
  return match[0]
}

/** Compare by key material, not by text: PEM whitespace is not significant. */
function fingerprint(pem) {
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('release signing keys must be Ed25519')
  return key.export({ type: 'spki', format: 'der' }).toString('base64')
}

export function assertEmbeddedKeyMatches(source, publicKeyB64) {
  if (typeof publicKeyB64 !== 'string' || publicKeyB64.length === 0) {
    throw new Error('TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64 is required')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(publicKeyB64) || publicKeyB64.length % 4 !== 0) {
    throw new Error('TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64 must be base64-encoded PEM')
  }
  const embedded = fingerprint(extractEmbeddedKey(source))
  const signing = fingerprint(Buffer.from(publicKeyB64, 'base64').toString('utf8'))
  if (embedded !== signing) {
    throw new Error(
      `the key embedded in ${EMBEDDED_KEY_SOURCE} is not the release signing key; every install of this release would refuse its own archives`,
    )
  }
  return embedded
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const source = await readFile(resolve(process.cwd(), EMBEDDED_KEY_SOURCE), 'utf8')
  const fingerprinted = assertEmbeddedKeyMatches(source, process.env.TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64)
  console.log(`Embedded CLI release key matches the signing key (${fingerprinted})`)
}
