import {
	type HostedEndpoints,
	isAppServerOrigin,
	managerOriginFromSessionOrigin,
	matchHostedSessionOrigin,
	recognisedHostedEndpoints,
} from '@terminay/protocol';

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

export function pairingUrlForEndpoint(
	handoff: Readonly<{ pairingUrl: string }>,
	protocolEndpoint: string,
	endpoints?: HostedEndpoints,
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
			managerOriginFromSessionOrigin(endpoint.origin, endpoints),
		).host;
		return advertised.toString();
	}
	advertised.host = endpoint.host;
	return advertised.toString();
}

export function advertisedPairingUrlClass(
	pairingUrl: string,
	endpoints?: HostedEndpoints,
): 'manager' | 'session' | 'direct' | 'other' {
	try {
		const url = new URL(pairingUrl);
		if (
			recognisedHostedEndpoints(endpoints).some((candidate) =>
				isAppServerOrigin(candidate, url.origin),
			)
		)
			return 'manager';
		if (matchHostedSessionOrigin(url.origin, endpoints)) return 'session';
		if (url.protocol === 'https:' && /^\/v1\/?$/u.test(url.pathname))
			return 'direct';
		return 'other';
	} catch {
		return 'other';
	}
}
