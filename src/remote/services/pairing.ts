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
    const fragmentParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
    const pairingSessionId = fragmentParams.get('pairingSessionId') || url.searchParams.get('pairingSessionId')
    const pairingToken = fragmentParams.get('pairingToken') || url.searchParams.get('pairingToken')
    const pairingExpiresAt = fragmentParams.get('pairingExpiresAt') || url.searchParams.get('pairingExpiresAt')

    if (!pairingSessionId || !pairingToken || !pairingExpiresAt) {
      return null
    }

    return {
      pairingExpiresAt,
      pairingSessionId,
      pairingToken,
    }
  } catch {
    return null
  }
}

export function parsePairingBootstrap(input: string): PairingBootstrap {
  const trimmed = normalizePairingInput(input)
  if (!trimmed) {
    throw new Error('Pairing details are missing.')
  }

  const fromUrl = parseFromUrl(trimmed)
  if (fromUrl) {
    return fromUrl
  }

  const currentUrl = new URL(window.location.href)
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (
      typeof parsed.pairingSessionId === 'string' &&
      typeof parsed.pairingToken === 'string' &&
      typeof parsed.pairingExpiresAt === 'string'
    ) {
      return {
        pairingExpiresAt: parsed.pairingExpiresAt,
        pairingSessionId: parsed.pairingSessionId,
        pairingToken: parsed.pairingToken,
      }
    }
  }

  if (
    currentUrl.searchParams.has('pairingSessionId') &&
    currentUrl.searchParams.has('pairingToken') &&
    currentUrl.searchParams.has('pairingExpiresAt')
  ) {
    return {
      pairingExpiresAt: currentUrl.searchParams.get('pairingExpiresAt') ?? '',
      pairingSessionId: currentUrl.searchParams.get('pairingSessionId') ?? '',
      pairingToken: currentUrl.searchParams.get('pairingToken') ?? '',
    }
  }

  const currentFragmentParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash)
  if (
    currentFragmentParams.has('pairingSessionId') &&
    currentFragmentParams.has('pairingToken') &&
    currentFragmentParams.has('pairingExpiresAt')
  ) {
    return {
      pairingExpiresAt: currentFragmentParams.get('pairingExpiresAt') ?? '',
      pairingSessionId: currentFragmentParams.get('pairingSessionId') ?? '',
      pairingToken: currentFragmentParams.get('pairingToken') ?? '',
    }
  }

  throw new Error('That pairing payload is not valid.')
}
