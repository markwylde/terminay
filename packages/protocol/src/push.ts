/**
 * The sealed Web Push payload (ADR-0060).
 *
 * A Terminay Server seals each push under a key it shares with exactly one
 * paired device, and the installed PWA's service worker opens it. Every
 * payload is one fixed length, so its size says nothing about what it holds,
 * and the hosted push service that carries it can neither read nor alter it.
 */

export const PUSH_PAYLOAD_VERSION = 1 as const;
/** Every sealed payload is exactly this long. */
export const PUSH_SEALED_BYTES = 3072;
export const PUSH_ROUTING_ID_BYTES = 16;
export const PUSH_KEY_BYTES = 32;
export const PUSH_TOKEN_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + PUSH_ROUTING_ID_BYTES;
const LENGTH_PREFIX_BYTES = 2;
/** Bytes of padded plaintext inside one sealed payload. */
export const PUSH_PLAINTEXT_BYTES =
	PUSH_SEALED_BYTES - HEADER_BYTES - NONCE_BYTES - TAG_BYTES;

export const PUSH_MAX_COUNT = 9999;
export const PUSH_MAX_TITLE_CHARS = 80;
export const PUSH_MAX_BODY_CHARS = 280;

export const PUSH_NOTIFICATION_KINDS = [
	'agent-finished',
	'agent-waiting',
	'agent-blocked',
	'command-finished',
	'attention',
	'message',
] as const;
export type PushNotificationKind = (typeof PUSH_NOTIFICATION_KINDS)[number];

/** One device's standing arrangement with one server. Every value is
 * base64url without padding, as the manager generated it. */
export interface PushEnrolment {
	readonly routingId: string;
	readonly key: string;
	readonly token: string;
	/** Whether the installation accepts a push that shows nothing. */
	readonly silent: boolean;
}

/** The one notification a push asks the device to show. */
export interface PushBanner {
	readonly id: string;
	readonly kind: PushNotificationKind;
	readonly terminalTitle: string;
	readonly projectTitle: string;
	readonly raisedAt: number;
	readonly projectId: string;
	readonly sessionId: string;
	/** Present only for a notification a process sent. */
	readonly messageTitle?: string;
	readonly messageBody?: string;
}

/** What one push states about a server, to one device. */
export interface PushState {
	readonly sequence: number;
	readonly count: number;
	/** Ids of the outstanding notifications, newest first. */
	readonly outstanding: readonly string[];
	readonly banner?: PushBanner;
}

/** A state as the device read it: `truncated` says `outstanding` was cut to
 * fit, so the absence of an id means nothing. */
export interface OpenedPushState extends PushState {
	readonly truncated: boolean;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function decodeBase64Url(value: string, bytes: number): Uint8Array {
	if (typeof value !== 'string' || !BASE64URL.test(value))
		throw new TypeError('value is not base64url');
	const binary = atob(value.replace(/-/gu, '+').replace(/_/gu, '/'));
	if (binary.length !== bytes) throw new TypeError('value has the wrong length');
	const decoded = new Uint8Array(bytes);
	for (let index = 0; index < bytes; index += 1)
		decoded[index] = binary.charCodeAt(index);
	return decoded;
}

/** Validate an enrolment exactly as the manager hands it over. */
export function parsePushEnrolment(value: unknown): PushEnrolment {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('push enrolment must be an object');
	const record = value as Record<string, unknown>;
	const known = ['routingId', 'key', 'token', 'silent'];
	if (Object.keys(record).some((key) => !known.includes(key)))
		throw new TypeError('push enrolment has an unknown field');
	if (typeof record.silent !== 'boolean')
		throw new TypeError('push enrolment silent flag is invalid');
	decodeBase64Url(record.routingId as string, PUSH_ROUTING_ID_BYTES);
	decodeBase64Url(record.key as string, PUSH_KEY_BYTES);
	decodeBase64Url(record.token as string, PUSH_TOKEN_BYTES);
	return Object.freeze({
		routingId: record.routingId as string,
		key: record.key as string,
		token: record.token as string,
		silent: record.silent,
	});
}

/**
 * Seal one state for one enrolment. The outstanding ids are included newest
 * first for as long as they fit; a banner always fits, because its text is
 * bounded.
 */
export async function sealPushPayload(
	enrolment: Pick<PushEnrolment, 'routingId' | 'key'>,
	state: PushState,
): Promise<Uint8Array> {
	const routingId = decodeBase64Url(enrolment.routingId, PUSH_ROUTING_ID_BYTES);
	const key = await importKey(enrolment.key, 'encrypt');
	const plaintext = encodePlaintext(state);

	const sealed = new Uint8Array(PUSH_SEALED_BYTES);
	sealed[0] = PUSH_PAYLOAD_VERSION;
	sealed.set(routingId, 1);
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	sealed.set(nonce, HEADER_BYTES);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv: nonce,
				additionalData: sealed.slice(0, HEADER_BYTES),
				tagLength: TAG_BYTES * 8,
			},
			key,
			plaintext.buffer as ArrayBuffer,
		),
	);
	sealed.set(ciphertext, HEADER_BYTES + NONCE_BYTES);
	return sealed;
}

/** The routing id a sealed payload names, before anything is verified. */
export function pushPayloadRoutingId(sealed: Uint8Array): string {
	if (sealed.byteLength !== PUSH_SEALED_BYTES)
		throw new TypeError('push payload has the wrong length');
	if (sealed[0] !== PUSH_PAYLOAD_VERSION)
		throw new TypeError('push payload version is unsupported');
	return encodeBase64Url(sealed.subarray(1, HEADER_BYTES));
}

/**
 * Open a sealed payload as its device would. Throws when the payload was not
 * sealed under this enrolment's key for this routing id, or was altered.
 */
export async function openPushPayload(
	enrolment: Pick<PushEnrolment, 'routingId' | 'key'>,
	sealed: Uint8Array,
): Promise<OpenedPushState> {
	if (pushPayloadRoutingId(sealed) !== enrolment.routingId)
		throw new TypeError('push payload names another routing id');
	const key = await importKey(enrolment.key, 'decrypt');
	const plaintext = new Uint8Array(
		await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: sealed.slice(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES),
				additionalData: sealed.slice(0, HEADER_BYTES),
				tagLength: TAG_BYTES * 8,
			},
			key,
			sealed.slice(HEADER_BYTES + NONCE_BYTES),
		),
	);
	const length = (plaintext[0] << 8) | plaintext[1];
	if (length > plaintext.byteLength - LENGTH_PREFIX_BYTES)
		throw new TypeError('push payload length is invalid');
	return decodeState(
		JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(
				plaintext.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length),
			),
		),
	);
}

function encodePlaintext(state: PushState): Uint8Array {
	if (!Number.isSafeInteger(state.sequence) || state.sequence < 0)
		throw new RangeError('push sequence is invalid');
	if (
		!Number.isSafeInteger(state.count) ||
		state.count < 0 ||
		state.count > PUSH_MAX_COUNT
	)
		throw new RangeError('push count is invalid');
	for (const id of state.outstanding) assertId(id, 'outstanding id');
	const banner =
		state.banner === undefined ? undefined : encodeBanner(state.banner);
	const encoder = new TextEncoder();
	const capacity = PUSH_PLAINTEXT_BYTES - LENGTH_PREFIX_BYTES;
	// Newest first, for as long as they fit beside the banner.
	let outstanding = [...state.outstanding];
	let json: Uint8Array;
	for (;;) {
		json = encoder.encode(
			JSON.stringify({
				s: state.sequence,
				c: state.count,
				o: outstanding,
				m: outstanding.length !== state.outstanding.length,
				...(banner === undefined ? {} : { n: banner }),
			}),
		);
		if (json.byteLength <= capacity) break;
		if (outstanding.length === 0)
			throw new RangeError('push state does not fit one payload');
		outstanding = outstanding.slice(0, Math.floor(outstanding.length / 2));
	}
	const plaintext = new Uint8Array(PUSH_PLAINTEXT_BYTES);
	plaintext[0] = json.byteLength >> 8;
	plaintext[1] = json.byteLength & 0xff;
	plaintext.set(json, LENGTH_PREFIX_BYTES);
	return plaintext;
}

function encodeBanner(banner: PushBanner): Record<string, unknown> {
	assertId(banner.id, 'notification id');
	assertId(banner.projectId, 'project id');
	assertId(banner.sessionId, 'session id');
	if (!PUSH_NOTIFICATION_KINDS.includes(banner.kind))
		throw new TypeError('push notification kind is invalid');
	if (!Number.isFinite(banner.raisedAt))
		throw new TypeError('push notification time is invalid');
	const isMessage = banner.kind === 'message';
	return {
		i: banner.id,
		k: banner.kind,
		t: bounded(banner.terminalTitle, PUSH_MAX_TITLE_CHARS),
		p: bounded(banner.projectTitle, PUSH_MAX_TITLE_CHARS),
		a: banner.raisedAt,
		pi: banner.projectId,
		si: banner.sessionId,
		...(isMessage && banner.messageTitle !== undefined
			? { mt: bounded(banner.messageTitle, PUSH_MAX_TITLE_CHARS) }
			: {}),
		...(isMessage && banner.messageBody !== undefined
			? { mb: bounded(banner.messageBody, PUSH_MAX_BODY_CHARS) }
			: {}),
	};
}

function decodeState(value: unknown): OpenedPushState {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('push state is invalid');
	const record = value as Record<string, unknown>;
	if (!Number.isSafeInteger(record.s) || (record.s as number) < 0)
		throw new TypeError('push sequence is invalid');
	if (
		!Number.isSafeInteger(record.c) ||
		(record.c as number) < 0 ||
		(record.c as number) > PUSH_MAX_COUNT
	)
		throw new TypeError('push count is invalid');
	if (!Array.isArray(record.o) || typeof record.m !== 'boolean')
		throw new TypeError('push outstanding list is invalid');
	for (const id of record.o) assertId(id, 'outstanding id');
	return Object.freeze({
		sequence: record.s as number,
		count: record.c as number,
		outstanding: Object.freeze([...(record.o as string[])]),
		truncated: record.m,
		...(record.n === undefined ? {} : { banner: decodeBanner(record.n) }),
	});
}

function decodeBanner(value: unknown): PushBanner {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('push notification is invalid');
	const record = value as Record<string, unknown>;
	assertId(record.i, 'notification id');
	assertId(record.pi, 'project id');
	assertId(record.si, 'session id');
	if (!PUSH_NOTIFICATION_KINDS.includes(record.k as PushNotificationKind))
		throw new TypeError('push notification kind is invalid');
	if (typeof record.a !== 'number' || !Number.isFinite(record.a))
		throw new TypeError('push notification time is invalid');
	const text = (field: unknown, max: number, name: string): string => {
		if (typeof field !== 'string' || [...field].length > max)
			throw new TypeError(`push notification ${name} is invalid`);
		return field;
	};
	const isMessage = record.k === 'message';
	return Object.freeze({
		id: record.i as string,
		kind: record.k as PushNotificationKind,
		terminalTitle: text(record.t, PUSH_MAX_TITLE_CHARS, 'terminal title'),
		projectTitle: text(record.p, PUSH_MAX_TITLE_CHARS, 'project title'),
		raisedAt: record.a,
		projectId: record.pi as string,
		sessionId: record.si as string,
		...(isMessage && record.mt !== undefined
			? { messageTitle: text(record.mt, PUSH_MAX_TITLE_CHARS, 'title') }
			: {}),
		...(isMessage && record.mb !== undefined
			? { messageBody: text(record.mb, PUSH_MAX_BODY_CHARS, 'body') }
			: {}),
	});
}

function bounded(value: string, maxChars: number): string {
	const characters = [...value];
	return characters.length <= maxChars
		? value
		: characters.slice(0, maxChars).join('');
}

function assertId(value: unknown, name: string): asserts value is string {
	if (typeof value !== 'string' || !ID_PATTERN.test(value))
		throw new TypeError(`push ${name} is invalid`);
}

function encodeBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/gu, '-')
		.replace(/\//gu, '_')
		.replace(/=+$/u, '');
}

function importKey(
	key: string,
	usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		decodeBase64Url(key, PUSH_KEY_BYTES).buffer as ArrayBuffer,
		{ name: 'AES-GCM' },
		false,
		[usage],
	);
}
