import WebSocket from 'ws'
import type { ByteTransport } from '@terminay/protocol'
import { createRemoteStreamTransport } from '../../src/shared/remoteStreamTransport'
import type { DesktopDeviceCredentialStore, PinnedDesktopHostKey } from './deviceCredentialStore'
import { parseDesktopSignalingBootstrap, type DesktopSignalingBootstrap } from './desktopSignalingBootstrap'

type FetchResponse = Readonly<{ ok: boolean; json: () => Promise<unknown> }>

export type DesktopReconnectFetch = (
  input: string,
  init: Readonly<{ body: string; headers: Readonly<Record<string, string>>; method: 'POST'; signal?: AbortSignal }>,
) => Promise<FetchResponse>

const REQUEST_TIMEOUT_MS = 15_000
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/u

export interface DesktopReconnectTransport {
  /** Exact server origin; no credential material is represented here. */
  readonly origin: string
  readonly deviceId: string
  /** Short-lived application ticket expiry, for host retry diagnostics only. */
  readonly expiresAt: number
  readonly transport: ByteTransport
  /** Present only when a compatible hosted service supplies native signaling bootstrap. */
  readonly signalingBootstrap?: DesktopSignalingBootstrap
  /** Verified host pin required before any Desktop WebRTC remote description. */
  readonly pinnedHostKey?: PinnedDesktopHostKey
}

/**
 * Turn a paired Desktop credential into the same short-lived application
 * transport used by a browser reconnect. The protected private device key
 * signs a short-lived server challenge; no second durable credential exists.
 */
export async function createDesktopReconnectTransport(options: Readonly<{
  readonly origin: string
  readonly store: DesktopDeviceCredentialStore
  readonly fetch?: DesktopReconnectFetch
  readonly requestTimeoutMs?: number
}>): Promise<DesktopReconnectTransport> {
  const origin = normalizeOrigin(options.origin)
  const fetchImplementation = options.fetch ?? (globalThis.fetch as unknown as DesktopReconnectFetch)
  if (typeof fetchImplementation !== 'function') throw new Error('Desktop reconnect requires a network fetch implementation.')
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new RangeError('Desktop reconnect request timeout must be between 1 and 30 seconds.')
  }
  const device = await options.store.loadDevice(origin)
  if (device === null) throw new Error('No paired device exists for this server origin.')
  const pinnedHostKey = await options.store.loadPinnedHostKey(origin)
  const challenge = await postJson(fetchImplementation, origin, '/api/devices/challenge', {
    deviceId: device.deviceId,
  }, timeoutMs)
  const normalizedChallenge = parseChallenge(challenge, origin, device.deviceId)
  const deviceSignature = await options.store.signChallenge(origin, normalizedChallenge.signingInput)
  const completion = await postJson(fetchImplementation, origin, '/api/devices/verify', {
    challengeId: normalizedChallenge.challengeId,
    deviceId: device.deviceId,
    deviceSignature,
  }, timeoutMs)
  const ticket = parseTicket(completion, origin)
  if (ticket.signalingBootstrap !== undefined && pinnedHostKey === null) {
    throw new Error('Server host identity is not pinned; explicit re-pairing is required.')
  }
  // createRemoteStreamTransport deliberately parses the fragment in memory and
  // sends the short-lived ticket in the WebSocket subprotocol header. It is not
  // stored and it is not appended to the stream URL.
  const { transport } = createRemoteStreamTransport(`${origin}/#${ticket.token}`, {
    WebSocket: WebSocket as unknown as import('@terminay/client-core').WebSocketConstructorLike,
  })
  return Object.freeze({
    origin,
    deviceId: device.deviceId,
    expiresAt: ticket.expiresAt,
    transport,
    ...(ticket.signalingBootstrap === undefined ? {} : { signalingBootstrap: ticket.signalingBootstrap }),
    ...(pinnedHostKey === null ? {} : { pinnedHostKey }),
  })
}

async function postJson(fetchImplementation: DesktopReconnectFetch, origin: string, pathname: string, body: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const request = Promise.resolve(fetchImplementation(new URL(pathname, origin).toString(), Object.freeze({
    body: JSON.stringify(body),
    headers: Object.freeze({ 'content-type': 'application/json' }),
    method: 'POST',
    signal: controller.signal,
  }))).then(async (response) => {
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error('Desktop reconnect was denied by the server.')
    return payload
  })
  try {
    const response = await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Desktop reconnect timed out. Check the server and try again.'))
        }, timeoutMs)
      }),
    ])
    return response
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    void request.catch(() => undefined)
  }
}

function parseChallenge(value: unknown, origin: string, deviceId: string): Readonly<{ challengeId: string; signingInput: string }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Desktop reconnect returned an invalid challenge.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !['challenge', 'signingInput'].includes(key)) || typeof input.signingInput !== 'string' || input.signingInput.length < 1 || input.signingInput.length > 16_384 || typeof input.challenge !== 'object' || input.challenge === null || Array.isArray(input.challenge)) {
    throw new Error('Desktop reconnect returned an invalid challenge.')
  }
  const challenge = input.challenge as Record<string, unknown>
  if (Object.keys(challenge).some((key) => !['action', 'challengeId', 'deviceId', 'expiresAt', 'issuedAt', 'nonce', 'origin', 'serverId'].includes(key)) || challenge.action !== 'connect' || typeof challenge.challengeId !== 'string' || !TOKEN.test(challenge.challengeId) || challenge.deviceId !== deviceId || challenge.origin !== origin || typeof challenge.serverId !== 'string' || challenge.serverId.length === 0 || typeof challenge.nonce !== 'string' || !TOKEN.test(challenge.nonce) || typeof challenge.expiresAt !== 'string' || !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= Date.now() || typeof challenge.issuedAt !== 'string' || !Number.isFinite(Date.parse(challenge.issuedAt))) {
    throw new Error('Desktop reconnect returned an invalid challenge.')
  }
  return Object.freeze({ challengeId: challenge.challengeId, signingInput: input.signingInput })
}

function parseTicket(value: unknown, origin: string): Readonly<{ token: string; expiresAt: number; signalingBootstrap?: DesktopSignalingBootstrap }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Desktop reconnect returned an invalid application ticket.')
  const input = value as Record<string, unknown>
  const expiresAt = input.expiresAt
  if (Object.keys(input).some((key) => !['ticket', 'expiresAt', 'webRtc'].includes(key)) || typeof input.ticket !== 'string' || !TOKEN.test(input.ticket) || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Desktop reconnect returned an invalid application ticket.')
  }
  const signalingBootstrap = input.webRtc === undefined
    ? undefined
    : parseDesktopSignalingBootstrap(input.webRtc, origin)
  return Object.freeze({ token: input.ticket, expiresAt, ...(signalingBootstrap === undefined ? {} : { signalingBootstrap }) })
}

function normalizeOrigin(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new TypeError('Desktop reconnect origin is invalid.') }
  const loopbackHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if ((parsed.protocol !== 'https:' && !loopbackHttp) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('Desktop reconnect origin must be an exact HTTPS or loopback HTTP origin.')
  }
  return parsed.origin
}
