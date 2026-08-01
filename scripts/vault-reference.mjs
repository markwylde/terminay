import { spawnSync } from 'node:child_process';
import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
	scrypt as scryptCallback,
} from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export const VAULT_FORMAT = 'terminay-vault-envelope';
export const VAULT_VERSION = 1;
export const ENTRY_VERSION = 1;
export const CIPHER = 'AES-256-GCM';
export const EMBEDDED_PROTECTOR = 'electron-safe-storage';
export const PASSPHRASE_PROTECTOR = 'scrypt-aes-256-gcm';
export const MAX_PASSPHRASE_BYTES = 4096;
export const MIN_PASSPHRASE_BYTES = 12;
export const MAX_SECRET_BYTES = 1024 * 1024;
export const MAX_VAULT_ENTRIES = 4096;
export const MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;
// At most two AES-GCM invocations occur per revision, keeping one DEK below 2^32.
export const MAX_VAULT_REVISION = 2 ** 31 - 2;
export const SCRYPT_PARAMETERS = Object.freeze({
	name: 'scrypt',
	N: 32768,
	r: 8,
	p: 1,
	keyLength: 32,
	saltBytes: 16,
	maxmem: 64 * 1024 * 1024,
});

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const textEncoder = new TextEncoder();

export class VaultFormatError extends Error {
	constructor(message) {
		super(message);
		this.name = 'VaultFormatError';
	}
}

export class VaultLockedError extends Error {
	constructor() {
		super('The vault is locked.');
		this.name = 'VaultLockedError';
	}
}

export class VaultUnlockError extends Error {
	constructor() {
		super('The vault could not be unlocked.');
		this.name = 'VaultUnlockError';
	}
}

function exactKeys(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new VaultFormatError(`${label} must be an object.`);
	}
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new VaultFormatError(
			`${label} contains unexpected or missing fields.`,
		);
	}
}

function assertIdentifier(value, label) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new VaultFormatError(`${label} must contain 1-256 characters.`);
	}
}

function decodeBase64Url(value, bytes, label) {
	if (typeof value !== 'string' || !BASE64URL.test(value)) {
		throw new VaultFormatError(`${label} must be canonical base64url.`);
	}
	const decoded = Buffer.from(value, 'base64url');
	if (decoded.toString('base64url') !== value) {
		throw new VaultFormatError(`${label} must be canonical base64url.`);
	}
	if (bytes !== null && decoded.length !== bytes) {
		throw new VaultFormatError(`${label} must contain ${bytes} bytes.`);
	}
	return decoded;
}

function entryAad(serverId, secretId) {
	return textEncoder.encode(
		JSON.stringify(['terminay-vault-entry', ENTRY_VERSION, serverId, secretId]),
	);
}

function keyAad(serverId) {
	return textEncoder.encode(
		JSON.stringify(['terminay-vault-data-key', VAULT_VERSION, serverId]),
	);
}

export function vaultAadContract(serverId, secretId) {
	return {
		entry: Buffer.from(entryAad(serverId, secretId)).toString('utf8'),
		wrappedKey: Buffer.from(keyAad(serverId)).toString('utf8'),
	};
}

function encryptAesGcm(plaintext, key, aad, usedNonces = new Set()) {
	let nonce;
	for (let attempt = 0; attempt < 8; attempt += 1) {
		nonce = randomBytes(12);
		if (!usedNonces.has(nonce.toString('base64url'))) {
			break;
		}
		nonce = null;
	}
	if (!nonce) {
		throw new Error('Could not allocate a unique AES-GCM nonce.');
	}
	usedNonces.add(nonce.toString('base64url'));

	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(aad);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return {
		nonce: nonce.toString('base64url'),
		tag: cipher.getAuthTag().toString('base64url'),
		ciphertext: ciphertext.toString('base64url'),
	};
}

function decryptAesGcm(encrypted, key, aad) {
	const nonce = decodeBase64Url(encrypted.nonce, 12, 'AES-GCM nonce');
	const tag = decodeBase64Url(encrypted.tag, 16, 'AES-GCM tag');
	const ciphertext = decodeBase64Url(
		encrypted.ciphertext,
		null,
		'AES-GCM ciphertext',
	);
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, nonce);
		decipher.setAAD(aad);
		decipher.setAuthTag(tag);
		const first = decipher.update(ciphertext);
		let final;
		try {
			final = decipher.final();
			return Buffer.concat([first, final]);
		} finally {
			first.fill(0);
			final?.fill(0);
		}
	} finally {
		nonce.fill(0);
		tag.fill(0);
		ciphertext.fill(0);
	}
}

function assertPassphrase(passphrase) {
	if (!Buffer.isBuffer(passphrase)) {
		throw new TypeError('Passphrases must be supplied as Buffer values.');
	}
	if (
		passphrase.length < MIN_PASSPHRASE_BYTES ||
		passphrase.length > MAX_PASSPHRASE_BYTES
	) {
		throw new RangeError(
			`Passphrases must contain ${MIN_PASSPHRASE_BYTES}-${MAX_PASSPHRASE_BYTES} bytes.`,
		);
	}
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function manifestAad(envelope) {
	return textEncoder.encode(
		canonicalJson([
			'terminay-vault-manifest',
			VAULT_VERSION,
			envelope.format,
			envelope.version,
			envelope.serverId,
			envelope.revision,
			envelope.keyEnvelope,
			envelope.entries,
		]),
	);
}

function deriveManifestKey(dataEncryptionKey, serverId) {
	return Buffer.from(
		hkdfSync(
			'sha256',
			dataEncryptionKey,
			textEncoder.encode(serverId),
			textEncoder.encode('terminay-vault-manifest-integrity-key:v1'),
			32,
		),
	);
}

function sealManifest(envelope, key) {
	const manifestKey = deriveManifestKey(key, envelope.serverId);
	try {
		const encrypted = encryptAesGcm(
			Buffer.alloc(0),
			manifestKey,
			manifestAad(envelope),
		);
		return {
			version: VAULT_VERSION,
			cipher: CIPHER,
			...encrypted,
		};
	} finally {
		manifestKey.fill(0);
	}
}

function verifyManifest(envelope, key) {
	const manifestKey = deriveManifestKey(key, envelope.serverId);
	let plaintext;
	try {
		plaintext = decryptAesGcm(
			envelope.manifest,
			manifestKey,
			manifestAad(envelope),
		);
		if (plaintext.length !== 0) {
			throw new VaultUnlockError();
		}
	} finally {
		plaintext?.fill(0);
		manifestKey.fill(0);
	}
}

function assertEntry(entry) {
	exactKeys(
		entry,
		['cipher', 'ciphertext', 'id', 'name', 'nonce', 'tag', 'version'],
		'Vault entry',
	);
	assertIdentifier(entry.id, 'Secret id');
	if (typeof entry.name !== 'string' || entry.name.length > 512) {
		throw new VaultFormatError(
			'Secret name must contain at most 512 characters.',
		);
	}
	if (entry.version !== ENTRY_VERSION || entry.cipher !== CIPHER) {
		throw new VaultFormatError(
			'Vault entry cryptographic metadata is unsupported.',
		);
	}
	decodeBase64Url(entry.nonce, 12, 'Entry nonce').fill(0);
	decodeBase64Url(entry.tag, 16, 'Entry tag').fill(0);
	if (entry.ciphertext.length > Math.ceil((MAX_SECRET_BYTES * 4) / 3) + 4) {
		throw new VaultFormatError(
			'Entry ciphertext exceeds the versioned size limit.',
		);
	}
	const ciphertext = decodeBase64Url(
		entry.ciphertext,
		null,
		'Entry ciphertext',
	);
	if (ciphertext.length > MAX_SECRET_BYTES) {
		ciphertext.fill(0);
		throw new VaultFormatError(
			'Entry ciphertext exceeds the versioned size limit.',
		);
	}
	ciphertext.fill(0);
}

function assertPassphraseEnvelope(keyEnvelope) {
	exactKeys(
		keyEnvelope,
		[
			'cipher',
			'ciphertext',
			'kdf',
			'nonce',
			'protector',
			'salt',
			'tag',
			'version',
		],
		'Passphrase key envelope',
	);
	exactKeys(
		keyEnvelope.kdf,
		['N', 'keyLength', 'maxmem', 'name', 'p', 'r', 'saltBytes'],
		'scrypt metadata',
	);
	if (
		keyEnvelope.protector !== PASSPHRASE_PROTECTOR ||
		keyEnvelope.version !== VAULT_VERSION ||
		keyEnvelope.cipher !== CIPHER
	) {
		throw new VaultFormatError('Passphrase protector metadata is unsupported.');
	}
	for (const [key, expected] of Object.entries(SCRYPT_PARAMETERS)) {
		if (keyEnvelope.kdf[key] !== expected) {
			throw new VaultFormatError(
				`scrypt ${key} is outside the versioned resource policy.`,
			);
		}
	}
	decodeBase64Url(
		keyEnvelope.salt,
		SCRYPT_PARAMETERS.saltBytes,
		'scrypt salt',
	).fill(0);
	decodeBase64Url(keyEnvelope.nonce, 12, 'Wrapped-key nonce').fill(0);
	decodeBase64Url(keyEnvelope.tag, 16, 'Wrapped-key tag').fill(0);
	decodeBase64Url(
		keyEnvelope.ciphertext,
		32,
		'Wrapped data-encryption key',
	).fill(0);
}

function assertEmbeddedEnvelope(keyEnvelope) {
	exactKeys(
		keyEnvelope,
		['backend', 'ciphertext', 'protector', 'version'],
		'Embedded key envelope',
	);
	if (
		keyEnvelope.protector !== EMBEDDED_PROTECTOR ||
		keyEnvelope.version !== VAULT_VERSION ||
		typeof keyEnvelope.backend !== 'string' ||
		keyEnvelope.backend.length < 1
	) {
		throw new VaultFormatError('Embedded protector metadata is unsupported.');
	}
	if (keyEnvelope.backend === 'basic_text') {
		throw new VaultFormatError(
			'Linux basic_text is not a secure key protector.',
		);
	}
	if (keyEnvelope.ciphertext.length > 32 * 1024) {
		throw new VaultFormatError(
			'safeStorage ciphertext exceeds the size limit.',
		);
	}
	decodeBase64Url(keyEnvelope.ciphertext, null, 'safeStorage ciphertext').fill(
		0,
	);
}

function assertManifest(manifest) {
	exactKeys(
		manifest,
		['cipher', 'ciphertext', 'nonce', 'tag', 'version'],
		'Vault manifest',
	);
	if (
		manifest.version !== VAULT_VERSION ||
		manifest.cipher !== CIPHER ||
		manifest.ciphertext !== ''
	) {
		throw new VaultFormatError('Vault manifest metadata is unsupported.');
	}
	decodeBase64Url(manifest.nonce, 12, 'Manifest nonce').fill(0);
	decodeBase64Url(manifest.tag, 16, 'Manifest tag').fill(0);
}

function assertEnvelope(value) {
	exactKeys(
		value,
		[
			'entries',
			'format',
			'keyEnvelope',
			'manifest',
			'revision',
			'serverId',
			'version',
		],
		'Vault envelope',
	);
	if (value.format !== VAULT_FORMAT || value.version !== VAULT_VERSION) {
		throw new VaultFormatError('Vault envelope format is unsupported.');
	}
	assertIdentifier(value.serverId, 'Server id');
	if (!Array.isArray(value.entries)) {
		throw new VaultFormatError('Vault entries must be an array.');
	}
	if (value.entries.length > MAX_VAULT_ENTRIES) {
		throw new VaultFormatError(
			'Vault entry count exceeds the versioned limit.',
		);
	}
	if (
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		value.revision > MAX_VAULT_REVISION
	) {
		throw new VaultFormatError(
			'Vault revision is outside the versioned limit.',
		);
	}
	assertManifest(value.manifest);
	const ids = new Set();
	const nonces = new Set();
	for (const entry of value.entries) {
		assertEntry(entry);
		if (ids.has(entry.id)) {
			throw new VaultFormatError('Vault entry ids must be unique.');
		}
		if (nonces.has(entry.nonce)) {
			throw new VaultFormatError(
				'AES-GCM nonces must be unique within the vault.',
			);
		}
		ids.add(entry.id);
		nonces.add(entry.nonce);
	}
	if (value.keyEnvelope?.protector === PASSPHRASE_PROTECTOR) {
		assertPassphraseEnvelope(value.keyEnvelope);
	} else if (value.keyEnvelope?.protector === EMBEDDED_PROTECTOR) {
		assertEmbeddedEnvelope(value.keyEnvelope);
	} else {
		throw new VaultFormatError('Vault key protector is unsupported.');
	}
}

export class PassphraseKeyProtector {
	get type() {
		return PASSPHRASE_PROTECTOR;
	}

	async wrap(dataEncryptionKey, passphrase, serverId) {
		assertPassphrase(passphrase);
		if (
			!Buffer.isBuffer(dataEncryptionKey) ||
			dataEncryptionKey.length !== 32
		) {
			throw new TypeError('The data-encryption key must contain 32 bytes.');
		}
		const salt = randomBytes(SCRYPT_PARAMETERS.saltBytes);
		const derivedKey = await scrypt(
			passphrase,
			salt,
			SCRYPT_PARAMETERS.keyLength,
			{
				N: SCRYPT_PARAMETERS.N,
				r: SCRYPT_PARAMETERS.r,
				p: SCRYPT_PARAMETERS.p,
				maxmem: SCRYPT_PARAMETERS.maxmem,
			},
		);
		try {
			const encrypted = encryptAesGcm(
				dataEncryptionKey,
				derivedKey,
				keyAad(serverId),
			);
			return {
				protector: PASSPHRASE_PROTECTOR,
				version: VAULT_VERSION,
				kdf: { ...SCRYPT_PARAMETERS },
				cipher: CIPHER,
				salt: salt.toString('base64url'),
				...encrypted,
			};
		} finally {
			salt.fill(0);
			derivedKey.fill(0);
		}
	}

	async unwrap(keyEnvelope, passphrase, serverId) {
		assertPassphraseEnvelope(keyEnvelope);
		assertPassphrase(passphrase);
		const salt = decodeBase64Url(
			keyEnvelope.salt,
			SCRYPT_PARAMETERS.saltBytes,
			'scrypt salt',
		);
		const derivedKey = await scrypt(
			passphrase,
			salt,
			SCRYPT_PARAMETERS.keyLength,
			{
				N: SCRYPT_PARAMETERS.N,
				r: SCRYPT_PARAMETERS.r,
				p: SCRYPT_PARAMETERS.p,
				maxmem: SCRYPT_PARAMETERS.maxmem,
			},
		);
		try {
			const key = decryptAesGcm(keyEnvelope, derivedKey, keyAad(serverId));
			if (key.length !== 32) {
				key.fill(0);
				throw new VaultUnlockError();
			}
			return key;
		} catch {
			throw new VaultUnlockError();
		} finally {
			salt.fill(0);
			derivedKey.fill(0);
		}
	}
}

export class ElectronSafeStorageKeyProtector {
	#safeStorage;
	#platform;
	#backend;

	constructor(safeStorage, platform = process.platform) {
		if (
			!safeStorage ||
			typeof safeStorage.isEncryptionAvailable !== 'function' ||
			typeof safeStorage.encryptString !== 'function' ||
			typeof safeStorage.decryptString !== 'function'
		) {
			throw new TypeError(
				'A compatible Electron safeStorage implementation is required.',
			);
		}
		this.#safeStorage = safeStorage;
		this.#platform = platform;
		this.#backend =
			platform === 'linux' &&
			typeof safeStorage.getSelectedStorageBackend === 'function'
				? safeStorage.getSelectedStorageBackend()
				: platform;
		if (!safeStorage.isEncryptionAvailable()) {
			throw new Error('Electron safeStorage encryption is unavailable.');
		}
		if (platform === 'linux' && this.#backend === 'basic_text') {
			throw new Error('Linux basic_text is not a secure key protector.');
		}
	}

	get type() {
		return EMBEDDED_PROTECTOR;
	}

	async wrap(dataEncryptionKey) {
		if (
			!Buffer.isBuffer(dataEncryptionKey) ||
			dataEncryptionKey.length !== 32
		) {
			throw new TypeError('The data-encryption key must contain 32 bytes.');
		}
		const encodedKey = dataEncryptionKey.toString('base64url');
		try {
			return {
				protector: EMBEDDED_PROTECTOR,
				version: VAULT_VERSION,
				backend: this.#backend,
				ciphertext: this.#safeStorage
					.encryptString(encodedKey)
					.toString('base64url'),
			};
		} finally {
			// JavaScript strings cannot be zeroized; the raw key remains in a Buffer everywhere else.
		}
	}

	async unwrap(keyEnvelope) {
		assertEmbeddedEnvelope(keyEnvelope);
		if (
			keyEnvelope.backend !== this.#backend ||
			(this.#platform === 'linux' && this.#backend === 'basic_text')
		) {
			throw new VaultUnlockError();
		}
		const ciphertext = decodeBase64Url(
			keyEnvelope.ciphertext,
			null,
			'safeStorage ciphertext',
		);
		try {
			const decodedKey = this.#safeStorage.decryptString(ciphertext);
			const key = Buffer.from(decodedKey, 'base64url');
			if (key.length !== 32 || key.toString('base64url') !== decodedKey) {
				key.fill(0);
				throw new VaultUnlockError();
			}
			return key;
		} catch {
			throw new VaultUnlockError();
		} finally {
			ciphertext.fill(0);
		}
	}
}

export class ReferenceVault {
	#envelope;
	#protector;
	#dataEncryptionKey = null;
	#lockEpoch = 0;

	constructor(envelope, protector) {
		assertEnvelope(envelope);
		if (!protector || protector.type !== envelope.keyEnvelope.protector) {
			throw new VaultFormatError(
				'The key protector does not match the vault envelope.',
			);
		}
		this.#envelope = clone(envelope);
		this.#protector = protector;
	}

	static async create(serverId, protector, unlockMaterial) {
		assertIdentifier(serverId, 'Server id');
		const dataEncryptionKey = randomBytes(32);
		try {
			const keyEnvelope = await protector.wrap(
				dataEncryptionKey,
				unlockMaterial,
				serverId,
			);
			const envelope = {
				format: VAULT_FORMAT,
				version: VAULT_VERSION,
				serverId,
				revision: 0,
				keyEnvelope,
				entries: [],
			};
			envelope.manifest = sealManifest(envelope, dataEncryptionKey);
			const vault = new ReferenceVault(envelope, protector);
			vault.#dataEncryptionKey = Buffer.from(dataEncryptionKey);
			return vault;
		} finally {
			dataEncryptionKey.fill(0);
		}
	}

	status() {
		return {
			initialized: true,
			locked: this.#dataEncryptionKey === null,
			protector: this.#envelope.keyEnvelope.protector,
			entryCount: this.#envelope.entries.length,
		};
	}

	list() {
		return this.#envelope.entries.map(({ id, name }) => ({ id, name }));
	}

	lock() {
		this.#lockEpoch += 1;
		this.#dataEncryptionKey?.fill(0);
		this.#dataEncryptionKey = null;
	}

	async unlock(unlockMaterial) {
		this.lock();
		const unlockEpoch = this.#lockEpoch;
		const key = await this.#protector.unwrap(
			this.#envelope.keyEnvelope,
			unlockMaterial,
			this.#envelope.serverId,
		);
		if (unlockEpoch !== this.#lockEpoch) {
			key.fill(0);
			throw new VaultLockedError();
		}
		try {
			verifyManifest(this.#envelope, key);
			this.#dataEncryptionKey = key;
		} catch {
			key.fill(0);
			throw new VaultUnlockError();
		}
	}

	async unlockFromSource(source, io) {
		const passphrase = readHeadlessPassphrase(source, io);
		try {
			await this.unlock(passphrase);
		} finally {
			passphrase.fill(0);
		}
	}

	#requireKey() {
		if (!this.#dataEncryptionKey) {
			throw new VaultLockedError();
		}
		return this.#dataEncryptionKey;
	}

	put(id, name, secret) {
		this.#requireKey();
		assertIdentifier(id, 'Secret id');
		if (this.#envelope.entries.some((entry) => entry.id === id)) {
			throw new Error(`Secret ${id} already exists.`);
		}
		this.#writeEntry(id, name, secret, false);
	}

	replace(id, name, secret) {
		this.#requireKey();
		if (!this.#envelope.entries.some((entry) => entry.id === id)) {
			throw new Error(`Secret ${id} does not exist.`);
		}
		this.#writeEntry(id, name, secret, true);
	}

	#writeEntry(id, name, secret, replace) {
		if (!Buffer.isBuffer(secret)) {
			throw new TypeError('Secrets must be supplied as Buffer values.');
		}
		if (typeof name !== 'string' || name.length > 512) {
			throw new TypeError('Secret name must contain at most 512 characters.');
		}
		if (secret.length > MAX_SECRET_BYTES) {
			throw new RangeError(
				`Secrets must not exceed ${MAX_SECRET_BYTES} bytes.`,
			);
		}
		const candidate = clone(this.#envelope);
		const usedNonces = new Set(
			this.#envelope.entries
				.map((entry) => entry.nonce)
				.concat(this.#envelope.manifest.nonce),
		);
		const encrypted = encryptAesGcm(
			secret,
			this.#requireKey(),
			entryAad(this.#envelope.serverId, id),
			usedNonces,
		);
		const entry = {
			id,
			name,
			version: ENTRY_VERSION,
			cipher: CIPHER,
			...encrypted,
		};
		if (replace) {
			const index = candidate.entries.findIndex(
				(candidate) => candidate.id === id,
			);
			candidate.entries[index] = entry;
		} else {
			if (candidate.entries.length >= MAX_VAULT_ENTRIES) {
				throw new RangeError(
					`Vaults must not exceed ${MAX_VAULT_ENTRIES} entries.`,
				);
			}
			candidate.entries.push(entry);
		}
		this.#commitCandidate(candidate);
	}

	delete(id) {
		this.#requireKey();
		const candidate = clone(this.#envelope);
		const index = candidate.entries.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return false;
		}
		candidate.entries.splice(index, 1);
		this.#commitCandidate(candidate);
		return true;
	}

	#commitCandidate(candidate) {
		if (this.#envelope.revision >= MAX_VAULT_REVISION) {
			throw new Error(
				'Vault revision limit reached; rotate the data-encryption key.',
			);
		}
		candidate.revision = this.#envelope.revision + 1;
		candidate.manifest = sealManifest(candidate, this.#requireKey());
		assertEnvelope(candidate);
		this.#envelope = candidate;
	}

	async withSecret(id, callback) {
		const key = this.#requireKey();
		if (typeof callback !== 'function') {
			throw new TypeError('withSecret requires a callback.');
		}
		const entry = this.#envelope.entries.find(
			(candidate) => candidate.id === id,
		);
		if (!entry) {
			throw new Error(`Secret ${id} does not exist.`);
		}
		let plaintext;
		try {
			plaintext = decryptAesGcm(
				entry,
				key,
				entryAad(this.#envelope.serverId, entry.id),
			);
			return await callback(plaintext);
		} finally {
			plaintext?.fill(0);
		}
	}

	async rewrap(nextProtector, nextUnlockMaterial) {
		const key = Buffer.from(this.#requireKey());
		const rewrapEpoch = this.#lockEpoch;
		try {
			const nextKeyEnvelope = await nextProtector.wrap(
				key,
				nextUnlockMaterial,
				this.#envelope.serverId,
			);
			if (rewrapEpoch !== this.#lockEpoch) {
				throw new VaultLockedError();
			}
			const candidate = clone({
				...this.#envelope,
				keyEnvelope: nextKeyEnvelope,
			});
			if (candidate.revision >= MAX_VAULT_REVISION) {
				throw new Error(
					'Vault revision limit reached; rotate the data-encryption key.',
				);
			}
			candidate.revision += 1;
			candidate.manifest = sealManifest(candidate, key);
			assertEnvelope(candidate);
			if (nextProtector.type !== candidate.keyEnvelope.protector) {
				throw new VaultFormatError(
					'The key protector does not match the rewrapped envelope.',
				);
			}
			this.#envelope = candidate;
			this.#protector = nextProtector;
		} finally {
			key.fill(0);
		}
	}

	serialize() {
		assertEnvelope(this.#envelope);
		const serialized = JSON.stringify(this.#envelope);
		if (Buffer.byteLength(serialized) > MAX_ENVELOPE_BYTES) {
			throw new VaultFormatError(
				'Vault envelope exceeds the versioned size limit.',
			);
		}
		return serialized;
	}

	static fromSerialized(serialized, protector) {
		if (
			typeof serialized !== 'string' ||
			Buffer.byteLength(serialized) > MAX_ENVELOPE_BYTES
		) {
			throw new VaultFormatError(
				'Vault envelope exceeds the versioned size limit.',
			);
		}
		return new ReferenceVault(JSON.parse(serialized), protector);
	}
}

export async function recoverReferenceVault(
	serializedSnapshots,
	protector,
	unlockMaterial,
) {
	if (
		!Array.isArray(serializedSnapshots) ||
		serializedSnapshots.length < 1 ||
		serializedSnapshots.length > 2
	) {
		throw new TypeError(
			'Recovery requires one or two newest-first vault snapshots.',
		);
	}
	for (
		let snapshotIndex = 0;
		snapshotIndex < serializedSnapshots.length;
		snapshotIndex += 1
	) {
		let candidate;
		try {
			candidate = ReferenceVault.fromSerialized(
				serializedSnapshots[snapshotIndex],
				protector,
			);
			await candidate.unlock(unlockMaterial);
			return { vault: candidate, snapshotIndex };
		} catch {
			candidate?.lock();
		}
	}
	throw new VaultUnlockError();
}

function validateUnlockSource(source) {
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new TypeError('An explicit headless unlock source is required.');
	}
	if (source.kind === 'tty') {
		exactKeys(source, ['kind'], 'TTY unlock source');
		return;
	}
	if (source.kind === 'inherited-fd') {
		exactKeys(source, ['fd', 'kind'], 'Inherited-FD unlock source');
		if (!Number.isInteger(source.fd) || source.fd < 3) {
			throw new TypeError(
				'The inherited key-file descriptor must be an integer of at least 3.',
			);
		}
		return;
	}
	throw new TypeError(
		'Only interactive /dev/tty and inherited one-shot key-file descriptors are accepted.',
	);
}

function setTerminalEcho(fd, enabled) {
	const result = spawnSync('stty', [enabled ? 'echo' : '-echo'], {
		stdio: [fd, 'ignore', 'ignore'],
	});
	if (!enabled && result.status !== 0) {
		throw new Error('Could not disable terminal echo.');
	}
}

function readOneLine(
	fd,
	read = readSync,
	copy = (value) => Buffer.from(value),
) {
	const collected = Buffer.alloc(MAX_PASSPHRASE_BYTES + 2);
	let length = 0;
	try {
		while (length < collected.length) {
			const bytesRead = read(
				fd,
				collected,
				length,
				collected.length - length,
				null,
			);
			if (bytesRead === 0) {
				break;
			}
			const newline = collected.indexOf(0x0a, length);
			length += bytesRead;
			if (newline !== -1 && newline < length) {
				length = newline;
				break;
			}
		}
		if (length > 0 && collected[length - 1] === 0x0d) {
			length -= 1;
		}
		if (length > MAX_PASSPHRASE_BYTES) {
			throw new RangeError(
				`Passphrase input exceeds ${MAX_PASSPHRASE_BYTES} bytes.`,
			);
		}
		const result = copy(collected.subarray(0, length));
		try {
			assertPassphrase(result);
			return result;
		} catch (error) {
			result.fill(0);
			throw error;
		}
	} finally {
		collected.fill(0);
	}
}

export function readHeadlessPassphrase(
	source,
	{
		open = openSync,
		close = closeSync,
		read = readSync,
		setEcho = setTerminalEcho,
		copy = (value) => Buffer.from(value),
		onReady = () => {},
	} = {},
) {
	validateUnlockSource(source);
	const tty = source.kind === 'tty';
	const fd = tty ? open('/dev/tty', 'r+') : source.fd;
	let echoDisabled = false;
	try {
		if (tty) {
			setEcho(fd, false);
			echoDisabled = true;
		}
		onReady();
		return readOneLine(fd, read, copy);
	} finally {
		if (echoDisabled) {
			try {
				setEcho(fd, true);
			} catch {
				// Best-effort restoration is the only safe option during startup failure.
			}
		}
		close(fd);
	}
}
