import { deriveMatchCode } from '@terminay/protocol'
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

/** Inputs both ends hold once the transport transcript verified. The device
 * derives the same code the exposing host shows, from the fragment the relay
 * never sees. */
export type MatchCodeInputs = Readonly<{
  pairingSecret: string
  clientNonce: string
  hostPublicKey: string
}>

export async function establishDevicePairing<KeyRef = CryptoKey>(options: Readonly<{
  api: RemoteApiTransport
  bootstrap: PairingBootstrap
  credentials: DevicePairingCredentialStore<KeyRef>
  deviceName: string
  generateKeyPair: DevicePairingKeyGenerator<KeyRef>
  origin: string
  /** Present whenever the lane is transport-authenticated; absent on loopback HTTP. */
  matchCode?: MatchCodeInputs
  onMatchCode?: (code: Readonly<{ matchCode: string; expiresAt: number }>) => void
  signal?: AbortSignal
}>): Promise<EstablishedDevicePairing> {
  const origin = normalizeSessionOrigin(options.origin)
  const keyPair = await options.generateKeyPair()
  const matchCode = options.matchCode === undefined
    ? undefined
    : await deriveMatchCode({ ...options.matchCode, devicePublicKeyPem: keyPair.publicKeyPem })
  const paired = await pairDevice({
    api: options.api,
    bootstrap: options.bootstrap,
    deviceName: options.deviceName,
    publicKeyPem: keyPair.publicKeyPem,
    onPending: (pending) => {
      if (matchCode === undefined) throw new Error('Pairing approval needs an authenticated transport.')
      options.onMatchCode?.({ matchCode, expiresAt: pending.expiresAt })
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  await options.credentials.saveDeviceIdentity({
    deviceId: paired.deviceId,
    deviceName: paired.deviceName,
    origin,
    privateKey: keyPair.privateKey,
  })
  return Object.freeze({ deviceId: paired.deviceId, deviceName: paired.deviceName, ticket: paired.ticket })
}
