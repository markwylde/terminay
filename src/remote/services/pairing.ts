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
    const pairingSessionId = url.searchParams.get('pairingSessionId')
    const pairingToken = url.searchParams.get('pairingToken')
    const pairingExpiresAt = url.searchParams.get('pairingExpiresAt')

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

  throw new Error('That pairing payload is not valid.')
}
