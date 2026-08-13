export function createWebClientId(prefix = 'web'): string {
	const suffix = crypto.randomUUID();
	return `${prefix}-${suffix}`;
}
