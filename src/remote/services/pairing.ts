export type PairingBootstrap = {
  pairingExpiresAt: string
  pairingSessionId: string
  pairingToken: string
}

function normalizePairingInput(input: string): string {
  return input
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, '')
}

function parseFromUrl(candidate: string): PairingBootstrap | null {
  try {
    const url = new URL(candidate)
    // Pairing material is a one-time fragment. Query credentials leak through
    // history, referrers, proxies, and Desktop profile parsing, so do not
    // accept a compatibility query form here.
    if (url.searchParams.has('pairingSessionId') || url.searchParams.has('pairingToken') || url.searchParams.has('pairingExpiresAt')) {
      throw new Error('Pairing credentials must be in the URL fragment.')
    }
    const fragmentParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
    const pairingSessionId = readSinglePairingField(fragmentParams, 'pairingSessionId', 256)
    const pairingToken = readSinglePairingField(fragmentParams, 'pairingToken', 4_096)
    const pairingExpiresAt = readSinglePairingField(fragmentParams, 'pairingExpiresAt', 128)

    if (!pairingSessionId || !pairingToken || !pairingExpiresAt) {
      return null
    }

    return {
      pairingExpiresAt,
      pairingSessionId,
      pairingToken,
    }
  } catch (error) {
    if (error instanceof Error && (error.message === 'Pairing credentials must be in the URL fragment.' || error.message.startsWith('Pairing frame contains '))) throw error
    return null
  }
}

/**
 * A pairing fragment is a one-time authenticated frame. Never let repeated
 * fields acquire browser-specific first/last-value semantics: a clipboard,
 * deep link, or relay must describe exactly one session, token, and expiry.
 */
function readSinglePairingField(params: URLSearchParams, name: string, maximumLength: number): string | null {
  const values = params.getAll(name)
  if (values.length > 1) throw new Error(`Pairing frame contains repeated ${name}.`)
  const value = values[0]
  if (value === undefined || value.length === 0) return null
  if (value.length > maximumLength || [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f
  })) {
    throw new Error(`Pairing frame contains an invalid ${name}.`)
  }
  return value
}

function validatePairingExpiry(
  bootstrap: PairingBootstrap,
  now: number,
): PairingBootstrap {
  const expiresAt = Date.parse(bootstrap.pairingExpiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error('Pairing payload is expired or has an invalid expiry.')
  }
  return bootstrap
}

export function parsePairingBootstrap(
  input: string,
  now = Date.now(),
): PairingBootstrap {
  const trimmed = normalizePairingInput(input)
  if (!trimmed) {
    throw new Error('Pairing details are missing.')
  }

  const fromUrl = parseFromUrl(trimmed)
  if (fromUrl) {
    return validatePairingExpiry(fromUrl, now)
  }

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (
      typeof parsed.pairingSessionId === 'string' &&
      typeof parsed.pairingToken === 'string' &&
      typeof parsed.pairingExpiresAt === 'string'
    ) {
      return validatePairingExpiry({
        pairingExpiresAt: parsed.pairingExpiresAt,
        pairingSessionId: parsed.pairingSessionId,
        pairingToken: parsed.pairingToken,
      }, now)
    }
  }

  throw new Error('That pairing payload is not valid.')
}
