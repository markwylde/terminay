import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const PIN_HASH_PREFIX = 'scrypt-v1'
const PIN_KEY_LENGTH = 32

export function isValidPairingPin(pin: string): boolean {
  return /^\d{6}$/.test(pin)
}

export function createPairingPinHash(pin: string): string {
  if (!isValidPairingPin(pin)) {
    throw new Error('Pairing PIN must be exactly 6 digits.')
  }

  const salt = randomBytes(16).toString('base64url')
  const key = scryptSync(pin, salt, PIN_KEY_LENGTH).toString('base64url')
  return `${PIN_HASH_PREFIX}:${salt}:${key}`
}

export function verifyPairingPin(pinHash: string, pin: string): boolean {
  if (!isValidPairingPin(pin)) return false

  const [prefix, salt, expectedKey] = pinHash.split(':')
  if (prefix !== PIN_HASH_PREFIX || !salt || !expectedKey) return false

  const actual = scryptSync(pin, salt, PIN_KEY_LENGTH)
  const expected = Buffer.from(expectedKey, 'base64url')
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}
