import {
	WebSocketByteTransport,
	type WebSocketByteTransportOptions,
} from '@terminay/client-core';

const MAX_CONNECTION_URL_LENGTH = 16_384;
const MAX_PAIRING_FRAGMENT_LENGTH = 4_096;
const PAIRING_KEYS = new Set([
	'pairingExpiresAt',
	'pairingSessionId',
	'pairingToken',
]);

export type RemoteStreamBootstrap = Readonly<{
	origin: string;
	authToken: string;
	pairingExpiresAt?: string;
	pairingSessionId?: string;
}>;

export type RemoteStreamTransportFactoryOptions = Pick<
	WebSocketByteTransportOptions,
	'WebSocket' | 'maxFrameBytes'
>;

export function parseRemoteStreamConnectionUrl(
	rawUrl: unknown,
): RemoteStreamBootstrap {
	if (
		typeof rawUrl !== 'string' ||
		rawUrl.trim().length === 0 ||
		rawUrl.length > MAX_CONNECTION_URL_LENGTH
	) {
		throw new TypeError('Paste a valid Terminay server URL.');
	}

	let url: URL;
	try {
		url = new URL(rawUrl.trim());
	} catch {
		throw new TypeError('Paste a valid Terminay server URL.');
	}

	const isLoopbackHttp =
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]');
	if (url.protocol !== 'https:' && !isLoopbackHttp) {
		throw new TypeError('Server URLs must use HTTPS or loopback HTTP.');
	}
	if (url.username !== '' || url.password !== '') {
		throw new TypeError('Server URLs cannot contain credentials.');
	}

	const query = parsePairingData(url.searchParams, url.search !== '');
	const fragmentText = url.hash.slice(1);
	if (fragmentText.length > MAX_PAIRING_FRAGMENT_LENGTH) {
		throw new TypeError('The server URL pairing fragment is too large.');
	}

	let fragment: PairingData | undefined;
	if (fragmentText !== '') {
		let decoded: string;
		try {
			decoded = decodeURIComponent(fragmentText);
		} catch {
			throw new TypeError('The server URL pairing fragment is invalid.');
		}
		fragment = parsePairingData(new URLSearchParams(decoded), true, decoded);
	}

	if (query !== undefined && fragment !== undefined) {
		throw new TypeError('The server URL contains duplicate pairing credentials.');
	}

	const pairing = fragment ?? query;
	if (pairing === undefined) {
		throw new TypeError('The server URL does not contain a pairing credential.');
	}
	if (pairing.expiresAt !== undefined && pairing.expiresAt <= Date.now()) {
		throw new TypeError(
			'This pairing URL has expired. Generate a fresh URL from the server.',
		);
	}

	const endpoint = new URL(url.toString());
	endpoint.search = '';
	endpoint.hash = '';

	return Object.freeze({
		origin: endpoint.toString().replace(/\/$/u, ''),
		authToken: pairing.token,
		...(pairing.expiresAt === undefined
			? {}
			: { pairingExpiresAt: pairing.expiresAtText }),
		...(pairing.sessionId === undefined
			? {}
			: { pairingSessionId: pairing.sessionId }),
	});
}

export function createRemoteStreamTransport(
	rawUrl: unknown,
	options: RemoteStreamTransportFactoryOptions = {},
): {
	readonly bootstrap: RemoteStreamBootstrap;
	readonly transport: WebSocketByteTransport;
} {
	const bootstrap = parseRemoteStreamConnectionUrl(rawUrl);
	const transport = new WebSocketByteTransport({
		origin: bootstrap.origin,
		authToken: bootstrap.authToken,
		...(options.WebSocket === undefined ? {} : { WebSocket: options.WebSocket }),
		...(options.maxFrameBytes === undefined
			? {}
			: { maxFrameBytes: options.maxFrameBytes }),
	});
	return Object.freeze({ bootstrap, transport });
}

type PairingData = Readonly<{
	token: string;
	expiresAt?: number;
	expiresAtText?: string;
	sessionId?: string;
}>;

function parsePairingData(
	params: URLSearchParams,
	supplied: boolean,
	rawValue = '',
): PairingData | undefined {
	if (!supplied) return undefined;

	const keys = [...params.keys()];
	const isStructured = keys.some((key) => PAIRING_KEYS.has(key));
	if (!isStructured) {
		if (
			rawValue.length < 16 ||
			rawValue.length > 512 ||
			hasControlCharacter(rawValue)
		) {
			throw new TypeError('The server URL pairing fragment is invalid.');
		}
		return { token: rawValue };
	}

	if (
		keys.some((key) => !PAIRING_KEYS.has(key)) ||
		keys.length !== PAIRING_KEYS.size
	) {
		throw new TypeError('The server URL contains unsupported pairing data.');
	}
	const token = params.get('pairingToken')?.trim() ?? '';
	const sessionId = params.get('pairingSessionId')?.trim() ?? '';
	const expiresAtText = params.get('pairingExpiresAt')?.trim() ?? '';
	if (token === '' || sessionId === '' || expiresAtText === '') {
		throw new TypeError('The server URL is missing required pairing details.');
	}
	if (token.length < 16 || token.length > 512 || hasControlCharacter(token)) {
		throw new TypeError('The server URL pairing token is invalid.');
	}
	const expiresAt = Date.parse(expiresAtText);
	if (!Number.isFinite(expiresAt)) {
		throw new TypeError('The server URL pairing expiry is invalid.');
	}
	return { token, sessionId, expiresAt, expiresAtText };
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
			return true;
		}
	}
	return false;
}
