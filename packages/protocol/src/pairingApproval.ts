/**
 * Host approval of a device-bound match code, and the device-key proof a
 * reconnecting client attaches to `device-join`. Both are shared by the
 * server, the browser session shell, and the Desktop connection host, so the
 * derivations live here and are covered by deterministic vectors.
 */

export const MATCH_CODE_HKDF_LABEL = 'terminay remote v1 match code' as const;
export const MATCH_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' as const;
export const MATCH_CODE_LENGTH = 5 as const;
export const PENDING_APPROVAL_LIFETIME_MS = 120_000 as const;
export const DEVICE_JOIN_PROOF_LABEL = 'terminay remote v1 device join' as const;

const TOKEN = /^[A-Za-z0-9_-]{16,512}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MATCH_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/u;
const MAX_PEM_LENGTH = 16_384;

export type PendingEnrollmentResponse = Readonly<{
	status: 'pending';
	approvalId: string;
	expiresAt: number;
}>;

export type EnrollmentApprovedMessage = Readonly<{
	type: 'enrollment-approved';
	approvalId: string;
	deviceId: string;
	deviceName: string;
	ticket: string;
}>;

export type EnrollmentDeniedMessage = Readonly<{
	type: 'enrollment-denied';
	approvalId: string;
	reason: 'denied' | 'expired' | 'replaced' | 'closed';
}>;

export type EnrollmentPushMessage = EnrollmentApprovedMessage | EnrollmentDeniedMessage;

/**
 * Derive the five-symbol match code both ends display. The pairing secret is
 * the one input hosted signaling never sees, so a relay cannot make the host
 * show a code that matches anything the user's own device shows.
 */
export async function deriveMatchCode(input: Readonly<{
	pairingSecret: string;
	clientNonce: string;
	hostPublicKey: string;
	devicePublicKeyPem: string;
}>): Promise<string> {
	const secret = canonicalBase64Url(input.pairingSecret, 32, 64, 'Pairing secret');
	const nonce = canonicalBase64Url(input.clientNonce, 32, 32, 'Client nonce');
	const hostKey = canonicalBase64Url(input.hostPublicKey, 32, 32, 'Host public key');
	const deviceDer = pemToDer(input.devicePublicKeyPem);
	const deviceDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(deviceDer).buffer));
	const material = await crypto.subtle.importKey('raw', secret.buffer, 'HKDF', false, ['deriveKey']);
	const key = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode(MATCH_CODE_HKDF_LABEL),
		},
		material,
		{ name: 'HMAC', hash: 'SHA-256', length: 256 },
		false,
		['sign'],
	);
	const message = new Uint8Array(nonce.byteLength + hostKey.byteLength + deviceDigest.byteLength);
	message.set(nonce, 0);
	message.set(hostKey, nonce.byteLength);
	message.set(deviceDigest, nonce.byteLength + hostKey.byteLength);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message.buffer));
	secret.fill(0);
	return renderMatchCode(mac);
}

/** First 25 bits of the MAC, five bits per symbol, most significant first. */
export function renderMatchCode(mac: Uint8Array): string {
	if (!(mac instanceof Uint8Array) || mac.byteLength < 4) throw new TypeError('Match code MAC is invalid.');
	let bits = 0n;
	for (const byte of mac.subarray(0, 4)) bits = (bits << 8n) | BigInt(byte);
	let code = '';
	for (let index = 0; index < MATCH_CODE_LENGTH; index += 1) {
		const shift = BigInt(32 - 5 * (index + 1));
		const symbol = Number((bits >> shift) & 31n);
		code += MATCH_CODE_ALPHABET[symbol]!;
	}
	return code;
}

export function isMatchCode(value: unknown): value is string {
	return typeof value === 'string' && MATCH_CODE.test(value);
}

/** Bytes a reconnecting device signs with its device key to join its session. */
export function deviceJoinProofPayload(input: Readonly<{ sessionId: string; clientNonce: string }>): Uint8Array {
	if (typeof input.sessionId !== 'string' || !ID.test(input.sessionId)) throw new TypeError('Device join session id is invalid.');
	canonicalBase64Url(input.clientNonce, 32, 32, 'Client nonce');
	return new TextEncoder().encode(`${DEVICE_JOIN_PROOF_LABEL}\n${input.sessionId}\n${input.clientNonce}`);
}

export function isDeviceJoinProof(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 32 && value.length <= 2048 && /^[A-Za-z0-9_-]+$/u.test(value);
}

export function parsePendingEnrollmentResponse(value: unknown, now = Date.now()): PendingEnrollmentResponse {
	const input = record(value, 'Enrollment response is invalid.');
	const allowed = new Set(['status', 'approvalId', 'expiresAt']);
	if (Object.keys(input).length !== allowed.size || Object.keys(input).some((key) => !allowed.has(key)) ||
		input.status !== 'pending' || !id(input.approvalId) || !Number.isSafeInteger(input.expiresAt) ||
		(input.expiresAt as number) <= now || (input.expiresAt as number) - now > PENDING_APPROVAL_LIFETIME_MS + 5_000) {
		throw new TypeError('Enrollment response is invalid.');
	}
	return Object.freeze({ status: 'pending', approvalId: input.approvalId as string, expiresAt: input.expiresAt as number });
}

export function parseEnrollmentPushMessage(value: unknown): EnrollmentPushMessage {
	const input = record(value, 'Enrollment message is invalid.');
	if (input.type === 'enrollment-approved') {
		const allowed = new Set(['type', 'approvalId', 'deviceId', 'deviceName', 'ticket']);
		if (Object.keys(input).length !== allowed.size || Object.keys(input).some((key) => !allowed.has(key)) ||
			!id(input.approvalId) || !id(input.deviceId) || !boundedText(input.deviceName, 128) || !TOKEN.test(String(input.ticket ?? ''))) {
			throw new TypeError('Enrollment approval message is invalid.');
		}
		return Object.freeze({
			type: 'enrollment-approved',
			approvalId: input.approvalId as string,
			deviceId: input.deviceId as string,
			deviceName: input.deviceName as string,
			ticket: input.ticket as string,
		});
	}
	if (input.type === 'enrollment-denied') {
		const allowed = new Set(['type', 'approvalId', 'reason']);
		if (Object.keys(input).length !== allowed.size || Object.keys(input).some((key) => !allowed.has(key)) ||
			!id(input.approvalId) || !['denied', 'expired', 'replaced', 'closed'].includes(String(input.reason))) {
			throw new TypeError('Enrollment denial message is invalid.');
		}
		return Object.freeze({
			type: 'enrollment-denied',
			approvalId: input.approvalId as string,
			reason: input.reason as EnrollmentDeniedMessage['reason'],
		});
	}
	throw new TypeError('Enrollment message is invalid.');
}

export function isEnrollmentPushMessage(value: unknown): boolean {
	return typeof value === 'object' && value !== null && !Array.isArray(value) &&
		((value as Record<string, unknown>).type === 'enrollment-approved' || (value as Record<string, unknown>).type === 'enrollment-denied');
}

/** Strip the PEM armour so line wrapping cannot change the device key hash. */
export function pemToDer(pem: string): Uint8Array {
	if (typeof pem !== 'string' || pem.length === 0 || pem.length > MAX_PEM_LENGTH) throw new TypeError('Device public key PEM is invalid.');
	const match = /-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----/u.exec(pem);
	if (!match) throw new TypeError('Device public key PEM is invalid.');
	const body = match[1]!.replace(/\s+/gu, '');
	let binary: string;
	try { binary = atob(body); } catch { throw new TypeError('Device public key PEM is invalid.'); }
	if (binary.length < 64) throw new TypeError('Device public key PEM is invalid.');
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function boundedText(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/u.test(value);
}
function record(value: unknown, message: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(message);
	return value as Record<string, unknown>;
}
function base64UrlToBytes(value: string): Uint8Array {
	const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
	let binary: string;
	try { binary = atob(padded); } catch { throw new TypeError('Base64url value is invalid.'); }
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function canonicalBase64Url(value: unknown, minimumBytes: number, maximumBytes: number, name: string): Uint8Array<ArrayBuffer> {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	let bytes: Uint8Array<ArrayBuffer>;
	try { bytes = Uint8Array.from(base64UrlToBytes(value)); } catch { throw new TypeError(`${name} is invalid.`); }
	if (bytes.byteLength < minimumBytes || bytes.byteLength > maximumBytes || bytesToBase64Url(bytes) !== value) {
		throw new TypeError(`${name} is invalid.`);
	}
	return bytes;
}
