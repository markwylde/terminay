import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { verify } from 'node:crypto'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-desktop-device-credentials-'))
const output = join(directory, 'deviceCredentialStore.mjs')
await build({ bundle: true, entryPoints: ['electron/remote/deviceCredentialStore.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node', target: 'node20' })
const { DesktopDeviceCredentialStore } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

function codec() {
  return {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`protected:${value}`),
    decrypt: (value) => {
      const plain = value.toString('utf8')
      if (!plain.startsWith('protected:')) throw new Error('bad ciphertext')
      return plain.slice('protected:'.length)
    },
  }
}

test('Desktop stores one protected device signing key for its exact origin', async () => {
  const root = join(directory, 'records')
  const store = new DesktopDeviceCredentialStore({ directory: root, codec: codec() })
  const key = store.createDeviceKey('https://server.example')
  await store.saveDeviceIdentity({
    origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Terminay Desktop', privateKey: key.keyRef,
  })
  assert.deepEqual(await store.loadDevice('https://server.example'), {
    origin: 'https://server.example', deviceId: 'device-a', deviceName: 'Terminay Desktop', publicKeyPem: key.publicKeyPem,
  })
  const signature = await store.signChallenge('https://server.example', 'device-challenge')
  assert.equal(verify('sha256', Buffer.from('device-challenge'), { key: key.publicKeyPem, padding: 6, saltLength: 32 }, Buffer.from(signature, 'base64url')), true)
  const raw = await readFile(join(root, (await readdir(root))[0]), 'utf8')
  assert.equal(raw.includes('PRIVATE KEY'), false)
  assert.equal(raw.includes('reconnect'), false)
})

test('Desktop rejects an old credential schema and does not cross origin boundaries', async () => {
  const store = new DesktopDeviceCredentialStore({ directory: join(directory, 'boundaries'), codec: codec() })
  const key = store.createDeviceKey('https://one.example')
  await assert.rejects(() => store.saveDeviceIdentity({
    origin: 'https://two.example', deviceId: 'device-a', deviceName: 'Desktop', privateKey: key.keyRef,
  }), /another origin/u)
  await assert.rejects(() => store.loadDevice('http://server.example'), /HTTPS/u)
})
