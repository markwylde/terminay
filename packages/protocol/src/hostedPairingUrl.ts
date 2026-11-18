import {
	type HostedEndpoints,
	isAppServerOrigin,
	loopbackHostedEndpoints,
	recognisedHostedEndpoints,
	SESSION_ID_PATTERN,
	sessionIdFromOrigin,
	sessionOriginFor,
} from './hostedEndpoints.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MANAGER_QUERY = new Set(['s', 'hostName', 'pairingExpiresAt']);
const SESSION_QUERY = new Set(['hostName', 'pairingExpiresAt']);

export type HostedPairingEnvelope = {
	/** `hosted` links name a session on a hosted relay; `direct` links name a
	 * standalone server's own signaling listener, whose origin is taken
	 * literally and has no hosted session id or connection manager. */
	readonly class: 'hosted' | 'direct';
	readonly fragment: string;
	readonly href: string;
	readonly hostName: string;
	readonly label: string;
	readonly managerHref: string;
	readonly origin: string;
	readonly pairingExpiresAt: string;
	readonly sessionId: string;
};

export function formatHostedPairingUrl(input: {
	readonly fragment: string;
	readonly hostName?: string;
	readonly managerOrigin: string;
	readonly pairingExpiresAt?: string;
	readonly sessionId: string;
}): string {
	const sessionId = normalizeSessionId(input.sessionId);
	const fragment = normalizeFragment(input.fragment);
	const manager = originUrl(input.managerOrigin);
	manager.searchParams.set('s', sessionId);
	const hostName = sanitizePairingHostName(input.hostName ?? '');
	if (hostName) manager.searchParams.set('hostName', hostName);
	const pairingExpiresAt = String(input.pairingExpiresAt ?? '').trim();
	if (pairingExpiresAt)
		manager.searchParams.set('pairingExpiresAt', pairingExpiresAt);
	manager.hash = fragment;
	return manager.toString();
}

/**
 * The endpoints whose Session Server template produced this origin, and the
 * session id it carries. A client recognises its configured endpoints,
 * production, and a loopback development stack on the origin's own port.
 */
export function matchHostedSessionOrigin(
	sessionOrigin: string,
	endpoints?: HostedEndpoints,
): Readonly<{ endpoints: HostedEndpoints; sessionId: string }> | undefined {
	for (const candidate of candidateEndpoints(sessionOrigin, endpoints)) {
		const sessionId = sessionIdFromOrigin(candidate, sessionOrigin);
		if (sessionId !== undefined)
			return Object.freeze({ endpoints: candidate, sessionId });
	}
	return undefined;
}

export function managerOriginFromSessionOrigin(
	sessionOrigin: string,
	endpoints?: HostedEndpoints,
): string {
	const match = matchHostedSessionOrigin(
		originUrl(sessionOrigin).origin,
		endpoints,
	);
	if (!match) throw new TypeError('Hosted session origin is invalid.');
	return match.endpoints.appServer;
}

function candidateEndpoints(
	origin: string,
	endpoints?: HostedEndpoints,
): readonly HostedEndpoints[] {
	const loopback = loopbackHostedEndpoints(origin);
	const recognised = recognisedHostedEndpoints(endpoints);
	return loopback ? [...recognised, loopback] : recognised;
}

function managerEndpointsFor(
	url: URL,
	endpoints?: HostedEndpoints,
): HostedEndpoints | undefined {
	return candidateEndpoints(url.origin, endpoints).find((candidate) =>
		isAppServerOrigin(candidate, url.origin),
	);
}

export function parseHostedPairingUrl(
	value: string,
	endpoints?: HostedEndpoints,
): HostedPairingEnvelope {
	let url: URL;
	try {
		url = new URL(String(value ?? '').trim());
	} catch {
		throw new TypeError('Paste a complete Terminay pairing link.');
	}
	if (url.username || url.password) {
		throw new TypeError('Pairing URLs cannot contain credentials.');
	}
	const isLoopbackHttp =
		url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
	if (
		url.protocol !== 'https:' &&
		!isLoopbackHttp &&
		!isLoopbackSessionHttp(url)
	) {
		throw new TypeError('Pairing URLs must use HTTPS or loopback HTTP.');
	}

	// A server's direct link uses the literal listener origin, including when
	// that listener is published on host loopback. Check its explicit pairing
	// path before the historic loopback-manager interpretation.
	if (
		url.protocol === 'https:' &&
		LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) &&
		/^\/v1\/?$/u.test(url.pathname)
	) {
		return parseDirectPairingUrl(url);
	}
	const manager = managerEndpointsFor(url, endpoints);
	if (manager) return parseManagerPairingUrl(url, manager);
	const session = matchHostedSessionOrigin(url.origin, endpoints);
	if (session) return parseLegacySessionPairingUrl(url, session);
	return parseDirectPairingUrl(url);
}

/**
 * A standalone server serving its own signaling endpoint. The origin is taken
 * exactly as written: it is a machine an operator points at, not a session on
 * a hosted relay, so it has no session id to derive and no manager beside it.
 */
function parseDirectPairingUrl(url: URL): HostedPairingEnvelope {
	if (url.protocol !== 'https:') {
		throw new TypeError('A direct Terminay pairing link must use HTTPS.');
	}
	if (!/^\/v1\/?$/.test(url.pathname)) {
		throw new TypeError('Paste a complete Terminay pairing link.');
	}
	rejectUnknownQuery(url, SESSION_QUERY);
	const fragment = normalizeFragment(url.hash);
	const hostName = sanitizePairingHostName(
		url.searchParams.get('hostName') ?? '',
	);
	const origin = url.origin;
	const href = sessionPairingHref(origin, fragment, hostName);
	return Object.freeze({
		class: 'direct',
		fragment,
		href,
		hostName,
		label: hostName || url.host,
		// A direct endpoint is its own manager: there is no separate
		// connection-manager origin to fall back to.
		managerHref: href,
		origin,
		pairingExpiresAt: String(
			url.searchParams.get('pairingExpiresAt') ?? '',
		).trim(),
		sessionId: '',
	});
}

/**
 * Whether an origin names a session on the hosted relay or a standalone
 * server's own signaling listener.
 *
 * Pairing and reconnect must agree: a client that paired with a direct
 * endpoint reaches the same endpoint later from its saved profile, with the
 * same rules about what its certificate does and does not mean.
 */
export function classifyPairingOrigin(
	origin: string,
	endpoints?: HostedEndpoints,
): 'hosted' | 'direct' {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return 'hosted';
	}
	if (
		url.protocol === 'https:' &&
		LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
	)
		return 'direct';
	if (managerEndpointsFor(url, endpoints)) return 'hosted';
	if (matchHostedSessionOrigin(url.origin, endpoints)) return 'hosted';
	return isLoopbackSessionHttp(url) || LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
		? 'hosted'
		: 'direct';
}

function parseManagerPairingUrl(
	url: URL,
	endpoints: HostedEndpoints,
): HostedPairingEnvelope {
	if (url.pathname !== '/' && url.pathname !== '') {
		throw new TypeError('Paste a complete Terminay pairing link.');
	}
	rejectUnknownQuery(url, MANAGER_QUERY);
	const sessionId = normalizeSessionId(url.searchParams.get('s') ?? '');
	const fragment = normalizeFragment(url.hash);
	const hostName = sanitizePairingHostName(
		url.searchParams.get('hostName') ?? '',
	);
	const origin = sessionOriginFor(endpoints, sessionId);
	const pairingExpiresAt = String(
		url.searchParams.get('pairingExpiresAt') ?? '',
	).trim();
	return Object.freeze({
		class: 'hosted',
		fragment,
		href: sessionPairingHref(origin, fragment, hostName),
		hostName,
		label: hostName || sessionId,
		managerHref: formatHostedPairingUrl({
			fragment,
			hostName,
			managerOrigin: url.origin,
			pairingExpiresAt,
			sessionId,
		}),
		origin,
		pairingExpiresAt,
		sessionId,
	});
}

function parseLegacySessionPairingUrl(
	url: URL,
	session: Readonly<{ endpoints: HostedEndpoints; sessionId: string }>,
): HostedPairingEnvelope {
	if (!/^\/v1\/?$/.test(url.pathname)) {
		throw new TypeError('Paste a complete Terminay pairing link.');
	}
	rejectUnknownQuery(url, SESSION_QUERY);
	const sessionId = session.sessionId;
	const fragment = normalizeFragment(url.hash);
	const hostName = sanitizePairingHostName(
		url.searchParams.get('hostName') ?? '',
	);
	const origin = url.origin;
	const pairingExpiresAt = String(
		url.searchParams.get('pairingExpiresAt') ?? '',
	).trim();
	return Object.freeze({
		class: 'hosted',
		fragment,
		href: sessionPairingHref(origin, fragment, hostName),
		hostName,
		label: hostName || sessionId,
		managerHref: formatHostedPairingUrl({
			fragment,
			hostName,
			managerOrigin: session.endpoints.appServer,
			pairingExpiresAt,
			sessionId,
		}),
		origin,
		pairingExpiresAt,
		sessionId,
	});
}

function sessionPairingHref(
	origin: string,
	fragment: string,
	hostName: string,
): string {
	const url = new URL('/v1/', origin);
	if (hostName) url.searchParams.set('hostName', hostName);
	url.hash = fragment;
	return url.toString();
}

function originUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Hosted pairing origin is invalid.');
	}
	if (
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		url.username = '';
		url.password = '';
		url.pathname = '/';
		url.search = '';
		url.hash = '';
	}
	return url;
}

function isLoopbackSessionHttp(url: URL): boolean {
	if (url.protocol !== 'http:') return false;
	const host = url.hostname.toLowerCase();
	return host.endsWith('.localhost') || /^\d+\.127\.0\.0\.1$/u.test(host);
}

function normalizeSessionId(value: string): string {
	const sessionId = value.trim().toLowerCase();
	if (!SESSION_ID_PATTERN.test(sessionId) || sessionId.includes('.')) {
		throw new TypeError('The pairing code contains an invalid session host.');
	}
	return sessionId;
}

function normalizeFragment(value: string): string {
	const fragment = value.startsWith('#') ? value.slice(1).trim() : value.trim();
	if (!fragment || fragment.includes('=') || fragment.includes('&')) {
		throw new TypeError('Paste a complete Terminay pairing link.');
	}
	if (
		[...fragment].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 || code === 0x7f;
		})
	) {
		throw new TypeError('The pairing URL fragment is invalid.');
	}
	return fragment;
}

function rejectUnknownQuery(url: URL, allowed: ReadonlySet<string>): void {
	if ([...url.searchParams.keys()].some((name) => !allowed.has(name))) {
		throw new TypeError(
			'The pairing code must keep its credential in the URL fragment.',
		);
	}
}

function sanitizePairingHostName(value: string): string {
	let name = value.trim();
	if (name.toLowerCase().endsWith('.local'))
		name = name.slice(0, -'.local'.length);
	name = name.replaceAll('_', '-').slice(0, 80);
	if (
		name.length === 0 ||
		[...name].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 || code === 0x7f;
		})
	) {
		return '';
	}
	return name;
}
