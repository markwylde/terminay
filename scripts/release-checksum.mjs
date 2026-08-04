#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { lstat, open, readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const [command, payloadPath, checksumPath] = process.argv.slice(2)

if (!['write', 'verify'].includes(command) || !payloadPath || !checksumPath || process.argv.length !== 5) {
  throw new Error('usage: release-checksum.mjs <write|verify> <payload> <checksum>')
}

const payload = await readRegularFile(payloadPath, 'payload')
const payloadName = basename(payloadPath)
if (payloadName === '.' || payloadName === '..' || payloadName.length === 0) {
  throw new Error('payload must have a basename')
}

if (command === 'write') {
  const checksum = `${sha256(payload)}  ${payloadName}\n`
  await writeNewRegularFile(checksumPath, checksum)
} else {
  const checksum = (await readRegularFile(checksumPath, 'checksum', 1024)).toString('utf8')
  const match = /^([a-f0-9]{64}) {2}([^/\\\r\n]+)\n$/u.exec(checksum)
  if (!match || match[2] !== payloadName) throw new Error('checksum sidecar is invalid')
  if (match[1] !== sha256(payload)) throw new Error('release checksum verification failed')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function readRegularFile(path, label, maximumSize = Number.MAX_SAFE_INTEGER) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumSize) {
    throw new Error(`${label} must be a bounded regular file`)
  }
  return readFile(path)
}

async function writeNewRegularFile(path, value) {
  const handle = await open(path, 'wx', 0o644)
  try {
    await handle.writeFile(value)
  } finally {
    await handle.close()
  }
}
