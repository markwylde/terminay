import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign,
	type KeyObject,
} from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Must stay identical to the hosted signaling relay's device-host proof payload. */
export const DEVICE_HOST_PROOF_LABEL = 'terminay remote v1 device host';

export interface HostedHostKey {
	readonly algorithm: 'ed25519';
	readonly privateKeyPem: string;
	readonly publicKey: string;
}

export interface DeviceHostReadyMessage {
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
	if (typeof record.privateKeyPem !== 'string' || record.privateKeyPem.length === 0) {
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

export function loadOrCreateHostedHostKey(file: string): HostedHostKey {
	try {
		return parseHostedHostKey(JSON.parse(readFileSync(file, 'utf8')));
	} catch (error) {
		if (!isMissingFile(error)) throw error;
	}
	const key = createHostedHostKey();
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.tmp`;
	writeFileSync(temporary, serializeHostedHostKey(key), {
		encoding: 'utf8',
		mode: 0o600,
	});
	renameSync(temporary, file);
	return key;
}

export function deviceHostProofPayload(input: {
	readonly expiresAt: string;
	readonly hostPublicKey: string;
	readonly sessionId: string;
}): Buffer {
	return Buffer.from(
		`${DEVICE_HOST_PROOF_LABEL}\n${input.sessionId}\n${input.expiresAt}\n${input.hostPublicKey}`,
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
			expiresAt: input.expiresAt,
			hostPublicKey: input.hostKey.publicKey,
			sessionId: input.sessionId,
		}),
		privateKey,
	).toString('base64url');
	return Object.freeze({
		expiresAt: input.expiresAt,
		hostKeyAlgorithm: 'ed25519',
		hostProof,
		hostPublicKey: input.hostKey.publicKey,
		sessionId: input.sessionId,
		type: 'device-host-ready',
	});
}

function freezeHostKey(privateKey: KeyObject, publicKey: KeyObject): HostedHostKey {
	const der = publicKey.export({ format: 'der', type: 'spki' });
	return Object.freeze({
		algorithm: 'ed25519',
		privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
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
