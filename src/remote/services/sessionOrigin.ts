const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A session origin is exact HTTPS, or loopback HTTP for an embedded local
 * server and loopback development relays. Nothing else is a credential home. */
export function normalizeSessionOrigin(value: string): string {
	const parsed = new URL(value);
	const hostname = parsed.hostname.toLowerCase();
	const loopbackHttp =
		parsed.protocol === 'http:' &&
		(LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost'));
	if (
		(parsed.protocol !== 'https:' && !loopbackHttp) ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new TypeError('The session origin must be an exact HTTPS origin or a loopback HTTP origin.');
	}
	return parsed.origin;
}
