import { signDeviceChallenge } from './deviceKeys'
import type { PairingBootstrap } from './pairing'

async function postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> {
  const response = await fetch(pathname, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
  } & TResponse

  if (!response.ok) {
    throw new Error(payload.error ?? 'Request failed.')
  }

  return payload
}

export async function pairDevice(options: {
  bootstrap: PairingBootstrap
  deviceName: string
  publicKeyPem: string
}): Promise<{ deviceId: string; deviceName: string }> {
  const start = await postJson<{
    provisionalDeviceId: string
  }>('/api/pairing/start', {
    deviceName: options.deviceName,
    pairingExpiresAt: options.bootstrap.pairingExpiresAt,
    pairingSessionId: options.bootstrap.pairingSessionId,
    pairingToken: options.bootstrap.pairingToken,
    publicKeyPem: options.publicKeyPem,
  })

  return postJson('/api/pairing/complete', {
    provisionalDeviceId: start.provisionalDeviceId,
  })
}

export async function authenticateDevice(options: {
  deviceId: string
  privateKey: CryptoKey
}): Promise<{ ticket: string; websocketUrl: string }> {
  const authOptions = await postJson<{
    deviceChallenge: { challengeId: string }
    signingInput: string
  }>('/api/auth/options', {
    deviceId: options.deviceId,
  })

  const deviceSignature = await signDeviceChallenge(options.privateKey, authOptions.signingInput)

  return postJson('/api/auth/verify', {
    challengeId: authOptions.deviceChallenge.challengeId,
    deviceId: options.deviceId,
    deviceSignature,
  })
}
