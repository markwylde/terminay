import { PRODUCTION_HOSTED_ENDPOINTS } from './hostedEndpoints.js';

/** The production connection-manager origin, which is the default App Server
 * (ADR-0136). Session hosts are never inferred from the manager: callers
 * match origins against the configured Session Server template. */
export const TERMINAY_MANAGER_ORIGIN = PRODUCTION_HOSTED_ENDPOINTS.appServer;
export const TERMINAY_MANAGER_HOST = new URL(TERMINAY_MANAGER_ORIGIN).hostname;

export function isTerminayManagerOrigin(value: string): boolean {
	return value === TERMINAY_MANAGER_ORIGIN;
}

export function isTerminayManagerHost(value: string): boolean {
	const host = value.toLowerCase().replace(/\.$/u, '');
	return host === TERMINAY_MANAGER_HOST;
}
