import { pairDevice } from './auth'
import type { IssuedReconnectGrant } from './deviceKeys'
import type { PairingBootstrap } from './pairing'
import type { RemoteApiTransport } from './transport'

/**
 * The device-registration transaction is intentionally independent of React,
 * IndexedDB, and the terminal-only remote UI. Browser and Desktop hosts can
 * provide their own key and credential-store adapters while sending the exact
 * same pairing protocol requests.
 */
/**
 * `KeyRef` is intentionally opaque.  The browser adapter uses a nonextractable
 * CryptoKey; Desktop will use a main-process-only key handle.  Pairing itself
 * only needs the public PEM, so this boundary must never force private key
 * material through a renderer.
 */
export type DevicePairingKeyPair<KeyRef = CryptoKey> = Readonly<{
  privateKey: KeyRef
  publicKeyPem: string
}>

export type DevicePairingKeyGenerator<KeyRef = CryptoKey> = () => Promise<DevicePairingKeyPair<KeyRef>>

export type DevicePairingCredentialStore<KeyRef = CryptoKey> = Readonly<{
  /** Persist the device and its optional reconnect grant as one transaction.
   * A failed pairing must never leave a device without its issued grant. */
  saveEstablishedPairing: (value: Readonly<{
    pairing: Readonly<{
      deviceId: string
      deviceName: string
      origin: string
      privateKey: KeyRef
      publicKeyPem: string
    }>
    reconnectGrant?: IssuedReconnectGrant
  }>) => Promise<void>
}>

export type EstablishedDevicePairing = Readonly<{
  deviceId: string
  deviceName: string
  reconnectGrant?: IssuedReconnectGrant
}>

export async function establishDevicePairing<KeyRef = CryptoKey>(options: Readonly<{
  api: RemoteApiTransport
  bootstrap: PairingBootstrap
  credentials: DevicePairingCredentialStore<KeyRef>
  deviceName: string
  generateKeyPair: DevicePairingKeyGenerator<KeyRef>
  origin: string
  pairingPin: string
}>): Promise<EstablishedDevicePairing> {
  const origin = normalizePairingOrigin(options.origin)
  const keyPair = await options.generateKeyPair()
  const paired = await pairDevice({
    api: options.api,
    bootstrap: options.bootstrap,
    deviceName: options.deviceName,
    pairingPin: options.pairingPin,
    publicKeyPem: keyPair.publicKeyPem,
  })
  if (paired.reconnectGrant !== undefined) {
    if (paired.reconnectGrant.origin !== origin) {
      throw new Error('The reconnect grant belongs to a different Terminay origin.')
    }
  }
  await options.credentials.saveEstablishedPairing({
    pairing: { deviceId: paired.deviceId, deviceName: paired.deviceName, origin, privateKey: keyPair.privateKey, publicKeyPem: keyPair.publicKeyPem },
    ...(paired.reconnectGrant === undefined ? {} : { reconnectGrant: paired.reconnectGrant }),
  })
  return Object.freeze(paired)
}

function normalizePairingOrigin(value: string): string {
  const transportMarker = '#transport=webrtc:'
  const markerIndex = value.indexOf(transportMarker)
  if (markerIndex > 0) {
    const appOrigin = normalizePairingOrigin(value.slice(0, markerIndex))
    const relayOrigin = normalizePairingOrigin(value.slice(markerIndex + transportMarker.length))
    const appUrl = new URL(appOrigin)
    const loopbackHttp =
      appUrl.protocol === 'http:' &&
      (appUrl.hostname === 'localhost' ||
        appUrl.hostname.endsWith('.localhost') ||
        appUrl.hostname === '127.0.0.1' ||
        appUrl.hostname === '[::1]')
    if (
      (appUrl.protocol !== 'https:' && !loopbackHttp) ||
      appOrigin !== relayOrigin
    ) {
      throw new TypeError('The WebRTC pairing origin marker must match its session origin.')
    }
    return `${appOrigin}${transportMarker}${relayOrigin}`
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError('The pairing origin is invalid.')
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('The pairing origin must not contain credentials or a path.')
  }
  const loopback = parsed.protocol === 'http:' && (
    parsed.hostname === 'localhost' ||
    parsed.hostname.endsWith('.localhost') ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]'
  )
  if (parsed.protocol !== 'https:' && !loopback) throw new TypeError('The pairing origin must use HTTPS or loopback HTTP.')
  return parsed.origin
}
