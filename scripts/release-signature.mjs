#!/usr/bin/env node
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { lstat, open, readFile } from 'node:fs/promises'

const [command, payloadPath, signaturePath] = process.argv.slice(2)

if (!['sign', 'verify'].includes(command) || !payloadPath || !signaturePath || process.argv.length !== 5) {
  throw new Error('usage: release-signature.mjs <sign|verify> <payload> <signature>')
}

const payload = await readRegularFile(payloadPath, 'payload')
const publicKey = readKey('TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64', createPublicKey)

if (command === 'sign') {
  const privateKey = readKey('TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64', createPrivateKey)
  const signature = sign(null, payload, privateKey)
  await writeNewRegularFile(signaturePath, signature)
  if (!verify(null, payload, publicKey, signature)) throw new Error('release signature self-verification failed')
} else {
  const signature = await readRegularFile(signaturePath, 'signature', 1_024)
  if (!verify(null, payload, publicKey, signature)) throw new Error('release signature verification failed')
}

function readKey(name, factory) {
  const encoded = process.env[name]
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 32_768) throw new Error(`${name} is required`)
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) throw new Error(`${name} must be base64-encoded PEM`)
  const key = factory(Buffer.from(encoded, 'base64'))
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${name} must contain an Ed25519 key`)
  return key
}

async function readRegularFile(path, label, maximumSize = Number.MAX_SAFE_INTEGER) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumSize) throw new Error(`${label} must be a bounded regular file`)
  return readFile(path)
}

async function writeNewRegularFile(path, bytes) {
  const handle = await open(path, 'wx', 0o644)
  try {
    await handle.writeFile(bytes)
  } finally {
    await handle.close()
  }
}
