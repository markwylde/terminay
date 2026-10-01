import { managerOriginFromSessionOrigin } from '@terminay/protocol';

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

export function pairingUrlForEndpoint(
	handoff: Readonly<{ pairingUrl: string }>,
	protocolEndpoint: string,
): string {
	const advertised = new URL(handoff.pairingUrl);
	const endpoint = new URL(protocolEndpoint);
	// A wildcard is a bind address, not a public endpoint. Keep the server's
	// actual advertised handoff instead of manufacturing an unusable URL.
	if (WILDCARD_HOSTS.has(endpoint.hostname.toLowerCase()))
		return advertised.toString();
	advertised.protocol = endpoint.protocol;
	if (advertised.searchParams.has('s')) {
		advertised.host = new URL(
			managerOriginFromSessionOrigin(endpoint.origin),
		).host;
		return advertised.toString();
	}
	advertised.host = endpoint.host;
	return advertised.toString();
}

export function advertisedPairingUrlClass(
	pairingUrl: string,
): 'manager' | 'session' | 'direct' | 'other' {
	try {
		const url = new URL(pairingUrl);
		const host = url.hostname.toLowerCase();
		if (host === 'app.terminay.com') return 'manager';
		if (host.endsWith('.terminay.com')) return 'session';
		if (url.protocol === 'https:' && /^\/v1\/?$/u.test(url.pathname))
			return 'direct';
		return 'other';
	} catch {
		return 'other';
	}
}
