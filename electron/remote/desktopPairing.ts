import { parseHostedPairingUrl } from '@terminay/protocol'
import { establishDevicePairing } from '../../src/remote/services/devicePairingFlow'
import { parsePairingBootstrap } from '../../src/remote/services/pairing'
import type { DesktopDeviceCredentialStore, PinnedDesktopHostKey } from './deviceCredentialStore'
import {
  type DesktopHostedSignalOptions,
  pairDesktopHostedDevice,
} from './desktopHostedConnection'
import type { HostedIceServer } from '../../apps/terminay-server/src/remote/hostedPeerLifecycle'

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

export type DesktopPairingTarget =
  | Readonly<{ kind: 'hosted'; label: string; origin: string }>
  | Readonly<{
      kind: 'loopback'
      bootstrap: ReturnType<typeof parsePairingBootstrap>
      label: string
      origin: string
    }>

/**
 * Desktop receives pairing URLs from an untrusted clipboard/renderer input.
 * Classify before anything else can run: a hosted link (app.terminay.com or a
 * session origin) pairs only over the transport-authenticated data channels;
 * a loopback embedded-server link keeps its same-machine HTTP enrollment.
 */
export function resolveDesktopPairingTarget(pairingUrl: string): DesktopPairingTarget {
  try {
    const hosted = parseHostedPairingUrl(pairingUrl)
    const loopback = new URL(hosted.origin)
    const isLoopbackHttp = loopback.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(loopback.hostname)
    if (!isLoopbackHttp) {
      return Object.freeze({ kind: 'hosted', label: hosted.label, origin: hosted.origin })
    }
  } catch (hostedError) {
    if (!(hostedError instanceof TypeError)) throw hostedError
  }
  const url = new URL(pairingUrl)
  const isLoopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!isLoopbackHttp || url.username || url.password || url.pathname !== '/' || url.search) {
    throw new TypeError('Desktop pairing URL must be a Terminay pairing link or a loopback embedded-server link.')
  }
  const bootstrap = parsePairingBootstrap(pairingUrl)
  if (!(Date.parse(bootstrap.pairingExpiresAt) > Date.now())) {
    throw new Error('Desktop pairing URL is expired or has an invalid expiry.')
  }
  return Object.freeze({ kind: 'loopback', bootstrap, label: url.host, origin: url.origin })
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
    void request.catch(() => undefined)
  }
}

/**
 * Pair Desktop with a server. Hosted links run entirely on the verified
 * WebRTC data channels and pin the host key beside the device key; loopback
 * embedded-server links use same-machine HTTP where the one-time fragment is
 * the whole authority. No pairing material is ever sent to a hosted origin
 * over HTTP.
 */
export async function establishDesktopDevicePairing(options: Readonly<{
  deviceName: string
  fetch?: DesktopPairingFetch
  pairingUrl: string
  pairingRequestTimeoutMs?: number
  store: DesktopDeviceCredentialStore
  hostPin?: PinnedDesktopHostKey
  hosted?: Readonly<{
    webrtcRuntimeRoot: string | undefined
    iceServers?: readonly HostedIceServer[]
    signal?: DesktopHostedSignalOptions
    abort?: AbortSignal
    onMatchCode?: (code: Readonly<{ matchCode: string; expiresAt: number }>) => void
  }>
}>): Promise<Readonly<{ deviceId: string; deviceName: string; label: string; origin: string; serverId?: string }>> {
  const target = resolveDesktopPairingTarget(options.pairingUrl)
  if (target.kind === 'hosted') {
    const runtimeRoot = options.hosted?.webrtcRuntimeRoot
    if (runtimeRoot === undefined) {
      throw new Error(
        'The selected WebRTC runtime directory is unavailable, so Desktop cannot pair with a hosted server. Package the runtime, or set TERMINAY_WEBRTC_RUNTIME_ROOT in development.',
      )
    }
    return pairDesktopHostedDevice({
      pairingUrl: options.pairingUrl,
      deviceName: options.deviceName,
      store: options.store,
      webrtcRuntimeRoot: runtimeRoot,
      ...(options.hosted?.iceServers === undefined ? {} : { iceServers: options.hosted.iceServers }),
      ...(options.hosted?.signal === undefined ? {} : { signal: options.hosted.signal }),
      ...(options.hosted?.abort === undefined ? {} : { abort: options.hosted.abort }),
      ...(options.hosted?.onMatchCode === undefined ? {} : { onMatchCode: options.hosted.onMatchCode }),
    })
  }
  const fetchImplementation = options.fetch ?? (globalThis.fetch as unknown as DesktopPairingFetch)
  if (typeof fetchImplementation !== 'function') throw new Error('Desktop pairing requires a network fetch implementation.')
  const pairingRequestTimeoutMs = options.pairingRequestTimeoutMs ?? DEFAULT_PAIRING_REQUEST_TIMEOUT_MS
  if (!Number.isInteger(pairingRequestTimeoutMs) || pairingRequestTimeoutMs < 1_000 || pairingRequestTimeoutMs > 30_000) {
    throw new RangeError('Desktop pairing request timeout must be between 1 and 30 seconds.')
  }
  const origin = target.origin
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
    bootstrap: target.bootstrap,
    credentials: {
      saveDeviceIdentity: async (identity) => {
        await options.store.saveDeviceIdentity({
          ...identity,
          ...(options.hostPin === undefined ? {} : { hostPin: options.hostPin }),
        })
      },
    },
    deviceName: options.deviceName,
    generateKeyPair: async () => {
      const key = options.store.createDeviceKey(origin)
      return Object.freeze({ privateKey: key.keyRef, publicKeyPem: key.publicKeyPem })
    },
    origin,
  })
  return Object.freeze({ deviceId: result.deviceId, deviceName: result.deviceName, label: target.label, origin })
}
