import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build, transform } from 'esbuild'

const { createPairingPinHash } = await importTransformed('../electron/remote/pin.ts')
const {
  assertPairingPin,
  resetPairingPinFailuresForTests,
} = await importTransformed('../electron/remote/pinGuard.ts')

test('PIN guard accepts correct PIN and rejects wrong or missing PIN uniformly', () => {
  resetPairingPinFailuresForTests()
  const settings = createSettings(createPairingPinHash('123456'))

  assert.doesNotThrow(() => assertPairingPin(settings, '123456'))
  assert.throws(() => assertPairingPin(settings, '000000'), /Pairing failed/)
  assert.throws(() => assertPairingPin(settings, undefined), /Pairing failed/)
})

test('PIN guard requires configured PIN for WebRTC without revealing session validity', () => {
  resetPairingPinFailuresForTests()

  assert.doesNotThrow(() => assertPairingPin(createSettings(''), undefined))
  assert.throws(
    () => assertPairingPin(createSettings(''), undefined, { requireConfigured: true }),
    /Pairing failed/,
  )
})

test('PIN guard rate-limits repeated failures', () => {
  resetPairingPinFailuresForTests()
  const settings = createSettings(createPairingPinHash('123456'))
  const now = Date.now()

  for (let index = 0; index < 5; index += 1) {
    assert.throws(() => assertPairingPin(settings, '000000', { now }), /Pairing failed/)
  }
  assert.throws(() => assertPairingPin(settings, '123456', { now }), /Pairing failed/)
  assert.doesNotThrow(() => assertPairingPin(settings, '123456', { now: now + 61000 }))
})

function createSettings(pairingPinHash) {
  return {
    bindAddress: '0.0.0.0',
    origin: 'https://localhost:9443',
    pairingMode: 'webrtc',
    pairingPinHash,
    tlsCertPath: '',
    tlsKeyPath: '',
    webRtcHostedDomain: 'terminay.com',
    webRtcIceServers: 'stun:stun.l.google.com:19302',
  }
}

async function importTransformed(relativePath) {
  if (relativePath.endsWith('pinGuard.ts')) {
    return importBundled(relativePath)
  }
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-pin-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-pin-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await build({
    bundle: true,
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
