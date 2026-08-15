import { normalizeSessionOrigin } from './deviceKeys'
import type { PairingBootstrap } from './pairing'
import type { RemoteApiTransport } from './transport'

export type DeviceChallenge = Readonly<{
  challengeId: string
  deviceId: string
  expiresAt: string
  nonce: string
  origin: string
  serverId: string
}>

export async function pairDevice(options: Readonly<{
  api: RemoteApiTransport
  bootstrap: PairingBootstrap
  deviceName: string
  pairingPin: string
  publicKeyPem: string
}>): Promise<Readonly<{ deviceId: string; deviceName: string; ticket: string }>> {
  const enrolled = await options.api.postJson<unknown>('/api/devices/enroll', {
    deviceName: options.deviceName,
    pairingExpiresAt: options.bootstrap.pairingExpiresAt,
    pairingPin: options.pairingPin,
    pairingSessionId: options.bootstrap.pairingSessionId,
    pairingToken: options.bootstrap.pairingToken,
    publicKeyPem: options.publicKeyPem,
  })
  return validateEnrollment(enrolled)
}

export async function authenticateDevice(options: Readonly<{
  api: RemoteApiTransport
  deviceId: string
  origin: string
  signChallenge: (signingInput: string) => Promise<string>
}>): Promise<Readonly<{ ticket: string }>> {
  const origin = normalizeSessionOrigin(options.origin)
  const response = await options.api.postJson<Readonly<{ challenge: DeviceChallenge; signingInput: string }>>('/api/devices/challenge', {
    deviceId: options.deviceId,
  })
  const challenge = validateDeviceChallenge(response.challenge, { deviceId: options.deviceId, origin })
  if (typeof response.signingInput !== 'string' || response.signingInput.length === 0 || response.signingInput.length > 16_384) {
    throw new Error('The server returned an invalid device challenge.')
  }
  const deviceSignature = await options.signChallenge(response.signingInput)
  const verified = await options.api.postJson<unknown>('/api/devices/verify', {
    challengeId: challenge.challengeId,
    deviceId: options.deviceId,
    deviceSignature,
  })
  const ticket = readField(verified, 'ticket')
  if (!isBoundedText(ticket, 4_096)) {
    throw new Error('The server returned an invalid connection ticket.')
  }
  return Object.freeze({ ticket })
}

function validateEnrollment(value: unknown): Readonly<{ deviceId: string; deviceName: string; ticket: string }> {
  const deviceId = readField(value, 'deviceId')
  const deviceName = readField(value, 'deviceName')
  const ticket = readField(value, 'ticket')
  if (!isBoundedText(deviceId, 256) || !isBoundedText(deviceName, 256) || !isBoundedText(ticket, 4_096)) {
    throw new Error('The server returned an invalid device enrollment.')
  }
  return Object.freeze({ deviceId, deviceName, ticket })
}

function validateDeviceChallenge(value: DeviceChallenge, expected: Readonly<{ deviceId: string; origin: string }>): DeviceChallenge {
  if (!value || typeof value !== 'object') throw new Error('The server returned an invalid device challenge.')
  const fields: Array<keyof DeviceChallenge> = ['challengeId', 'deviceId', 'expiresAt', 'nonce', 'origin', 'serverId']
  for (const field of fields) {
    if (typeof value[field] !== 'string' || value[field].length === 0 || value[field].length > 16_384) {
      throw new Error('The server returned an invalid device challenge.')
    }
  }
  if (value.deviceId !== expected.deviceId || normalizeSessionOrigin(value.origin) !== expected.origin) {
    throw new Error('The server challenge belongs to a different device or session origin.')
  }
  const expiresAt = Date.parse(value.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('The server device challenge is expired.')
  }
  return Object.freeze(value)
}

function readField(value: unknown, field: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[field] : undefined
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
}

export async function revokeCurrentDevice(options: Readonly<{
  api: RemoteApiTransport
  deviceId: string
}>): Promise<void> {
  await options.api.postJson('/api/devices/revoke-current', { deviceId: options.deviceId })
}
