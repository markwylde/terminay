import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { verify } from 'node:crypto'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { createRemoteReconnectProof } from '@terminay/server-core'

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-device-credentials-'))
const output = join(directory, 'deviceCredentialStore.mjs')
await build({ bundle: true, entryPoints: ['electron/remote/deviceCredentialStore.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node', target: 'node20' })
const { DesktopDeviceCredentialStore } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

function codec(available = true) {
  return {
    isAvailable: () => available,
    encrypt: (value) => Buffer.from(`protected:${value}`),
    decrypt: (value) => {
      const decoded = value.toString('utf8')
      if (!decoded.startsWith('protected:')) throw new Error('bad ciphertext')
      return decoded.slice('protected:'.length)
    },
  }
}

test('stores an origin-compartmented device key encrypted at rest and signs without exposing it', async () => {
  const root = join(directory, 'records')
  const store = new DesktopDeviceCredentialStore({ directory: root, codec: codec() })
  const created = store.createDeviceKey('https://server.example')
  await store.savePairing({
    origin: 'https://server.example',
    deviceId: 'device-a',
    deviceName: 'Mark desktop',
    publicKeyPem: created.publicKeyPem,
    keyRef: created.keyRef,
  })
  await store.saveReconnectGrant({
    origin: 'https://server.example', grant: 'grant-a', handle: 'handle-a', issuedAt: '2030-01-01T00:00:00.000Z', expiresAt: null, protocolVersion: 'v1', sessionId: 'session-a',
  })

  const publicDevice = await store.loadDevice('https://server.example')
  assert.deepEqual(publicDevice, {
    origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Mark desktop', publicKeyPem: created.publicKeyPem,
  })
  const signature = await store.signChallenge('https://server.example', 'challenge-input')
  assert.match(signature, /^[A-Za-z0-9_-]+$/u)
  assert.equal(verify('sha256', Buffer.from('challenge-input'), { key: created.publicKeyPem, padding: 6, saltLength: 32 }, Buffer.from(signature, 'base64url')), true)
  const raw = await readFile(join(root, (await readdir(root))[0]), 'utf8')
  assert.equal(raw.includes('PRIVATE KEY'), false)
  assert.equal(raw.includes('grant-a'), false)
})

test('derives a canonical reconnect proof inside the protected credential compartment', async () => {
  const root = join(directory, 'reconnect-proof')
  const store = new DesktopDeviceCredentialStore({ directory: root, codec: codec() })
  const created = store.createDeviceKey('https://server.example')
  const grant = 'desktop-reconnect-grant-1234567890'
  await store.saveEstablishedPairing({
    pairing: { origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: created.publicKeyPem, privateKey: created.keyRef },
    reconnectGrant: { origin: 'https://server.example', grant, handle: 'h'.repeat(43), issuedAt: '2030-01-01T00:00:00.000Z', expiresAt: null, protocolVersion: 'v1', sessionId: 'session-a' },
  })
  const proof = await store.proveReconnectChallenge('https://server.example', 'canonical-reconnect-signing-input')
  assert.deepEqual(proof, {
    handle: 'h'.repeat(43),
    proof: createRemoteReconnectProof(grant, 'canonical-reconnect-signing-input'),
  })
  assert.equal(JSON.stringify(proof).includes(grant), false)
})

test('commits the shared pairing-flow device and reconnect grant as one encrypted origin record', async () => {
  const root = join(directory, 'established-pairing')
  const store = new DesktopDeviceCredentialStore({ directory: root, codec: codec() })
  const created = store.createDeviceKey('https://server.example')
  await store.saveEstablishedPairing({
    pairing: {
      origin: 'https://server.example',
      deviceId: 'device-a',
      deviceName: 'Mark desktop',
      publicKeyPem: created.publicKeyPem,
      privateKey: created.keyRef,
    },
    reconnectGrant: {
      origin: 'https://server.example', grant: 'grant-a', handle: 'handle-a',
      issuedAt: '2030-01-01T00:00:00.000Z', expiresAt: null, protocolVersion: 'v1', sessionId: 'session-a',
    },
  })

  const entries = await readdir(root)
  assert.equal(entries.length, 1)
  const envelope = JSON.parse(await readFile(join(root, entries[0]), 'utf8'))
  const record = JSON.parse(codec().decrypt(Buffer.from(envelope.encrypted, 'base64')))
  assert.equal(record.deviceId, 'device-a')
  assert.equal(record.reconnectGrant, 'grant-a')
  assert.equal(record.reconnectHandle, 'handle-a')
  assert.equal(record.privateKeyPem.includes('PRIVATE KEY'), true)
})

test('rejects a cross-origin reconnect grant before the shared pairing-flow adapter writes a record', async () => {
  const root = join(directory, 'established-pairing-mismatch')
  const store = new DesktopDeviceCredentialStore({ directory: root, codec: codec() })
  const created = store.createDeviceKey('https://server.example')
  await assert.rejects(() => store.saveEstablishedPairing({
    pairing: { origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: created.publicKeyPem, privateKey: created.keyRef },
    reconnectGrant: { origin: 'https://other.example', grant: 'grant-a', handle: 'handle-a', issuedAt: '2030-01-01T00:00:00.000Z', expiresAt: null, protocolVersion: 'v1', sessionId: 'session-a' },
  }), /another origin/u)
  await assert.rejects(() => readdir(root), { code: 'ENOENT' })

  // Validation failure does not consume the opaque key handle; the caller can
  // correct the hosted response and retry without making a new device key.
  await store.saveEstablishedPairing({
    pairing: { origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: created.publicKeyPem, privateKey: created.keyRef },
  })
  assert.deepEqual(await store.loadDevice('https://server.example'), {
    origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: created.publicKeyPem,
  })
})

test('rejects cross-origin key handles and fails closed without OS encryption', async () => {
  const store = new DesktopDeviceCredentialStore({ directory: join(directory, 'cross-origin'), codec: codec() })
  const created = store.createDeviceKey('https://one.example')
  await assert.rejects(() => store.savePairing({ origin: 'https://two.example', deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: created.publicKeyPem, keyRef: created.keyRef }), /another origin/u)
  const unavailable = new DesktopDeviceCredentialStore({ directory: join(directory, 'unavailable'), codec: codec(false) })
  assert.throws(() => unavailable.createDeviceKey('https://server.example'), /encryption/u)
  const basicText = new DesktopDeviceCredentialStore({ directory: join(directory, 'basic-text'), codec: { ...codec(), backend: () => 'basic_text' } })
  assert.throws(() => basicText.createDeviceKey('https://server.example'), /encryption/u)
})

test('re-pairing replaces the origin compartment and never carries a prior device reconnect grant', async () => {
  const store = new DesktopDeviceCredentialStore({ directory: join(directory, 'repair'), codec: codec() })
  const first = store.createDeviceKey('https://server.example')
  await store.savePairing({ origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: first.publicKeyPem, keyRef: first.keyRef })
  await store.saveReconnectGrant({ origin: 'https://server.example', grant: 'grant-a', handle: 'handle-a', issuedAt: '2030-01-01T00:00:00.000Z', expiresAt: null, protocolVersion: 'v1', sessionId: 'session-a' })
  const second = store.createDeviceKey('https://server.example')
  await store.savePairing({ origin: 'https://server.example', deviceId: 'device-b', deviceName: 'Desktop', publicKeyPem: second.publicKeyPem, keyRef: second.keyRef })
  const raw = await readFile(join(directory, 'repair', (await readdir(join(directory, 'repair')))[0]), 'utf8')
  const decrypted = Buffer.from(JSON.parse(raw).encrypted, 'base64').toString('utf8')
  assert.equal(decrypted.includes('grant-a'), false)
  assert.deepEqual(await store.loadDevice('https://server.example'), { origin: 'https://server.example', deviceId: 'device-b', deviceName: 'Desktop', publicKeyPem: second.publicKeyPem })
})

test('forget removes the full origin compartment', async () => {
  const store = new DesktopDeviceCredentialStore({ directory: join(directory, 'forget'), codec: codec() })
  const created = store.createDeviceKey('https://server.example')
  await store.savePairing({ origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: created.publicKeyPem, keyRef: created.keyRef })
  await store.remove('https://server.example')
  assert.equal(await store.loadDevice('https://server.example'), null)
  await assert.rejects(() => store.signChallenge('https://server.example', 'challenge'), /No paired device/u)
})

test('rejects corrupted incomplete and temporally invalid reconnect records', async () => {
  const root = join(directory, 'corrupt-reconnect')
  const protectedCodec = codec()
  const origin = 'https://server.example'
  const recordPath = join(root, `remote-device-${createHash('sha256').update(origin).digest('hex')}.json`)
  await (await import('node:fs/promises')).mkdir(root, { recursive: true })
  const writeRecord = async (extra) => {
    const payload = { schema: 1, origin, deviceId: 'device-a', deviceName: 'Desktop', publicKeyPem: 'public', privateKeyPem: 'private', ...extra }
    await (await import('node:fs/promises')).writeFile(recordPath, JSON.stringify({ schema: 1, encrypted: protectedCodec.encrypt(JSON.stringify(payload)).toString('base64') }))
  }
  const store = new DesktopDeviceCredentialStore({ directory: root, codec: protectedCodec })
  await writeRecord({ reconnectGrant: 'grant' })
  await assert.rejects(() => store.loadDevice(origin), /cannot be decrypted/u)
  await writeRecord({ reconnectGrant: 'grant', reconnectHandle: 'handle', reconnectIssuedAt: 'not-a-date', reconnectExpiresAt: null, reconnectSessionId: 'session' })
  await assert.rejects(() => store.loadDevice(origin), /cannot be decrypted/u)
  await writeRecord({ reconnectGrant: 'grant', reconnectHandle: 'handle', reconnectIssuedAt: '2030-01-02T00:00:00.000Z', reconnectExpiresAt: '2030-01-01T00:00:00.000Z', reconnectSessionId: 'session' })
  await assert.rejects(() => store.loadDevice(origin), /cannot be decrypted/u)
})
