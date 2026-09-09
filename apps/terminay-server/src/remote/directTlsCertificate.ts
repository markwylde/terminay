import { createHash } from 'node:crypto';
import {
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';

/** The one file that holds a data root's direct signaling certificate. */
export const DIRECT_TLS_FILE = 'direct-tls.v1.json';
const VALIDITY_DAYS = 825;

export interface DirectTlsCertificate {
	readonly cert: string;
	readonly key: string;
	/** SHA-256 of the DER certificate, for diagnostics only. It is never an
	 * authentication input: the server host key signs the transport transcript. */
	readonly fingerprint: string;
	readonly host: string;
	readonly notAfter: string;
}

interface PersistedDirectTls {
	readonly schemaVersion: 1;
	readonly host: string;
	readonly cert: string;
	readonly key: string;
	readonly fingerprint: string;
	readonly notAfter: string;
}

/**
 * Load, or mint once, the certificate the direct signaling listener presents.
 *
 * This certificate is not part of the trust model. A client authenticates the
 * endpoint by verifying the server host key's signature over the transport
 * transcript and the DTLS fingerprints, exactly as it does for the hosted
 * relay; TLS here only satisfies the `https`/`wss` requirement of the pairing
 * URL grammar and the client's WebSocket. It is nonetheless owner-only inside
 * the data root, because its private key is a durable server-side secret.
 */
export async function loadOrCreateDirectTlsCertificate(
	dataRoot: string,
	directOrigin: string,
	now: () => number = () => Date.now(),
): Promise<DirectTlsCertificate> {
	const host = new URL(directOrigin).hostname;
	const file = path.join(dataRoot, DIRECT_TLS_FILE);
	const existing = readPersisted(file);
	if (
		existing !== undefined &&
		existing.host === host &&
		Date.parse(existing.notAfter) > now()
	) {
		return Object.freeze({
			cert: existing.cert,
			key: existing.key,
			fingerprint: existing.fingerprint,
			host: existing.host,
			notAfter: existing.notAfter,
		});
	}

	const notBeforeDate = new Date(now());
	const notAfterDate = new Date(now() + VALIDITY_DAYS * 24 * 60 * 60 * 1_000);
	const pems = await selfsigned.generate(
		[{ name: 'commonName', value: host }],
		{
			algorithm: 'sha256',
			keySize: 2048,
			notBeforeDate,
			notAfterDate,
			extensions: [
				{ name: 'basicConstraints', cA: false },
				{ name: 'subjectAltName', altNames: subjectAltNames(host) },
			],
		},
	);
	const record: PersistedDirectTls = {
		schemaVersion: 1,
		host,
		cert: pems.cert,
		key: pems.private,
		fingerprint: certificateFingerprint(pems.cert),
		notAfter: notAfterDate.toISOString(),
	};
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(record)}\n`, {
		encoding: 'utf8',
		mode: 0o600,
	});
	renameSync(temporary, file);
	return Object.freeze({
		cert: record.cert,
		key: record.key,
		fingerprint: record.fingerprint,
		host: record.host,
		notAfter: record.notAfter,
	});
}

/** An IP literal must be a SAN of type 7; a name must be type 2. */
function subjectAltNames(
	host: string,
): ({ type: 7; ip: string } | { type: 2; value: string })[] {
	return /^[0-9.]+$/u.test(host) || host.includes(':')
		? [{ type: 7, ip: host }]
		: [{ type: 2, value: host }];
}

function certificateFingerprint(cert: string): string {
	const body = cert
		.replace(/-----BEGIN CERTIFICATE-----/u, '')
		.replace(/-----END CERTIFICATE-----/u, '')
		.replace(/\s+/gu, '');
	return createHash('sha256').update(Buffer.from(body, 'base64')).digest('hex');
}

function readPersisted(file: string): PersistedDirectTls | undefined {
	let parsed: unknown;
	try {
		// A certificate written by a previous run must still be owner-only; a
		// key another account can read is not this server's key any more.
		const mode = statSync(file).mode & 0o777;
		if (mode !== 0o600) return undefined;
		parsed = JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			(error as { code?: unknown }).code === 'ENOENT'
		) {
			return undefined;
		}
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
	if (parsed === null || typeof parsed !== 'object') return undefined;
	const record = parsed as Record<string, unknown>;
	if (
		record.schemaVersion !== 1 ||
		typeof record.host !== 'string' ||
		typeof record.cert !== 'string' ||
		typeof record.key !== 'string' ||
		typeof record.fingerprint !== 'string' ||
		typeof record.notAfter !== 'string'
	) {
		return undefined;
	}
	return record as unknown as PersistedDirectTls;
}
