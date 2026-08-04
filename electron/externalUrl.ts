const MAX_EXTERNAL_URL_LENGTH = 8_192

/** Normalize the only URL class the legacy Electron shell may hand to the OS.
 * Application/server windows have their own navigation policies; this helper
 * is exclusively for an explicit external-link action. */
export function normalizeExternalHttpsUrl(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH || !/^https:\/\//iu.test(value) || hasUnsafeUrlCodePoint(value)) {
		throw new TypeError('External links must be valid HTTPS URLs.')
	}

	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		throw new TypeError('External links must be valid HTTPS URLs.')
	}
	if (parsed.protocol !== 'https:' || parsed.username.length > 0 || parsed.password.length > 0 || parsed.hostname.length === 0) {
		throw new TypeError('External links must be credential-free HTTPS URLs.')
	}
	if (parsed.port === '443') parsed.port = ''
	return parsed.toString()
}

function hasUnsafeUrlCodePoint(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0)
		if (character === '\\' || codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) return true
	}
	return false
}
