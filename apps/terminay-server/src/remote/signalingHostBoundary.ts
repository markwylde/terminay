/**
 * Keeps the public connection-manager host out of the authenticated signaling
 * plane. A concrete relay must call this guard before accepting an HTTP
 * upgrade; the Host header is deliberately compared with the configured,
 * isolated session origin rather than with a URL supplied by the client.
 */
export interface SignalingUpgradeBoundaryOptions {
	/** Public, non-secret connection-manager origin (for example app.terminay.com). */
	readonly managerOrigin: string;
	/** Exact isolated origin assigned to this Terminay Server session. */
	readonly sessionOrigin: string;
	/** WebSocket endpoint path. Defaults to the hosted relay's canonical /signal. */
	readonly signalingPath?: string;
}

export interface SignalingUpgradeRequest {
	readonly host: string | undefined;
	readonly upgrade: string | undefined;
	readonly url: string | undefined;
}

export interface AcceptedSignalingUpgrade {
	readonly sessionOrigin: string;
	readonly signalingPath: string;
}

/**
 * Validates the host-routing boundary before a signaling WebSocket is
 * allocated. This does not authenticate a room or a device; it only makes it
 * impossible for a manager-only host to become a signaling endpoint.
 */
export function acceptSessionSignalingUpgrade(
	request: SignalingUpgradeRequest,
	options: SignalingUpgradeBoundaryOptions,
): AcceptedSignalingUpgrade {
	const manager = parseHttpsOrigin(options.managerOrigin, 'manager origin');
	const session = parseHttpsOrigin(options.sessionOrigin, 'session origin');
	if (manager.origin === session.origin) {
		throw new TypeError('manager and session origins must be distinct');
	}
	const signalingPath = options.signalingPath ?? '/signal';
	if (!signalingPath.startsWith('/') || signalingPath.startsWith('//') || signalingPath.includes('?') || signalingPath.includes('#')) {
		throw new TypeError('signaling path is invalid');
	}
	if (request.upgrade?.trim().toLowerCase() !== 'websocket') {
		throw new Error('signaling upgrade is required');
	}
	if (request.host === undefined || request.host === '') {
		throw new Error('signaling upgrade host is required');
	}
	// Node normally exposes one Host header, but a concrete relay can be fed a
	// hand-built upgrade request in tests or by another adapter. Do not normalize
	// whitespace, comma-separated values, or control characters into the
	// authenticated session host: ambiguous authority framing must fail before a
	// signaling connection can be allocated.
	if (!isCanonicalHostHeader(request.host)) {
		throw new Error('signaling upgrade host is invalid');
	}
	const host = request.host.toLowerCase();
	if (host === manager.host) {
		throw new Error('manager-only host cannot accept signaling upgrades');
	}
	if (host !== session.host) {
		throw new Error('signaling upgrade host does not match the session origin');
	}
	if (request.url !== signalingPath) {
		throw new Error('signaling upgrade path is invalid');
	}
	return Object.freeze({ sessionOrigin: session.origin, signalingPath });
}

function isCanonicalHostHeader(value: string): boolean {
	return value.trim() === value
		&& ![...value].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code <= 0x20 || code === 0x7f || character === ",";
		});
}

function parseHttpsOrigin(value: string, name: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError(`${name} is invalid`);
	}
	if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '' || parsed.username !== '' || parsed.password !== '') {
		throw new TypeError(`${name} must be an HTTPS origin`);
	}
	return parsed;
}
