const PAIRING_QUERY_KEYS = ['pairingSessionId', 'pairingToken', 'pairingExpiresAt'] as const
const PAIRING_FRAGMENT_KEYS = [...PAIRING_QUERY_KEYS, 'pairingFlow'] as const
const MAX_PAIRING_FRAGMENT_LENGTH = 4096

/**
 * Validate the one-time URL used to open a remote client window. The URL is
 * passed through to the isolated remote renderer, but is never persisted by
 * the Desktop host.
 */
export function normalizeRemoteConnectionUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0 || rawUrl.length > 16_384) {
    throw new TypeError('Paste a valid Terminay pairing URL.')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new TypeError('Paste a valid Terminay pairing URL.')
  }

  const isLoopbackHttp = parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
  if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
    throw new TypeError('Pairing URLs must use HTTPS or loopback HTTP.')
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('Pairing URLs cannot contain credentials.')
  }

  if (parsed.search.length > 0) {
    throw new TypeError('Pairing credentials must be in the URL fragment.')
  }

  if (parsed.hash.length <= 1) {
    throw new TypeError('That URL does not contain a Terminay pairing payload.')
  }

  let fragment: string
  try {
    fragment = decodeURIComponent(parsed.hash.slice(1))
  } catch {
    throw new TypeError('The pairing URL fragment is invalid.')
  }
  if (fragment.length < 16 || fragment.length > MAX_PAIRING_FRAGMENT_LENGTH || hasControlCharacter(fragment)) {
    throw new TypeError('The pairing URL fragment is invalid.')
  }

  const fragmentParams = new URLSearchParams(fragment)
  const pairingKeysPresent = PAIRING_QUERY_KEYS.filter((key) => fragmentParams.has(key))
  if (pairingKeysPresent.length > 0) {
    if (pairingKeysPresent.length !== PAIRING_QUERY_KEYS.length) {
      throw new TypeError('The pairing URL is missing required pairing details.')
    }
    if ([...fragmentParams.keys()].some((key) => !(PAIRING_FRAGMENT_KEYS as readonly string[]).includes(key))) {
      throw new TypeError('The pairing URL contains unsupported fragment data.')
    }
    const pairingFlow = fragmentParams.get('pairingFlow')
    if (pairingFlow !== null && pairingFlow !== 'device') {
      throw new TypeError('The pairing URL contains an unsupported pairing flow.')
    }
    const pairingExpiresAt = fragmentParams.get('pairingExpiresAt')?.trim() ?? ''
    if (!pairingExpiresAt || !fragmentParams.get('pairingSessionId')?.trim() || !fragmentParams.get('pairingToken')?.trim()) {
      throw new TypeError('The pairing URL contains an incomplete pairing payload.')
    }
    const expiresAt = Date.parse(pairingExpiresAt)
    if (!Number.isFinite(expiresAt)) throw new TypeError('The pairing URL expiry is invalid.')
    if (expiresAt <= Date.now()) throw new TypeError('This pairing URL has expired. Generate a fresh URL from the server.')
  }

  return parsed.toString()
}

/**
 * Electron's legacy in-process bridge only understands the standalone
 * application protocol carried by a fragment token. A Remote Access URL uses
 * a separate device-pairing exchange and must never be forwarded as though
 * its one-time pairing token were a protocol bearer credential.
 */
export function isRemoteAccessPairingUrl(normalizedUrl: string): boolean {
  const parsed = new URL(normalizedUrl)
  const fragment = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash)
  return fragment.get('pairingFlow') === 'device' && PAIRING_QUERY_KEYS.every((key) => fragment.has(key))
}

/** Convert Chromium navigation failures into an actionable user-facing error. */
export function describeRemoteConnectionLoadError(error: unknown): Error {
  const details = error && typeof error === 'object'
    ? [
        'errorCode' in error ? (error as { errorCode?: unknown }).errorCode : undefined,
        'errorDescription' in error ? (error as { errorDescription?: unknown }).errorDescription : undefined,
        'message' in error ? (error as { message?: unknown }).message : undefined,
      ].filter((value): value is string => typeof value === 'string').join(' ').toUpperCase()
    : String(error ?? '').toUpperCase()
  if (details.includes('CERT')) {
    return new Error('Unable to connect: the remote HTTPS certificate could not be verified.')
  }
  if (details.includes('NAME_NOT_RESOLVED') || details.includes('DNS')) {
    return new Error('Unable to connect: the remote server hostname could not be resolved.')
  }
  if (details.includes('CONNECTION_REFUSED') || details.includes('TIMED_OUT') || details.includes('TIMEOUT')) {
    return new Error('Unable to connect: the remote server refused or timed out the connection.')
  }
  return new Error('Unable to load the remote Terminay server. Check the URL and that the server is reachable.')
}

/**
 * A remote connection window may navigate only within the origin selected by
 * its one-time pairing URL. The window has no host bridge, so navigation is
 * the remaining way untrusted server content could try to escape its bound
 * origin.
 */
export function isAllowedRemoteConnectionNavigation(
  rawUrl: unknown,
  expectedOrigin: string,
): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 16_384) {
    return false
  }

  try {
    const parsed = new URL(rawUrl)
    const expected = new URL(expectedOrigin)
    if (parsed.origin !== expected.origin) return false
    if (parsed.username || parsed.password) return false
    return parsed.protocol === 'https:' || (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f
  })
}
