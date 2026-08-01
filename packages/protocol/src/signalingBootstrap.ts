const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/u;

export interface DesktopSignalingIceServer {
	readonly urls: readonly string[];
	readonly username?: string;
	readonly credential?: string;
	readonly expiresAt?: number;
}

export interface DesktopSignalingBootstrap {
	readonly schemaVersion: 1;
	readonly protocolVersion: 'v1';
	readonly role: 'offerer';
	readonly serverId: string;
	readonly deviceId: string;
	readonly peerId: string;
	readonly sessionOrigin: string;
	readonly signalingUrl: string;
	readonly signalingAuthToken: string;
	readonly expiresAt: number;
	readonly iceServers: readonly DesktopSignalingIceServer[];
}

export function parseDesktopSignalingBootstrap(
	value: unknown,
	expectedOrigin: string,
	now = Date.now(),
): DesktopSignalingBootstrap {
	const input = record(value, 'Desktop WebRTC signaling bootstrap is invalid.');
	const allowed = new Set([
		'schemaVersion',
		'protocolVersion',
		'role',
		'serverId',
		'deviceId',
		'peerId',
		'sessionOrigin',
		'signalingUrl',
		'signalingAuthToken',
		'expiresAt',
		'iceServers',
	]);
	if (Object.keys(input).some((key) => !allowed.has(key)))
		throw new Error('Desktop WebRTC signaling bootstrap is invalid.');
	if (input.schemaVersion !== 1 || input.protocolVersion !== 'v1')
		throw new Error('Desktop WebRTC signaling bootstrap is incompatible.');
	if (input.role !== 'offerer')
		throw new Error('Desktop WebRTC signaling role is incompatible.');
	const origin = normalizeOrigin(expectedOrigin);
	if (input.sessionOrigin !== origin)
		throw new Error(
			'Desktop WebRTC signaling bootstrap belongs to another origin.',
		);
	const serverId = identifier(input.serverId);
	const deviceId = identifier(input.deviceId);
	const peerId = identifier(input.peerId);
	const signalingAuthToken = token(input.signalingAuthToken);
	const expiresAt = expiry(input.expiresAt, now, now + 10 * 60_000);
	const signalingUrl = normalizeSignalingUrl(input.signalingUrl, origin);
	if (!Array.isArray(input.iceServers) || input.iceServers.length > 16)
		throw new Error('Desktop WebRTC ICE configuration is invalid.');
	const iceServers = Object.freeze(
		input.iceServers.map((candidate) =>
			parseIceServer(candidate, now, expiresAt),
		),
	);
	return Object.freeze({
		schemaVersion: 1,
		protocolVersion: 'v1',
		role: 'offerer',
		serverId,
		deviceId,
		peerId,
		sessionOrigin: origin,
		signalingUrl,
		signalingAuthToken,
		expiresAt,
		iceServers,
	});
}

function parseIceServer(
	value: unknown,
	now: number,
	bootstrapExpiresAt: number,
): DesktopSignalingIceServer {
	const input = record(value, 'Desktop WebRTC ICE configuration is invalid.');
	if (
		Object.keys(input).some(
			(key) => !['urls', 'username', 'credential', 'expiresAt'].includes(key),
		)
	)
		throw new Error('Desktop WebRTC ICE configuration is invalid.');
	const rawUrls = typeof input.urls === 'string' ? [input.urls] : input.urls;
	if (!Array.isArray(rawUrls) || rawUrls.length === 0 || rawUrls.length > 8)
		throw new Error('Desktop WebRTC ICE configuration is invalid.');
	const urls = Object.freeze(
		rawUrls.map((url) => {
			if (
				typeof url !== 'string' ||
				url.length > 2048 ||
				!/^(?:stun|turns?):[^\s]+$/u.test(url)
			)
				throw new Error('Desktop WebRTC ICE configuration is invalid.');
			return url;
		}),
	);
	const usesTurn = urls.some(
		(url) => url.startsWith('turn:') || url.startsWith('turns:'),
	);
	if (!usesTurn) {
		if (
			input.username !== undefined ||
			input.credential !== undefined ||
			input.expiresAt !== undefined
		)
			throw new Error('Desktop WebRTC ICE configuration is invalid.');
		return Object.freeze({ urls });
	}
	if (
		typeof input.username !== 'string' ||
		input.username.length === 0 ||
		input.username.length > 512 ||
		typeof input.credential !== 'string' ||
		!TOKEN.test(input.credential)
	)
		throw new Error('Desktop WebRTC TURN credentials are invalid.');
	const expiresAt = expiry(input.expiresAt, now, bootstrapExpiresAt);
	return Object.freeze({
		urls,
		username: input.username,
		credential: input.credential,
		expiresAt,
	});
}

function normalizeSignalingUrl(value: unknown, origin: string): string {
	if (typeof value !== 'string')
		throw new Error('Desktop WebRTC signaling URL is invalid.');
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error('Desktop WebRTC signaling URL is invalid.');
	}
	const expected = new URL(origin);
	if (
		parsed.protocol !== 'wss:' ||
		parsed.hostname !== expected.hostname ||
		parsed.port !== expected.port ||
		parsed.pathname !== '/signal' ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	)
		throw new Error('Desktop WebRTC signaling URL is invalid.');
	return parsed.toString();
}

function normalizeOrigin(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError('Desktop WebRTC expected origin is invalid.');
	}
	if (
		parsed.protocol !== 'https:' ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	)
		throw new TypeError(
			'Desktop WebRTC expected origin must be an exact HTTPS origin.',
		);
	return parsed.origin;
}

function identifier(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value))
		throw new Error('Desktop WebRTC signaling identity is invalid.');
	return value;
}

function token(value: unknown): string {
	if (typeof value !== 'string' || !TOKEN.test(value))
		throw new Error('Desktop WebRTC signaling credential is invalid.');
	return value;
}

function expiry(value: unknown, now: number, maximum: number): number {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value <= now ||
		value > maximum
	)
		throw new Error('Desktop WebRTC signaling expiry is invalid.');
	return value;
}

function record(value: unknown, message: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error(message);
	return value as Record<string, unknown>;
}
