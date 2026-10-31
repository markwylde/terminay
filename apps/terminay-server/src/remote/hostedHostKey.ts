import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	type KeyObject,
	sign,
} from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { AUTHENTICATED_WEBRTC_TRANSPORT_VERSION } from '@terminay/protocol';
import {
	loadSecretStateSync,
	writeFileDurablySync,
} from '@terminay/server-core';

/** Must stay identical to the hosted signaling relay's device-host proof payload. */
export const DEVICE_HOST_PROOF_LABEL = 'terminay remote v1 device host';

export interface HostedHostKey {
	readonly algorithm: 'ed25519';
	readonly privateKeyPem: string;
	readonly publicKey: string;
}

export interface DeviceHostReadyMessage {
	readonly authenticatedTransportVersion: typeof AUTHENTICATED_WEBRTC_TRANSPORT_VERSION;
	readonly expiresAt: string;
	readonly hostKeyAlgorithm: 'ed25519';
	readonly hostProof: string;
	readonly hostPublicKey: string;
	readonly sessionId: string;
	readonly type: 'device-host-ready';
}

export function createHostedHostKey(): HostedHostKey {
	const pair = generateKeyPairSync('ed25519');
	return freezeHostKey(pair.privateKey, pair.publicKey);
}

export function parseHostedHostKey(value: unknown): HostedHostKey {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Hosted host key is invalid.');
	}
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1 || record.algorithm !== 'ed25519') {
		throw new Error('Hosted host key is invalid.');
	}
	if (
		typeof record.privateKeyPem !== 'string' ||
		record.privateKeyPem.length === 0
	) {
		throw new Error('Hosted host key is invalid.');
	}
	const privateKey = createPrivateKey(record.privateKeyPem);
	if (privateKey.asymmetricKeyType !== 'ed25519') {
		throw new Error('Hosted host key is invalid.');
	}
	return freezeHostKey(privateKey, createPublicKey(privateKey));
}

export function serializeHostedHostKey(key: HostedHostKey): string {
	return `${JSON.stringify({
		algorithm: key.algorithm,
		privateKeyPem: key.privateKeyPem,
		schemaVersion: 1,
	})}\n`;
}

/** The host key is a credential (ADR-0088): a corrupt file is set aside and a
 * new key is made, so every paired device must pair again. It never rolls
 * back to an older key. */
export function loadOrCreateHostedHostKey(file: string): HostedHostKey {
	const existing = loadSecretStateSync(file, 'host-key', {
		validate: parseHostedHostKey,
	});
	if (existing !== undefined) return existing;
	const key = createHostedHostKey();
	writeHostKeyFile(file, serializeHostedHostKey(key));
	return key;
}

function writeHostKeyFile(file: string, contents: string): void {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileDurablySync(file, contents, { mode: 0o600 });
}

/**
 * Where the private host key lives. The standalone server keeps an owner-only
 * file inside its data root; Desktop wraps the same bytes in OS-protected
 * storage so the key that every paired device pins is never plaintext there.
 */
export interface HostKeyStore {
	readonly loadOrCreate: () => HostedHostKey;
	/** Replace the key. Callers revoke every device first: rotation is a trust
	 * reset, never silent. */
	readonly rotate: () => HostedHostKey;
}

export function createFileHostKeyStore(file: string): HostKeyStore {
	return Object.freeze({
		loadOrCreate: () => loadOrCreateHostedHostKey(file),
		rotate: () => rotateHostedHostKey(file),
	});
}

export interface ProtectedHostKeyCodec {
	readonly isAvailable: () => boolean;
	readonly encrypt: (plainText: string) => Buffer;
	readonly decrypt: (encrypted: Buffer) => string;
}

/**
 * OS-protected host key. An existing plaintext key is migrated once and the
 * plaintext removed. Without protected storage the store refuses rather than
 * writing plaintext, so exposure fails closed with a visible reason.
 */
export function createProtectedHostKeyStore(options: {
	readonly file: string;
	readonly legacyPlaintextFile?: string;
	readonly codec: ProtectedHostKeyCodec;
}): HostKeyStore {
	const requireCodec = () => {
		if (!options.codec.isAvailable()) {
			throw new Error(
				'OS-protected storage is unavailable, so the server host key cannot be stored safely. Remote access stays off.',
			);
		}
	};
	const write = (key: HostedHostKey) => {
		mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
		const envelope = `${JSON.stringify({
			schemaVersion: 2,
			encrypted: options.codec
				.encrypt(serializeHostedHostKey(key))
				.toString('base64'),
		})}\n`;
		writeHostKeyFile(options.file, envelope);
	};
	const readProtected = (): HostedHostKey | undefined => {
		// A torn or blank envelope is a corrupt credential: set aside, and a new
		// key is made (ADR-0088). An envelope that is whole but will not decrypt
		// still fails loudly, as before.
		const envelope = loadSecretStateSync(options.file, 'host-key', {
			validate: protectedEnvelope,
		});
		if (envelope === undefined) return undefined;
		return parseHostedHostKey(
			JSON.parse(
				options.codec.decrypt(Buffer.from(envelope.encrypted, 'base64')),
			),
		);
	};
	return Object.freeze({
		loadOrCreate: () => {
			requireCodec();
			const existing = readProtected();
			if (existing !== undefined) return existing;
			if (options.legacyPlaintextFile !== undefined) {
				try {
					const legacy = parseHostedHostKey(
						JSON.parse(readFileSync(options.legacyPlaintextFile, 'utf8')),
					);
					write(legacy);
					rmSync(options.legacyPlaintextFile, { force: true });
					return legacy;
				} catch (error) {
					if (!isMissingFile(error)) throw error;
				}
			}
			const key = createHostedHostKey();
			write(key);
			return key;
		},
		rotate: () => {
			requireCodec();
			const key = createHostedHostKey();
			write(key);
			if (options.legacyPlaintextFile !== undefined)
				rmSync(options.legacyPlaintextFile, { force: true });
			return key;
		},
	});
}

/** Replace the host key on disk. Callers revoke every device first: the old
 * pin is a trust reset, never a silent rotation. */
export function rotateHostedHostKey(file: string): HostedHostKey {
	const key = createHostedHostKey();
	writeHostKeyFile(file, serializeHostedHostKey(key));
	return key;
}

function protectedEnvelope(
	value: unknown,
): { readonly schemaVersion: 2; readonly encrypted: string } | undefined {
	const envelope = value as Record<string, unknown> | null;
	return typeof envelope === 'object' &&
		envelope !== null &&
		envelope.schemaVersion === 2 &&
		typeof envelope.encrypted === 'string'
		? (envelope as { schemaVersion: 2; encrypted: string })
		: undefined;
}

export function deviceHostProofPayload(input: {
	readonly authenticatedTransportVersion?: typeof AUTHENTICATED_WEBRTC_TRANSPORT_VERSION;
	readonly expiresAt: string;
	readonly hostPublicKey: string;
	readonly sessionId: string;
}): Buffer {
	return Buffer.from(
		`${DEVICE_HOST_PROOF_LABEL}\n${input.authenticatedTransportVersion ?? AUTHENTICATED_WEBRTC_TRANSPORT_VERSION}\n${input.sessionId}\n${input.expiresAt}\n${input.hostPublicKey}`,
	);
}

export function createDeviceHostReadyMessage(input: {
	readonly expiresAt: string;
	readonly hostKey: HostedHostKey;
	readonly sessionId: string;
}): DeviceHostReadyMessage {
	const privateKey = createPrivateKey(input.hostKey.privateKeyPem);
	const hostProof = sign(
		null,
		deviceHostProofPayload({
			authenticatedTransportVersion: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
			expiresAt: input.expiresAt,
			hostPublicKey: input.hostKey.publicKey,
			sessionId: input.sessionId,
		}),
		privateKey,
	).toString('base64url');
	return Object.freeze({
		authenticatedTransportVersion: AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
		expiresAt: input.expiresAt,
		hostKeyAlgorithm: 'ed25519',
		hostProof,
		hostPublicKey: input.hostKey.publicKey,
		sessionId: input.sessionId,
		type: 'device-host-ready',
	});
}

function freezeHostKey(
	privateKey: KeyObject,
	publicKey: KeyObject,
): HostedHostKey {
	const der = publicKey.export({ format: 'der', type: 'spki' });
	return Object.freeze({
		algorithm: 'ed25519',
		privateKeyPem: privateKey
			.export({ format: 'pem', type: 'pkcs8' })
			.toString(),
		publicKey: Buffer.from(der.subarray(-32)).toString('base64url'),
	});
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { code?: unknown }).code === 'ENOENT'
	);
}
