/** Browser-safe public manager authority contract. Session hosts are never
 * inferred from the parent domain: callers must compare exact origins/hosts. */
export const TERMINAY_MANAGER_ORIGIN = 'https://app.terminay.com';
export const TERMINAY_MANAGER_HOST = new URL(TERMINAY_MANAGER_ORIGIN).hostname;

export function isTerminayManagerOrigin(value: string): boolean {
	return value === TERMINAY_MANAGER_ORIGIN;
}

export function isTerminayManagerHost(value: string): boolean {
	const host = value.toLowerCase().replace(/\.$/u, '');
	return host === TERMINAY_MANAGER_HOST;
}
