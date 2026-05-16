import { signDeviceChallenge } from './deviceKeys'
import type { PairingBootstrap } from './pairing'
import type { RemoteApiTransport } from './transport'

export async function pairDevice(options: {
  api: RemoteApiTransport
  bootstrap: PairingBootstrap
  deviceName: string
  pairingPin: string
  publicKeyPem: string
}): Promise<{ deviceId: string; deviceName: string; reconnectGrant?: import('./deviceKeys').IssuedReconnectGrant }> {
  const start = await options.api.postJson<{
    provisionalDeviceId: string
  }>('/api/pairing/start', {
    deviceName: options.deviceName,
    pairingExpiresAt: options.bootstrap.pairingExpiresAt,
    pairingPin: options.pairingPin,
    pairingSessionId: options.bootstrap.pairingSessionId,
    pairingToken: options.bootstrap.pairingToken,
    publicKeyPem: options.publicKeyPem,
  })

  return options.api.postJson('/api/pairing/complete', {
    provisionalDeviceId: start.provisionalDeviceId,
  })
}

export async function authenticateDevice(options: {
  api: RemoteApiTransport
  deviceId: string
  privateKey: CryptoKey
}): Promise<{ ticket: string; websocketUrl?: string }> {
  const authOptions = await options.api.postJson<{
    deviceChallenge: { challengeId: string }
    signingInput: string
  }>('/api/auth/options', {
    deviceId: options.deviceId,
  })

  const deviceSignature = await signDeviceChallenge(options.privateKey, authOptions.signingInput)

  return options.api.postJson('/api/auth/verify', {
    challengeId: authOptions.deviceChallenge.challengeId,
    deviceId: options.deviceId,
    deviceSignature,
  })
}

export async function revokeCurrentDevice(options: {
  api: RemoteApiTransport
  deviceId: string
}): Promise<void> {
  await options.api.postJson('/api/devices/revoke-current', {
    deviceId: options.deviceId,
  })
}
