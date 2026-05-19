import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const { loadReconnectGrant, loadReconnectHandle, saveReconnectGrant } = await importDeviceKeys()

test('saveReconnectGrant queues IndexedDB writes before the transaction can auto-close', async () => {
  const indexedDB = createStrictIndexedDB()
  globalThis.indexedDB = indexedDB
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      subtle: {
        async importKey() {
          await Promise.resolve()
          return { type: 'hkdf-source' }
        },
        async deriveKey() {
          await Promise.resolve()
          return { type: 'hmac-proof-key' }
        },
      },
    },
  })

  const origin = 'https://2d5057472b1731ccfb1a.terminay.com#transport=webrtc'
  await saveReconnectGrant({
    expiresAt: null,
    grant: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    handle: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    issuedAt: '2026-05-19T10:00:00.000Z',
    origin,
    protocolVersion: 'v1',
    sessionId: '2d5057472b1731ccfb1a',
  })

  const grant = await loadReconnectGrant(origin)
  const handle = await loadReconnectHandle(origin)

  assert.equal(grant.origin, origin)
  assert.equal(grant.sessionId, '2d5057472b1731ccfb1a')
  assert.deepEqual(grant.proofKey, { type: 'hmac-proof-key' })
  assert.equal(handle.origin, origin)
  assert.equal(handle.handle, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')
  assert.equal(indexedDB.transactions.some((transaction) => transaction.closedWithoutRequests), false)
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
    this.closed = false
    this.stores = new Map()
    this.objectStoreNames = {
      contains: (name) => this.stores.has(name),
    }
  }

  createObjectStore(name, options) {
    const store = new Map()
    this.stores.set(name, { keyPath: options.keyPath, records: store })
    return store
  }

  transaction(storeNames) {
    const transaction = new FakeTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames])
    globalThis.indexedDB.transactions.push(transaction)
    return transaction
  }

  close() {
    this.closed = true
  }
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
    if (!this.storeNames.includes(name)) {
      throw new Error(`Store ${name} is not in this transaction.`)
    }
    const store = this.database.stores.get(name)
    if (!store) throw new Error(`Store ${name} does not exist.`)
    return new FakeObjectStore(this, store)
  }

  requestStarted() {
    if (!this.active) {
      throw new Error('Failed to store record in an IDBObjectStore: The transaction is inactive or finished.')
    }
    this.pendingRequestCount += 1
  }

  requestFinished() {
    this.pendingRequestCount -= 1
    if (this.pendingRequestCount === 0) {
      queueMicrotask(() => {
        if (this.pendingRequestCount === 0 && this.active) {
          this.active = false
          this.oncomplete?.()
        }
      })
    }
  }
}

class FakeObjectStore {
  constructor(transaction, store) {
    this.transaction = transaction
    this.store = store
  }

  put(record) {
    this.transaction.requestStarted()
    const request = createRequest()
    queueMicrotask(() => {
      this.store.records.set(record[this.store.keyPath], structuredClone(record))
      request.result = record[this.store.keyPath]
      request.onsuccess?.()
      this.transaction.requestFinished()
    })
    return request
  }

  get(key) {
    this.transaction.requestStarted()
    const request = createRequest()
    queueMicrotask(() => {
      request.result = this.store.records.get(key)
      request.onsuccess?.()
      this.transaction.requestFinished()
    })
    return request
  }

  delete(key) {
    this.transaction.requestStarted()
    const request = createRequest()
    queueMicrotask(() => {
      this.store.records.delete(key)
      request.result = undefined
      request.onsuccess?.()
      this.transaction.requestFinished()
    })
    return request
  }
}

function createRequest() {
  return {
    error: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
    result: undefined,
  }
}
