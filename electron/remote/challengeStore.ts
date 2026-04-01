import { randomBytes, randomUUID } from 'node:crypto'

export type DeviceChallengePayload = {
  action: 'open-terminal-session'
  challengeId: string
  deviceId: string
  expiresAt: string
  issuedAt: string
  nonce: string
  origin: string
}

type AuthChallenge = {
  deviceId: string
  expiresAt: number
  payload: DeviceChallengePayload
  used: boolean
}

const CHALLENGE_TTL_MS = 60 * 1000

export function serializeDeviceChallenge(payload: DeviceChallengePayload): string {
  return JSON.stringify(payload)
}

export class ChallengeStore {
  private readonly challenges = new Map<string, AuthChallenge>()

  async create(options: {
    deviceId: string
    origin: string
  }): Promise<{
    payload: DeviceChallengePayload
    signingInput: string
  }> {
    const challengeId = randomUUID()
    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS)

    const payload: DeviceChallengePayload = {
      action: 'open-terminal-session',
      challengeId,
      deviceId: options.deviceId,
      expiresAt: expiresAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      nonce: randomBytes(24).toString('base64url'),
      origin: options.origin,
    }

    this.challenges.set(challengeId, {
      deviceId: options.deviceId,
      expiresAt: expiresAt.getTime(),
      payload,
      used: false,
    })

    return {
      payload,
      signingInput: serializeDeviceChallenge(payload),
    }
  }

  consume(challengeId: string, deviceId: string, origin: string): AuthChallenge {
    const challenge = this.challenges.get(challengeId)
    if (!challenge) {
      throw new Error('This authentication challenge is no longer valid.')
    }

    this.challenges.delete(challengeId)

    if (challenge.used || challenge.expiresAt < Date.now()) {
      throw new Error('This authentication challenge has expired.')
    }

    if (challenge.deviceId !== deviceId || challenge.payload.origin !== origin) {
      throw new Error('This authentication challenge does not match this device or origin.')
    }

    challenge.used = true
    return challenge
  }
}
