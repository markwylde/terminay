import { TERMINAY_MANAGER_HOST } from './managerOrigins.js';

const SESSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{6,61}[a-z0-9])$/u;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MANAGER_QUERY = new Set(['s', 'hostName', 'pairingExpiresAt']);
const SESSION_QUERY = new Set(['hostName', 'pairingExpiresAt']);

export type HostedPairingEnvelope = {
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
	if (pairingExpiresAt) manager.searchParams.set('pairingExpiresAt', pairingExpiresAt);
	manager.hash = fragment;
	return manager.toString();
}

export function managerOriginFromSessionOrigin(sessionOrigin: string): string {
	const url = originUrl(sessionOrigin);
	url.hostname = managerHostnameFromSessionHostname(url.hostname);
	return url.origin;
}

export function parseHostedPairingUrl(value: string): HostedPairingEnvelope {
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
	if (url.protocol !== 'https:' && !isLoopbackHttp && !isLoopbackSessionHttp(url)) {
		throw new TypeError('Pairing URLs must use HTTPS or loopback HTTP.');
	}

	if (isManagerHostname(url.hostname)) return parseManagerPairingUrl(url);
	return parseLegacySessionPairingUrl(url);
}

function parseManagerPairingUrl(url: URL): HostedPairingEnvelope {
	if (url.pathname !== '/' && url.pathname !== '') {
		throw new TypeError('Paste a complete Terminay pairing link.');
	}
	rejectUnknownQuery(url, MANAGER_QUERY);
	const sessionId = normalizeSessionId(url.searchParams.get('s') ?? '');
	const fragment = normalizeFragment(url.hash);
	const hostName = sanitizePairingHostName(url.searchParams.get('hostName') ?? '');
	const session = new URL(url.origin);
	session.hostname = sessionHostnameFromManagerHostname(url.hostname, sessionId);
	const origin = session.origin;
	const pairingExpiresAt = String(url.searchParams.get('pairingExpiresAt') ?? '').trim();
	return Object.freeze({
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

function parseLegacySessionPairingUrl(url: URL): HostedPairingEnvelope {
	if (!/^\/v1\/?$/.test(url.pathname)) {
		throw new TypeError('Paste a complete Terminay pairing link.');
	}
	rejectUnknownQuery(url, SESSION_QUERY);
	const sessionId = sessionIdFromHostname(url.hostname);
	const fragment = normalizeFragment(url.hash);
	const hostName = sanitizePairingHostName(url.searchParams.get('hostName') ?? '');
	const origin = url.origin;
	const pairingExpiresAt = String(url.searchParams.get('pairingExpiresAt') ?? '').trim();
	return Object.freeze({
		fragment,
		href: sessionPairingHref(origin, fragment, hostName),
		hostName,
		label: hostName || sessionId,
		managerHref: formatHostedPairingUrl({
			fragment,
			hostName,
			managerOrigin: managerOriginFromSessionOrigin(origin),
			pairingExpiresAt,
			sessionId,
		}),
		origin,
		pairingExpiresAt,
		sessionId,
	});
}

function sessionPairingHref(origin: string, fragment: string, hostName: string): string {
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
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		url.username = '';
		url.password = '';
		url.pathname = '/';
		url.search = '';
		url.hash = '';
	}
	return url;
}

function isManagerHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (LOOPBACK_HOSTS.has(host)) return true;
	if (host === TERMINAY_MANAGER_HOST) return true;
	return host.startsWith('app.') && host !== 'app.localhost';
}

function isLoopbackSessionHttp(url: URL): boolean {
	if (url.protocol !== 'http:') return false;
	const host = url.hostname.toLowerCase();
	return host.endsWith('.localhost') || /^\d+\.127\.0\.0\.1$/u.test(host);
}

function managerHostnameFromSessionHostname(hostname: string): string {
	const host = hostname.toLowerCase();
	if (LOOPBACK_HOSTS.has(host)) return host === '::1' ? '[::1]' : host;
	if (host.endsWith('.localhost')) return 'localhost';
	const labels = host.split('.');
	if (labels.length >= 5 && labels.slice(1).join('.') === '127.0.0.1') return '127.0.0.1';
	if (labels.length < 2) throw new TypeError('Hosted session origin is invalid.');
	return `app.${labels.slice(1).join('.')}`;
}

function sessionHostnameFromManagerHostname(hostname: string, sessionId: string): string {
	const host = hostname.toLowerCase();
	if (LOOPBACK_HOSTS.has(host)) return `${sessionId}.${host === '[::1]' ? 'localhost' : host}`;
	if (host.startsWith('app.')) return `${sessionId}.${host.slice('app.'.length)}`;
	throw new TypeError('That link is not a Terminay pairing link.');
}

function sessionIdFromHostname(hostname: string): string {
	const host = hostname.toLowerCase();
	if (host.endsWith('.localhost')) return normalizeSessionId(host.slice(0, -'.localhost'.length));
	if (host.endsWith('.127.0.0.1')) return normalizeSessionId(host.slice(0, -'.127.0.0.1'.length));
	if (host.endsWith('.terminay.com') && host !== TERMINAY_MANAGER_HOST) {
		return normalizeSessionId(host.slice(0, -'.terminay.com'.length));
	}
	const labels = host.split('.');
	if (labels.length >= 3 && labels[0] !== 'app') return normalizeSessionId(labels[0] ?? '');
	throw new TypeError('That link is not a Terminay pairing link.');
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
	if ([...fragment].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 0x20 || code === 0x7f;
	})) {
		throw new TypeError('The pairing URL fragment is invalid.');
	}
	return fragment;
}

function rejectUnknownQuery(url: URL, allowed: ReadonlySet<string>): void {
	if ([...url.searchParams.keys()].some((name) => !allowed.has(name))) {
		throw new TypeError('The pairing code must keep its credential in the URL fragment.');
	}
}

function sanitizePairingHostName(value: string): string {
	let name = value.trim();
	if (name.toLowerCase().endsWith('.local')) name = name.slice(0, -'.local'.length);
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
