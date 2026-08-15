import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const {
  generateDeviceKeyPair,
  loadBrowserDeviceIdentity,
  removeBrowserDeviceIdentity,
  saveBrowserDeviceIdentity,
} = await importDeviceKeys()

test('generated browser device private keys are non-extractable signing keys', async () => {
  const keyPair = await generateDeviceKeyPair()
  assert.equal(keyPair.privateKey.extractable, false)
  assert.equal(keyPair.privateKey.usages.includes('sign'), true)
  await assert.rejects(() => crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  assert.match(keyPair.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/u)
})

test('browser device storage persists one identity by exact HTTPS session origin', async () => {
  const indexedDB = createStrictIndexedDB()
  globalThis.indexedDB = indexedDB
  const origin = 'https://2d5057472b1731ccfb1a.terminay.com'
  const identity = {
    deviceId: 'device-a',
    deviceName: 'Browser',
    origin,
    privateKey: { key: 'non-extractable-key-reference' },
  }

  await saveBrowserDeviceIdentity(identity)
  assert.deepEqual(await loadBrowserDeviceIdentity(origin), identity)
  await removeBrowserDeviceIdentity(origin)
  assert.equal(await loadBrowserDeviceIdentity(origin), null)
  assert.equal(indexedDB.transactions.some((transaction) => transaction.closedWithoutRequests), false)
})

test('browser device storage rejects origins that could cross the origin boundary', async () => {
  globalThis.indexedDB = createStrictIndexedDB()
  for (const origin of [
    'http://server.example',
    'https://server.example/path',
    'https://server.example?query=1',
    'https://server.example#transport=webrtc',
  ]) {
    await assert.rejects(() => loadBrowserDeviceIdentity(origin), /exact HTTPS origin/)
  }
})

async function importDeviceKeys() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-device-keys-test-'))
  const outputPath = join(tempDir, 'deviceKeys.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../src/remote/services/deviceKeys.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'browser',
    target: 'es2022',
  })
  return import(outputPath)
}

function createStrictIndexedDB() {
  const database = new FakeDatabase()
  const transactions = []
  return {
    transactions,
    open() {
      const request = createRequest()
      queueMicrotask(() => {
        request.result = database
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map()
    this.objectStoreNames = { contains: (name) => this.stores.has(name) }
  }
  createObjectStore(name, options) {
    this.stores.set(name, { keyPath: options.keyPath, records: new Map() })
  }
  transaction(storeNames) {
    const transaction = new FakeTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames])
    globalThis.indexedDB.transactions.push(transaction)
    return transaction
  }
  close() {}
}

class FakeTransaction {
  constructor(database, storeNames) {
    this.database = database
    this.storeNames = storeNames
    this.active = true
    this.pendingRequestCount = 0
    this.closedWithoutRequests = false
    this.onabort = null
    this.oncomplete = null
    this.onerror = null
    queueMicrotask(() => {
      if (this.pendingRequestCount === 0) {
        this.active = false
        this.closedWithoutRequests = true
        this.oncomplete?.()
      }
    })
  }
  objectStore(name) {
    if (!this.storeNames.includes(name)) throw new Error(`Store ${name} is not in this transaction.`)
    const store = this.database.stores.get(name)
    if (!store) throw new Error(`Store ${name} does not exist.`)
    return new FakeObjectStore(this, store)
  }
  requestStarted() {
    if (!this.active) throw new Error('The transaction is inactive.')
    this.pendingRequestCount += 1
  }
  requestFinished() {
    this.pendingRequestCount -= 1
    if (this.pendingRequestCount === 0) queueMicrotask(() => {
      if (this.pendingRequestCount === 0 && this.active) {
        this.active = false
        this.oncomplete?.()
      }
    })
  }
}

class FakeObjectStore {
  constructor(transaction, store) { this.transaction = transaction; this.store = store }
  put(record) { return this.request(() => { this.store.records.set(record[this.store.keyPath], structuredClone(record)); return record[this.store.keyPath] }) }
  get(key) { return this.request(() => this.store.records.get(key)) }
  delete(key) { return this.request(() => this.store.records.delete(key)) }
  request(operation) {
    this.transaction.requestStarted()
    const request = createRequest()
    queueMicrotask(() => {
      request.result = operation()
      request.onsuccess?.()
      this.transaction.requestFinished()
    })
    return request
  }
}

function createRequest() {
  return { error: null, onerror: null, onsuccess: null, onupgradeneeded: null, result: undefined }
}
