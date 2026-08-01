import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import type { ByteTransport } from '@terminay/protocol'
import { createRemoteStreamTransport } from '../../src/shared/remoteStreamTransport'
import type { DesktopDeviceCredentialStore } from './deviceCredentialStore'
import { parseDesktopSignalingBootstrap, type DesktopSignalingBootstrap } from './desktopSignalingBootstrap'

type FetchResponse = Readonly<{ ok: boolean; json: () => Promise<unknown> }>

export type DesktopReconnectFetch = (
  input: string,
  init: Readonly<{ body: string; headers: Readonly<Record<string, string>>; method: 'POST'; signal?: AbortSignal }>,
) => Promise<FetchResponse>

const REQUEST_TIMEOUT_MS = 15_000
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

export interface DesktopReconnectTransport {
  /** Exact server origin; no credential material is represented here. */
  readonly origin: string
  /** Short-lived application ticket expiry, for host retry diagnostics only. */
  readonly expiresAt: number
  readonly transport: ByteTransport
  /** Present only when a compatible hosted service supplies native signaling bootstrap. */
  readonly signalingBootstrap?: DesktopSignalingBootstrap
}

/**
 * Turn a paired Desktop credential into the same short-lived application
 * transport used by a browser reconnect.  The durable grant is never exposed
 * from DesktopDeviceCredentialStore: only its opaque handle and an HMAC proof
 * cross this main-process boundary.
 */
export async function createDesktopReconnectTransport(options: Readonly<{
  readonly origin: string
  readonly store: DesktopDeviceCredentialStore
  readonly fetch?: DesktopReconnectFetch
  readonly clientNonce?: string
  readonly requestTimeoutMs?: number
}>): Promise<DesktopReconnectTransport> {
  const origin = normalizeOrigin(options.origin)
  const fetchImplementation = options.fetch ?? (globalThis.fetch as unknown as DesktopReconnectFetch)
  if (typeof fetchImplementation !== 'function') throw new Error('Desktop reconnect requires a network fetch implementation.')
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new RangeError('Desktop reconnect request timeout must be between 1 and 30 seconds.')
  }
  const clientNonce = options.clientNonce ?? randomBytes(24).toString('base64url')
  if (!TOKEN.test(clientNonce)) throw new TypeError('Desktop reconnect nonce is invalid.')

  // The opaque grant handle is intentionally the only credential-store value
  // sent to the public challenge endpoint.  It cannot authenticate a request
  // on its own and is never made available to a renderer.
  const challengeHandle = await options.store.reconnectHandle(origin)
  const challenge = await postJson(fetchImplementation, origin, '/protocol/reconnect/challenge', {
    handle: challengeHandle,
    clientNonce,
  }, timeoutMs)
  const normalizedChallenge = parseChallenge(challenge, challengeHandle, clientNonce)
  const completed = await options.store.proveReconnectChallenge(origin, normalizedChallenge.signingInput)
  if (completed.handle !== normalizedChallenge.handle) throw new Error('Desktop reconnect credential changed during the challenge.')
  const completion = await postJson(fetchImplementation, origin, '/protocol/reconnect/complete', {
    attemptId: normalizedChallenge.attemptId,
    handle: normalizedChallenge.handle,
    clientNonce,
    proof: completed.proof,
  }, timeoutMs)
  const ticket = parseTicket(completion, origin)
  // createRemoteStreamTransport deliberately parses the fragment in memory and
  // sends the short-lived ticket in the WebSocket subprotocol header. It is not
  // stored and it is not appended to the stream URL.
  const { transport } = createRemoteStreamTransport(`${origin}/#${ticket.token}`, {
    WebSocket: WebSocket as unknown as import('@terminay/client-core').WebSocketConstructorLike,
  })
  return Object.freeze({
    origin,
    expiresAt: ticket.expiresAt,
    transport,
    ...(ticket.signalingBootstrap === undefined ? {} : { signalingBootstrap: ticket.signalingBootstrap }),
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

function parseChallenge(value: unknown, handle: string, clientNonce: string): Readonly<{ attemptId: string; handle: string; signingInput: string }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Desktop reconnect returned an invalid challenge.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !['attemptId', 'handle', 'clientNonce', 'signingInput'].includes(key))) throw new Error('Desktop reconnect returned an invalid challenge.')
  if (typeof input.attemptId !== 'string' || !ID.test(input.attemptId) || input.handle !== handle || input.clientNonce !== clientNonce || typeof input.signingInput !== 'string' || input.signingInput.length < 1 || input.signingInput.length > 16_384) {
    throw new Error('Desktop reconnect returned an invalid challenge.')
  }
  return Object.freeze({ attemptId: input.attemptId, handle, signingInput: input.signingInput })
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
