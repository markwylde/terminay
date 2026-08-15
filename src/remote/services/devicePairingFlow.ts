import { pairDevice } from './auth'
import { normalizeSessionOrigin } from './sessionOrigin'
import type { PairingBootstrap } from './pairing'
import type { RemoteApiTransport } from './transport'

/** `KeyRef` is opaque so browser and Desktop hosts can protect their private
 * key in their respective credential stores. */
export type DevicePairingKeyPair<KeyRef = CryptoKey> = Readonly<{
  privateKey: KeyRef
  publicKeyPem: string
}>

export type DevicePairingKeyGenerator<KeyRef = CryptoKey> = () => Promise<DevicePairingKeyPair<KeyRef>>

export type DevicePairingCredentialStore<KeyRef = CryptoKey> = Readonly<{
  saveDeviceIdentity: (identity: Readonly<{
    deviceId: string
    deviceName: string
    origin: string
    privateKey: KeyRef
  }>) => Promise<void>
}>

export type EstablishedDevicePairing = Readonly<{
  deviceId: string
  deviceName: string
  ticket: string
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
  const origin = normalizeSessionOrigin(options.origin)
  const keyPair = await options.generateKeyPair()
  const paired = await pairDevice({
    api: options.api,
    bootstrap: options.bootstrap,
    deviceName: options.deviceName,
    pairingPin: options.pairingPin,
    publicKeyPem: keyPair.publicKeyPem,
  })
  await options.credentials.saveDeviceIdentity({
    deviceId: paired.deviceId,
    deviceName: paired.deviceName,
    origin,
    privateKey: keyPair.privateKey,
  })
  return Object.freeze({ deviceId: paired.deviceId, deviceName: paired.deviceName, ticket: paired.ticket })
}
