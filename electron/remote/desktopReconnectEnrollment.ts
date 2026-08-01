import type { DesktopDeviceCredentialStore } from './deviceCredentialStore';

type FetchResponse = Readonly<{ ok: boolean; json: () => Promise<unknown> }>;

export type DesktopReconnectEnrollmentFetch = (
	input: string,
	init: Readonly<{
		body: string;
		headers: Readonly<Record<string, string>>;
		method: 'POST';
		signal?: AbortSignal;
	}>,
) => Promise<FetchResponse>;

const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * A one-time application handoff can enroll durable reconnect material while
 * its bearer token is still valid. Desktop keeps the grant in the main-process
 * credential store and remembers the profile only after this succeeds.
 */
export async function enrollDesktopReconnectCredential(
	options: Readonly<{
		authToken: string;
		clientId: string;
		deviceName: string;
		fetch?: DesktopReconnectEnrollmentFetch;
		now?: () => Date;
		origin: string;
		requestTimeoutMs?: number;
		store: DesktopDeviceCredentialStore;
	}>,
): Promise<void> {
	const origin = normalizeOrigin(options.origin);
	if (!TOKEN.test(options.authToken)) {
		throw new TypeError('Desktop reconnect enrollment credential is invalid.');
	}
	if (!ID.test(options.clientId)) {
		throw new TypeError('Desktop reconnect enrollment client id is invalid.');
	}
	const deviceName = options.deviceName.trim();
	if (deviceName.length === 0 || deviceName.length > 256) {
		throw new TypeError('Desktop reconnect enrollment device name is invalid.');
	}
	const fetchImplementation =
		options.fetch ??
		(globalThis.fetch as unknown as DesktopReconnectEnrollmentFetch);
	if (typeof fetchImplementation !== 'function') {
		throw new Error(
			'Desktop reconnect enrollment requires a network fetch implementation.',
		);
	}
	const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(timeoutMs) ||
		timeoutMs < 1_000 ||
		timeoutMs > 30_000
	) {
		throw new RangeError(
			'Desktop reconnect enrollment timeout must be between 1 and 30 seconds.',
		);
	}

	const enrollment = parseEnrollment(
		await postJson(
			fetchImplementation,
			origin,
			options.authToken,
			{ clientId: options.clientId },
			timeoutMs,
		),
	);
	const key = options.store.createDeviceKey(origin);
	await options.store.saveEstablishedPairing({
		pairing: {
			deviceId: options.clientId,
			deviceName,
			origin,
			privateKey: key.keyRef,
			publicKeyPem: key.publicKeyPem,
		},
		reconnectGrant: {
			expiresAt: null,
			grant: enrollment.grant,
			handle: enrollment.handle,
			issuedAt: (options.now ?? (() => new Date()))().toISOString(),
			origin,
			protocolVersion: 'v1',
			sessionId: enrollment.signingOrigin,
		},
	});
}

async function postJson(
	fetchImplementation: DesktopReconnectEnrollmentFetch,
	origin: string,
	authToken: string,
	body: Record<string, string>,
	timeoutMs: number,
): Promise<unknown> {
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const request = Promise.resolve(
		fetchImplementation(
			new URL('/protocol/reconnect/enroll', origin).toString(),
			Object.freeze({
				body: JSON.stringify(body),
				headers: Object.freeze({
					authorization: `Bearer ${authToken}`,
					'content-type': 'application/json',
				}),
				method: 'POST' as const,
				signal: controller.signal,
			}),
		),
	).then(async (response) => {
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error('Desktop reconnect enrollment was denied by the server.');
		}
		return payload;
	});
	try {
		return await Promise.race([
			request,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => {
					controller.abort();
					reject(
						new Error(
							'Desktop reconnect enrollment timed out. Check the server and try again.',
						),
					);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		void request.catch(() => undefined);
	}
}

function parseEnrollment(
	value: unknown,
): Readonly<{ handle: string; grant: string; signingOrigin: string }> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Desktop reconnect enrollment returned an invalid grant.');
	}
	const input = value as Record<string, unknown>;
	if (
		Object.keys(input).some(
			(key) => !['handle', 'grant', 'signingOrigin'].includes(key),
		) ||
		typeof input.handle !== 'string' ||
		!TOKEN.test(input.handle) ||
		typeof input.grant !== 'string' ||
		!TOKEN.test(input.grant) ||
		typeof input.signingOrigin !== 'string' ||
		input.signingOrigin.length === 0 ||
		input.signingOrigin.length > 4_096
	) {
		throw new Error('Desktop reconnect enrollment returned an invalid grant.');
	}
	return Object.freeze({
		grant: input.grant,
		handle: input.handle,
		signingOrigin: input.signingOrigin,
	});
}

function normalizeOrigin(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError('Desktop reconnect enrollment origin is invalid.');
	}
	const loopbackHttp =
		parsed.protocol === 'http:' &&
		['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
	if (
		(parsed.protocol !== 'https:' && !loopbackHttp) ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new TypeError(
			'Desktop reconnect enrollment origin must be an exact HTTPS or loopback HTTP origin.',
		);
	}
	return parsed.origin;
}
