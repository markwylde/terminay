import { establishDevicePairing } from '../../src/remote/services/devicePairingFlow'
import { parsePairingBootstrap } from '../../src/remote/services/pairing'
import type { DesktopDeviceCredentialStore } from './deviceCredentialStore'

type FetchResponse = Readonly<{
  ok: boolean
  json: () => Promise<unknown>
}>

type DesktopPairingFetchInit = Readonly<{
  body: string
  headers: Readonly<Record<string, string>>
  method: 'POST'
  signal?: AbortSignal
}>

export type DesktopPairingFetch = (
  input: string,
  init: DesktopPairingFetchInit,
) => Promise<FetchResponse>

const DEFAULT_PAIRING_REQUEST_TIMEOUT_MS = 15_000

/**
 * Desktop receives pairing URLs from an untrusted clipboard/renderer input.
 * Do this validation before the pairing flow can issue either network request:
 * a pairing bootstrap identifies a server origin, not an arbitrary endpoint.
 */
function resolveDesktopPairingOrigin(pairingUrl: string): string {
  const url = new URL(pairingUrl)
  const isLoopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !isLoopbackHttp) || url.username || url.password || url.pathname !== '/' || url.search) {
    throw new TypeError('Desktop pairing URL must be an exact HTTPS or loopback HTTP origin with a fragment.')
  }
  return url.origin
}

function assertUsableDesktopPairingBootstrap(bootstrap: Readonly<{ pairingExpiresAt: string }>): void {
  const expiresAt = Date.parse(bootstrap.pairingExpiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Desktop pairing URL is expired or has an invalid expiry.')
  }
}

async function postWithTimeout(
  fetchImplementation: DesktopPairingFetch,
  input: string,
  init: Omit<DesktopPairingFetchInit, 'signal'>,
  timeoutMs: number,
): Promise<FetchResponse> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const request = Promise.resolve(fetchImplementation(input, Object.freeze({ ...init, signal: controller.signal })))
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Desktop device pairing timed out. Check the server URL and try again.'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    // A custom test/host fetch implementation may ignore AbortSignal. Attach a
    // handler so a later rejection cannot become an unhandled promise after we
    // have already failed the explicitly bounded pairing operation.
    void request.catch(() => undefined)
  }
}

/**
 * Execute the same one-time device pairing transaction used by the browser,
 * but keep the Desktop private key inside the main-process encrypted credential
 * store. The pairing URL is deliberately only used for
 * this transaction; callers must not reinterpret its fragment token as an
 * application-protocol bearer credential.
 */
export async function establishDesktopDevicePairing(options: Readonly<{
  deviceName: string
  fetch?: DesktopPairingFetch
  pairingPin: string
  pairingUrl: string
  /** Bounds each start/complete request; a stalled server must not leave the
   * Desktop connection dialog in an indeterminate Connecting state. */
  pairingRequestTimeoutMs?: number
  store: DesktopDeviceCredentialStore
}>): Promise<Readonly<{ deviceId: string; deviceName: string; origin: string }>> {
  const origin = resolveDesktopPairingOrigin(options.pairingUrl)
  const bootstrap = parsePairingBootstrap(options.pairingUrl)
  assertUsableDesktopPairingBootstrap(bootstrap)
  const fetchImplementation = options.fetch ?? (globalThis.fetch as unknown as DesktopPairingFetch)
  if (typeof fetchImplementation !== 'function') throw new Error('Desktop pairing requires a network fetch implementation.')
  const pairingRequestTimeoutMs = options.pairingRequestTimeoutMs ?? DEFAULT_PAIRING_REQUEST_TIMEOUT_MS
  if (!Number.isInteger(pairingRequestTimeoutMs) || pairingRequestTimeoutMs < 1_000 || pairingRequestTimeoutMs > 30_000) {
    throw new RangeError('Desktop pairing request timeout must be between 1 and 30 seconds.')
  }

  const result = await establishDevicePairing({
    api: {
      async postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> {
        if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
          throw new TypeError('Desktop pairing endpoint is invalid.')
        }
        const response = await postWithTimeout(fetchImplementation, new URL(pathname, origin).toString(), {
          body: JSON.stringify(body),
          headers: Object.freeze({ 'content-type': 'application/json' }),
          method: 'POST',
        }, pairingRequestTimeoutMs)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          const error = typeof payload === 'object' && payload !== null && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
            ? (payload as { error: string }).error
            : 'Desktop device pairing failed.'
          throw new Error(error)
        }
        return payload as TResponse
      },
    },
    bootstrap,
    credentials: options.store,
    deviceName: options.deviceName,
    generateKeyPair: async () => {
      const key = options.store.createDeviceKey(origin)
      return Object.freeze({ privateKey: key.keyRef, publicKeyPem: key.publicKeyPem })
    },
    origin,
    pairingPin: options.pairingPin,
  })
  return Object.freeze({ deviceId: result.deviceId, deviceName: result.deviceName, origin })
}
