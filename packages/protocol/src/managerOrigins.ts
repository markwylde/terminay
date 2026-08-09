/** Browser-safe public manager authority contract. Session hosts are never
 * inferred from the parent domain: callers must compare exact origins/hosts. */
export const TERMINAY_WEB_MANAGER_ORIGIN = 'https://web.terminay.com';
export const TERMINAY_LEGACY_MANAGER_ORIGIN = 'https://app.terminay.com';

export const TERMINAY_WEB_MANAGER_HOST = new URL(TERMINAY_WEB_MANAGER_ORIGIN)
	.hostname;
export const TERMINAY_LEGACY_MANAGER_HOST = new URL(
	TERMINAY_LEGACY_MANAGER_ORIGIN,
).hostname;

export function isTerminayManagerOrigin(value: string): boolean {
	return (
		value === TERMINAY_WEB_MANAGER_ORIGIN ||
		value === TERMINAY_LEGACY_MANAGER_ORIGIN
	);
}

export function isTerminayManagerHost(value: string): boolean {
	const host = value.toLowerCase().replace(/\.$/u, '');
	return (
		host === TERMINAY_WEB_MANAGER_HOST || host === TERMINAY_LEGACY_MANAGER_HOST
	);
}
