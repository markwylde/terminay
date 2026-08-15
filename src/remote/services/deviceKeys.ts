/**
 * Browser device identities are scoped to one stable Terminay session origin.
 * The private key remains non-extractable in IndexedDB; only the public key is
 * sent during enrollment.
 */
export type BrowserDeviceIdentity = Readonly<{
  deviceId: string
  deviceName: string
  origin: string
  privateKey: CryptoKey
}>

const DB_NAME = 'terminay-browser-device-identities'
const DB_VERSION = 1
const DEVICE_IDENTITIES_STORE = 'deviceIdentities'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Unable to open browser device storage.'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DEVICE_IDENTITIES_STORE)) {
        database.createObjectStore(DEVICE_IDENTITIES_STORE, { keyPath: 'origin' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('Browser device storage request failed.'))
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser device storage transaction aborted.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser device storage transaction failed.'))
    transaction.oncomplete = () => resolve()
  })
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function normalizeSessionOrigin(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError('The session origin is invalid.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError('The session origin must be an exact HTTPS origin.')
  }
  return parsed.origin
}

export async function exportPublicKeyPem(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  const base64 = arrayBufferToBase64(spki)
  const body = base64.match(/.{1,64}/g)?.join('\n') ?? base64
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`
}

export async function generateDeviceKeyPair(): Promise<Readonly<{
  privateKey: CryptoKey
  publicKeyPem: string
}>> {
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
  return Object.freeze({
    privateKey: keyPair.privateKey,
    publicKeyPem: await exportPublicKeyPem(keyPair.publicKey),
  })
}

export async function saveBrowserDeviceIdentity(identity: BrowserDeviceIdentity): Promise<void> {
  const origin = normalizeSessionOrigin(identity.origin)
  const database = await openDatabase()
  try {
    const transaction = database.transaction(DEVICE_IDENTITIES_STORE, 'readwrite')
    const complete = transactionComplete(transaction)
    await Promise.all([
      transactionRequest(transaction.objectStore(DEVICE_IDENTITIES_STORE).put({
        deviceId: identity.deviceId,
        deviceName: identity.deviceName,
        origin,
        privateKey: identity.privateKey,
      })),
      complete,
    ])
  } finally {
    database.close()
  }
}

export async function loadBrowserDeviceIdentity(originInput: string): Promise<BrowserDeviceIdentity | null> {
  const origin = normalizeSessionOrigin(originInput)
  const database = await openDatabase()
  try {
    const transaction = database.transaction(DEVICE_IDENTITIES_STORE, 'readonly')
    const value = await transactionRequest<BrowserDeviceIdentity | undefined>(
      transaction.objectStore(DEVICE_IDENTITIES_STORE).get(origin),
    )
    return value ?? null
  } finally {
    database.close()
  }
}

export async function removeBrowserDeviceIdentity(originInput: string): Promise<void> {
  const origin = normalizeSessionOrigin(originInput)
  const database = await openDatabase()
  try {
    const transaction = database.transaction(DEVICE_IDENTITIES_STORE, 'readwrite')
    const complete = transactionComplete(transaction)
    await Promise.all([
      transactionRequest(transaction.objectStore(DEVICE_IDENTITIES_STORE).delete(origin)),
      complete,
    ])
  } finally {
    database.close()
  }
}

export async function signDeviceChallenge(privateKey: CryptoKey, signingInput: string): Promise<string> {
  if (typeof signingInput !== 'string' || signingInput.length === 0 || signingInput.length > 16_384) {
    throw new TypeError('The device challenge signing input is invalid.')
  }
  const signature = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 32 },
    privateKey,
    new TextEncoder().encode(signingInput),
  )
  return arrayBufferToBase64(signature)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
