type StoredPairing = {
  deviceId: string
  deviceName: string
  origin: string
  publicKeyPem: string
}

type PairingRecord = StoredPairing & {
  privateKey: CryptoKey
}

export type StoredReconnectGrant = {
  expiresAt: string | null
  issuedAt: string
  origin: string
  protocolVersion: 'v1'
  sessionId: string
}

export type ReconnectGrantRecord = StoredReconnectGrant & {
  proofKey: CryptoKey
}

export type StoredReconnectHandle = {
  handle: string
  origin: string
  sessionId: string
}

export type IssuedReconnectGrant = {
  expiresAt: string | null
  grant: string
  handle: string
  issuedAt: string
  origin: string
  protocolVersion: 'v1'
  sessionId: string
}

const DB_NAME = 'terminay-remote'
const DB_VERSION = 2
const PAIRINGS_STORE = 'pairings'
const RECONNECT_GRANTS_STORE = 'reconnectGrants'
const RECONNECT_HANDLES_STORE = 'reconnectHandles'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PAIRINGS_STORE)) {
        database.createObjectStore(PAIRINGS_STORE, { keyPath: 'origin' })
      }
      if (!database.objectStoreNames.contains(RECONNECT_GRANTS_STORE)) {
        database.createObjectStore(RECONNECT_GRANTS_STORE, { keyPath: 'origin' })
      }
      if (!database.objectStoreNames.contains(RECONNECT_HANDLES_STORE)) {
        database.createObjectStore(RECONNECT_HANDLES_STORE, { keyPath: 'origin' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error('Reconnect grant is not valid base64url.')
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function createReconnectProofKey(grant: string): Promise<CryptoKey> {
  const grantKey = await crypto.subtle.importKey(
    'raw',
    base64UrlToArrayBuffer(grant),
    'HKDF',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      hash: 'SHA-256',
      info: new TextEncoder().encode('terminay remote v1 reconnect proof verifier'),
      name: 'HKDF',
      salt: new Uint8Array(),
    },
    grantKey,
    { hash: 'SHA-256', length: 256, name: 'HMAC' },
    false,
    ['sign', 'verify'],
  )
}

export async function exportPublicKeyPem(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  const base64 = arrayBufferToBase64(spki)
  const body = base64.match(/.{1,64}/g)?.join('\n') ?? base64
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`
}

export async function generateDeviceKeyPair(): Promise<{
  privateKey: CryptoKey
  publicKeyPem: string
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify'],
  )

  return {
    privateKey: keyPair.privateKey,
    publicKeyPem: await exportPublicKeyPem(keyPair.publicKey),
  }
}

export async function savePairing(pairing: PairingRecord): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(PAIRINGS_STORE, 'readwrite')
  await transactionRequest(
    transaction.objectStore(PAIRINGS_STORE).put({
      deviceId: pairing.deviceId,
      deviceName: pairing.deviceName,
      origin: pairing.origin,
      privateKey: pairing.privateKey,
      publicKeyPem: pairing.publicKeyPem,
    }),
  )
  database.close()
}

export async function loadPairing(origin: string): Promise<PairingRecord | null> {
  const database = await openDatabase()
  const transaction = database.transaction(PAIRINGS_STORE, 'readonly')
  const result = await transactionRequest<PairingRecord | undefined>(
    transaction.objectStore(PAIRINGS_STORE).get(origin),
  )
  database.close()
  return result ?? null
}

export async function removePairing(origin: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(PAIRINGS_STORE, 'readwrite')
  await transactionRequest(transaction.objectStore(PAIRINGS_STORE).delete(origin))
  database.close()
}

export async function saveReconnectGrant(issued: IssuedReconnectGrant): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([RECONNECT_GRANTS_STORE, RECONNECT_HANDLES_STORE], 'readwrite')
  await transactionRequest(
    transaction.objectStore(RECONNECT_GRANTS_STORE).put({
      expiresAt: issued.expiresAt,
      issuedAt: issued.issuedAt,
      origin: issued.origin,
      proofKey: await createReconnectProofKey(issued.grant),
      protocolVersion: issued.protocolVersion,
      sessionId: issued.sessionId,
    }),
  )
  await transactionRequest(
    transaction.objectStore(RECONNECT_HANDLES_STORE).put({
      handle: issued.handle,
      origin: issued.origin,
      sessionId: issued.sessionId,
    }),
  )
  database.close()
}

export async function loadReconnectGrant(origin: string): Promise<ReconnectGrantRecord | null> {
  const database = await openDatabase()
  const transaction = database.transaction(RECONNECT_GRANTS_STORE, 'readonly')
  const result = await transactionRequest<ReconnectGrantRecord | undefined>(
    transaction.objectStore(RECONNECT_GRANTS_STORE).get(origin),
  )
  database.close()
  return result ?? null
}

export async function loadReconnectHandle(origin: string): Promise<StoredReconnectHandle | null> {
  const database = await openDatabase()
  const transaction = database.transaction(RECONNECT_HANDLES_STORE, 'readonly')
  const result = await transactionRequest<StoredReconnectHandle | undefined>(
    transaction.objectStore(RECONNECT_HANDLES_STORE).get(origin),
  )
  database.close()
  return result ?? null
}

export async function removeReconnectGrant(origin: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([RECONNECT_GRANTS_STORE, RECONNECT_HANDLES_STORE], 'readwrite')
  await transactionRequest(transaction.objectStore(RECONNECT_GRANTS_STORE).delete(origin))
  await transactionRequest(transaction.objectStore(RECONNECT_HANDLES_STORE).delete(origin))
  database.close()
}

export async function signDeviceChallenge(privateKey: CryptoKey, signingInput: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    {
      name: 'RSA-PSS',
      saltLength: 32,
    },
    privateKey,
    new TextEncoder().encode(signingInput),
  )

  return arrayBufferToBase64(signature)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export type { StoredPairing }
