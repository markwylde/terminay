type StoredPairing = {
  deviceId: string
  deviceName: string
  origin: string
  publicKeyPem: string
}

type PairingRecord = StoredPairing & {
  privateKey: CryptoKey
}

const DB_NAME = 'terminay-remote'
const DB_VERSION = 1
const PAIRINGS_STORE = 'pairings'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PAIRINGS_STORE)) {
        database.createObjectStore(PAIRINGS_STORE, { keyPath: 'origin' })
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
