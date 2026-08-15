export function normalizeSessionOrigin(value: string): string {
	const parsed = new URL(value);
	if (
		parsed.protocol !== 'https:' ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new TypeError('The session origin must be an exact HTTPS origin.');
	}
	return parsed.origin;
}
