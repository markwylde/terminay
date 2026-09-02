import { encodeCanonicalJson } from './json.js';

export const AUTHENTICATED_WEBRTC_TRANSPORT_VERSION = 2 as const;
export const AUTHENTICATED_WEBRTC_TRANSPORT_DOMAIN =
	'terminay:v1:authenticated-webrtc-transport' as const;
export const AUTHENTICATED_WEBRTC_PAIRING_HKDF_LABEL =
	'terminay remote v1 authenticated transport pairing' as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/u;
const SHA256 = /^[A-F0-9]{2}(?::[A-F0-9]{2}){31}$/u;
const MAX_SDP_BYTES = 256 * 1024;
const MAX_TRANSCRIPT_LIFETIME_MS = 2 * 60_000;

export type AuthenticatedWebRtcTransportScope = 'pairing' | 'reconnect';

export interface AuthenticatedWebRtcFingerprint {
	readonly algorithm: 'sha-256';
	readonly value: string;
}

export interface AuthenticatedWebRtcTransportTranscript {
	readonly domain: typeof AUTHENTICATED_WEBRTC_TRANSPORT_DOMAIN;
	readonly version: typeof AUTHENTICATED_WEBRTC_TRANSPORT_VERSION;
	readonly scope: AuthenticatedWebRtcTransportScope;
	readonly scopeId: string;
	readonly sessionOrigin: string;
	readonly serverId: string;
	readonly hostKeyAlgorithm: 'ed25519';
	readonly hostPublicKey: string;
	readonly clientNonce: string;
	readonly offerId: string;
	readonly issuedAt: number;
	readonly expiresAt: number;
	readonly sdpSha256: string;
	readonly fingerprints: readonly AuthenticatedWebRtcFingerprint[];
}

export function createAuthenticatedWebRtcTransportTranscript(
	input: Omit<AuthenticatedWebRtcTransportTranscript, 'domain' | 'version'>,
): AuthenticatedWebRtcTransportTranscript {
	return validateAuthenticatedWebRtcTransportTranscript({
		...input,
		domain: AUTHENTICATED_WEBRTC_TRANSPORT_DOMAIN,
		version: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
	});
}

export function validateAuthenticatedWebRtcTransportTranscript(
	value: unknown,
): AuthenticatedWebRtcTransportTranscript {
	if (!record(value)) throw new TypeError('WebRTC transport transcript is invalid.');
	const allowed = new Set([
		'clientNonce', 'domain', 'expiresAt', 'fingerprints', 'hostKeyAlgorithm',
		'hostPublicKey', 'issuedAt', 'offerId', 'scope', 'scopeId', 'sdpSha256',
		'sessionOrigin', 'serverId', 'version',
	]);
	if (Object.keys(value).length !== allowed.size || Object.keys(value).some((key) => !allowed.has(key))) {
		throw new TypeError('WebRTC transport transcript fields are invalid.');
	}
	if (
		value.domain !== AUTHENTICATED_WEBRTC_TRANSPORT_DOMAIN ||
		value.version !== AUTHENTICATED_WEBRTC_TRANSPORT_VERSION ||
		(value.scope !== 'pairing' && value.scope !== 'reconnect') ||
		!id(value.scopeId) ||
		!id(value.serverId) ||
		value.hostKeyAlgorithm !== 'ed25519' ||
		!token(value.hostPublicKey) ||
		!token(value.clientNonce) ||
		!token(value.offerId) ||
		!TOKEN.test(String(value.sdpSha256 ?? ''))
	) throw new TypeError('WebRTC transport transcript identity is invalid.');
	const sessionOrigin = exactOrigin(value.sessionOrigin);
	if (
		!Number.isSafeInteger(value.issuedAt) ||
		!Number.isSafeInteger(value.expiresAt) ||
		(value.issuedAt as number) < 0 ||
		(value.expiresAt as number) <= (value.issuedAt as number) ||
		(value.expiresAt as number) - (value.issuedAt as number) > MAX_TRANSCRIPT_LIFETIME_MS
	) throw new TypeError('WebRTC transport transcript lifetime is invalid.');
	if (!Array.isArray(value.fingerprints) || value.fingerprints.length < 1 || value.fingerprints.length > 4) {
		throw new TypeError('WebRTC transport fingerprints are invalid.');
	}
	const fingerprints = value.fingerprints.map((entry) => {
		if (!record(entry) || Object.keys(entry).length !== 2 || entry.algorithm !== 'sha-256' ||
			!SHA256.test(String(entry.value ?? ''))) {
			throw new TypeError('WebRTC transport fingerprint is invalid.');
		}
		return Object.freeze({ algorithm: 'sha-256' as const, value: entry.value as string });
	});
	const keys = fingerprints.map((entry) => `${entry.algorithm}:${entry.value}`);
	if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
		throw new TypeError('WebRTC transport fingerprints must be unique and sorted.');
	}
	return Object.freeze({
		domain: AUTHENTICATED_WEBRTC_TRANSPORT_DOMAIN,
		version: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
		scope: value.scope,
		scopeId: value.scopeId as string,
		sessionOrigin,
		serverId: value.serverId as string,
		hostKeyAlgorithm: 'ed25519',
		hostPublicKey: value.hostPublicKey as string,
		clientNonce: value.clientNonce as string,
		offerId: value.offerId as string,
		issuedAt: value.issuedAt as number,
		expiresAt: value.expiresAt as number,
		sdpSha256: value.sdpSha256 as string,
		fingerprints: Object.freeze(fingerprints),
	});
}

export function serializeAuthenticatedWebRtcTransportTranscript(
	value: AuthenticatedWebRtcTransportTranscript,
): Uint8Array {
	return encodeCanonicalJson(validateAuthenticatedWebRtcTransportTranscript(value));
}

export function extractAuthenticatedWebRtcFingerprints(
	sdp: string,
): readonly AuthenticatedWebRtcFingerprint[] {
	if (typeof sdp !== 'string' || sdp.trim().length === 0 || new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES) {
		throw new TypeError('WebRTC offer SDP is invalid or too large.');
	}
	const found = new Set<string>();
	for (const rawLine of sdp.split(/\r?\n/u)) {
		if (!rawLine.startsWith('a=fingerprint:')) continue;
		const match = /^a=fingerprint:([^\s]+)\s+([^\s]+)$/iu.exec(rawLine);
		if (!match || match[1]!.toLowerCase() !== 'sha-256') {
			throw new TypeError('WebRTC offer fingerprint algorithm is unsupported.');
		}
		const fingerprint = match[2]!.toUpperCase();
		if (!SHA256.test(fingerprint)) throw new TypeError('WebRTC offer fingerprint is invalid.');
		found.add(`sha-256:${fingerprint}`);
	}
	if (found.size === 0 || found.size > 4) throw new TypeError('WebRTC offer fingerprint set is invalid.');
	return Object.freeze([...found].sort().map((entry) => Object.freeze({
		algorithm: 'sha-256' as const,
		value: entry.slice('sha-256:'.length),
	})));
}

export async function sha256Base64Url(value: string | Uint8Array): Promise<string> {
	const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SDP_BYTES) {
		throw new TypeError('WebRTC transcript hash input is invalid or too large.');
	}
	const digestInput = Uint8Array.from(bytes);
	const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer);
	return bytesToBase64Url(new Uint8Array(digest));
}

export async function createAuthenticatedWebRtcPairingAuthenticator(
	pairingSecret: string,
	transcript: AuthenticatedWebRtcTransportTranscript,
): Promise<string> {
	const secret = canonicalBase64Url(pairingSecret, 32, 64, 'WebRTC pairing secret');
	const material = await crypto.subtle.importKey('raw', secret.buffer, 'HKDF', false, ['deriveKey']);
	const key = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode(AUTHENTICATED_WEBRTC_PAIRING_HKDF_LABEL),
		},
		material,
		{ name: 'HMAC', hash: 'SHA-256', length: 256 },
		false,
		['sign', 'verify'],
	);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		Uint8Array.from(serializeAuthenticatedWebRtcTransportTranscript(transcript)).buffer,
	);
	secret.fill(0);
	return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyAuthenticatedWebRtcPairingAuthenticator(
	pairingSecret: string,
	transcript: AuthenticatedWebRtcTransportTranscript,
	authenticator: string,
): Promise<void> {
	const expected = await createAuthenticatedWebRtcPairingAuthenticator(pairingSecret, transcript);
	if (!constantTimeEqual(base64UrlToBytes(expected), canonicalBase64Url(authenticator, 32, 32, 'WebRTC pairing authenticator'))) {
		throw new Error('WebRTC pairing transport authentication failed.');
	}
}

export async function verifyAuthenticatedWebRtcHostSignature(
	transcript: AuthenticatedWebRtcTransportTranscript,
	hostSignature: string,
): Promise<void> {
	const publicKey = canonicalBase64Url(transcript.hostPublicKey, 32, 32, 'WebRTC host public key');
	const signature = canonicalBase64Url(hostSignature, 64, 64, 'WebRTC host signature');
	const key = await crypto.subtle.importKey('raw', publicKey.buffer, { name: 'Ed25519' }, false, ['verify']);
	const valid = await crypto.subtle.verify(
		{ name: 'Ed25519' },
		key,
		signature.buffer,
		Uint8Array.from(serializeAuthenticatedWebRtcTransportTranscript(transcript)).buffer,
	);
	if (!valid) throw new Error('WebRTC server host signature is invalid.');
}

export function assertAuthenticatedWebRtcTransportTranscript(
	transcriptValue: unknown,
	expected: Readonly<{
		scope: AuthenticatedWebRtcTransportScope;
		scopeId: string;
		sessionOrigin: string;
		serverId: string;
		clientNonce: string;
		sdp: string;
		now?: number;
	}>,
): Promise<AuthenticatedWebRtcTransportTranscript> {
	return (async () => {
		const transcript = validateAuthenticatedWebRtcTransportTranscript(transcriptValue);
		const now = expected.now ?? Date.now();
		if (!Number.isSafeInteger(now) || transcript.issuedAt > now + 5_000 || transcript.expiresAt <= now) {
			throw new Error('WebRTC transport transcript is expired or not yet valid.');
		}
		if (transcript.scope !== expected.scope || transcript.scopeId !== expected.scopeId ||
			transcript.sessionOrigin !== exactOrigin(expected.sessionOrigin) || transcript.serverId !== expected.serverId ||
			transcript.clientNonce !== expected.clientNonce) {
			throw new Error('WebRTC transport transcript belongs to another connection.');
		}
		const fingerprints = extractAuthenticatedWebRtcFingerprints(expected.sdp);
		if (JSON.stringify(fingerprints) !== JSON.stringify(transcript.fingerprints)) {
			throw new Error('WebRTC fingerprint does not match its authenticated transcript.');
		}
		return transcript;
	})();
}

function exactOrigin(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('WebRTC transcript origin is invalid.');
	let parsed: URL;
	try { parsed = new URL(value); } catch { throw new TypeError('WebRTC transcript origin is invalid.'); }
	const local = parsed.protocol === 'http:' &&
		(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.hostname.endsWith('.localhost'));
	if ((parsed.protocol !== 'https:' && !local) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new TypeError('WebRTC transcript origin must be exact HTTPS or loopback HTTP.');
	}
	return parsed.origin;
}

function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function token(value: unknown): value is string { return typeof value === 'string' && TOKEN.test(value); }
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
	const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
	let binary: string;
	try { binary = atob(padded); } catch { throw new TypeError('Base64url value is invalid.'); }
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalBase64Url(value: unknown, minimumBytes: number, maximumBytes: number, name: string): Uint8Array<ArrayBuffer> {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	const bytes = Uint8Array.from(base64UrlToBytes(value));
	if (bytes.byteLength < minimumBytes || bytes.byteLength > maximumBytes || bytesToBase64Url(bytes) !== value) {
		throw new TypeError(`${name} is invalid.`);
	}
	return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
	return difference === 0;
}
