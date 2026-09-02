import { parsePendingEnrollmentResponse } from '@terminay/protocol'
import { normalizeSessionOrigin } from './sessionOrigin'
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

export type PairedDevice = Readonly<{ deviceId: string; deviceName: string; ticket: string }>

/**
 * Enroll a device. Over a transport-authenticated lane the server parks the
 * request until the administrator approves the match code, and the decision
 * arrives as a push on the same lane. Loopback HTTP answers immediately: the
 * one-time fragment is the whole authority on the same machine.
 */
export async function pairDevice(options: Readonly<{
  api: RemoteApiTransport
  bootstrap: PairingBootstrap
  deviceName: string
  publicKeyPem: string
  /** Called once the request is pending so the device can show its code. */
  onPending?: (pending: Readonly<{ approvalId: string; expiresAt: number }>) => void
  signal?: AbortSignal
}>): Promise<PairedDevice> {
  const enrolled = await options.api.postJson<unknown>('/api/devices/enroll', {
    deviceName: options.deviceName,
    pairingExpiresAt: options.bootstrap.pairingExpiresAt,
    pairingSessionId: options.bootstrap.pairingSessionId,
    pairingToken: options.bootstrap.pairingToken,
    publicKeyPem: options.publicKeyPem,
  })
  if (readField(enrolled, 'status') === 'pending') {
    const pending = parsePendingEnrollmentResponse(enrolled)
    if (options.api.waitForEnrollmentDecision === undefined) {
      throw new Error('This connection cannot wait for pairing approval.')
    }
    options.onPending?.(pending)
    const decision = await options.api.waitForEnrollmentDecision(pending.approvalId, {
      expiresAt: pending.expiresAt,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (decision.approvalId !== pending.approvalId) {
      throw new Error('The server answered a different pairing request.')
    }
    if (decision.type === 'enrollment-denied') {
      throw new Error(denialMessage(decision.reason))
    }
    return Object.freeze({ deviceId: decision.deviceId, deviceName: decision.deviceName, ticket: decision.ticket })
  }
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

function denialMessage(reason: 'denied' | 'expired' | 'replaced' | 'closed'): string {
  switch (reason) {
    case 'denied':
      return 'The exposing computer denied this device.'
    case 'expired':
      return 'The pairing request expired before it was approved. Scan a fresh QR code.'
    case 'replaced':
      return 'The pairing link was replaced before this device was approved. Scan the new QR code.'
    default:
      return 'The connection closed before this device was approved.'
  }
}

function validateEnrollment(value: unknown): PairedDevice {
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
