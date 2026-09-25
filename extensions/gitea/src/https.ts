/**
 * A credential-free HTTPS URL. Kept local rather than imported from the SDK so
 * the extension's runtime needs nothing from the SDK beyond `defineExtension`,
 * and the host validates every publication again anyway.
 */
export function isSafeHttpsUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 2_048)
		return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			url.username === '' &&
			url.password === '' &&
			url.hostname.length > 0
		);
	} catch {
		return false;
	}
}

/** The origin of an HTTP(S) URL, or undefined. */
export function originOf(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
		return url.origin;
	} catch {
		return undefined;
	}
}
