import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProtocolId } from '@terminay/protocol';
import type {
	SecretVaultAdapter,
	VaultSecretInput,
	VaultState,
	VaultUnlockRequest,
} from '../../packages/server-core/src/settings/vault';
import {
	MAX_VAULT_LABEL_BYTES,
	MAX_VAULT_SECRET_BYTES,
	VAULT_ID_PATTERN,
} from '../../packages/server-core/src/settings/vault';
import type { SecretReference } from '../../packages/server-core/src/settings/types';

const FORMAT = 'terminay-electron-safe-storage-vault';
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 4096;

export interface SafeStorageCodec {
	readonly backend: () => string | undefined;
	readonly decrypt: (encrypted: Buffer) => string;
	readonly encrypt: (plainText: string) => Buffer;
	readonly isAvailable: () => boolean;
}

interface StoredEntry {
	readonly id: string;
	readonly label?: string;
	readonly version: number;
	readonly updatedAt: number;
	readonly ciphertext: string;
}

interface StoredVault {
	readonly format: typeof FORMAT;
	readonly version: 1;
	readonly revision: number;
	readonly entries: readonly StoredEntry[];
}

export interface SafeStorageVaultRepository {
	load(): Promise<unknown | undefined>;
	commit(value: StoredVault): Promise<void>;
}

/** Atomic, owner-only persistence for ciphertext and non-secret metadata. */
export class FileSafeStorageVaultRepository
	implements SafeStorageVaultRepository
{
	constructor(private readonly file: string) {
		if (typeof file !== 'string' || file.length === 0)
			throw new TypeError('vault storage path is required');
	}

	async load(): Promise<unknown | undefined> {
		try {
			const serialized = await readFile(this.file, 'utf8');
			if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES)
				throw new Error('encrypted vault record exceeds its size limit');
			return JSON.parse(serialized) as unknown;
		} catch (error) {
			if ((error as { code?: string }).code === 'ENOENT') return undefined;
			throw new Error('encrypted vault record could not be loaded');
		}
	}

	async commit(value: StoredVault): Promise<void> {
		const serialized = `${JSON.stringify(value)}\n`;
		if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES)
			throw new Error('encrypted vault record exceeds its size limit');
		await mkdir(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, serialized, {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			});
			await rename(temporary, this.file);
		} finally {
			await rm(temporary, { force: true }).catch(() => undefined);
		}
	}
}

/**
 * Electron-main-only vault. Secret values are individually protected by the
 * operating system and the repository receives ciphertext exclusively.
 * Linux's `basic_text` backend is deliberately treated as unavailable.
 */
export class ElectronSafeStorageVaultAdapter implements SecretVaultAdapter {
	readonly backend = 'embedded-safe-storage' as const;
	private state: VaultState = 'locked';
	private revision = 0;
	private entries = new Map<string, StoredEntry>();
	private writes = Promise.resolve();

	private constructor(
		private readonly repository: SafeStorageVaultRepository,
		private readonly codec: SafeStorageCodec,
	) {}

	static async open(
		options: Readonly<{
			repository: SafeStorageVaultRepository;
			codec: SafeStorageCodec;
		}>,
	): Promise<ElectronSafeStorageVaultAdapter> {
		if (!options?.repository || !options?.codec)
			throw new TypeError('safe-storage vault options are required');
		const adapter = new ElectronSafeStorageVaultAdapter(
			options.repository,
			options.codec,
		);
		const raw = await options.repository.load();
		const stored = parseStoredVault(raw);
		adapter.revision = stored.revision;
		adapter.entries = new Map(stored.entries.map((entry) => [entry.id, entry]));
		if (!adapter.protectorAvailable()) adapter.state = 'unavailable';
		return adapter;
	}

	status(): VaultState {
		if (!this.protectorAvailable()) return 'unavailable';
		return this.state;
	}

	async unlock(_request: VaultUnlockRequest): Promise<void> {
		this.assertProtector();
		this.state = 'unlocked';
	}

	lock(): void {
		this.state = this.protectorAvailable() ? 'locked' : 'unavailable';
	}

	list(): readonly SecretReference[] {
		return Object.freeze(
			[...this.entries.values()]
				.sort((left, right) => left.id.localeCompare(right.id))
				.map(({ id, label, version, updatedAt }) =>
					Object.freeze({
						id,
						configured: true,
						...(label === undefined ? {} : { label }),
						version,
						updatedAt,
					}),
				),
		);
	}

	put(input: VaultSecretInput): Promise<SecretReference> {
		return this.mutate(input, false);
	}

	replace(input: VaultSecretInput): Promise<SecretReference> {
		return this.mutate(input, true);
	}

	async test(id: ProtocolId): Promise<void> {
		this.assertUnlocked();
		if (!this.entries.has(id)) throw new Error('missing secret');
		await this.decrypt(id, () => undefined);
	}

	async remove(id: ProtocolId): Promise<boolean> {
		this.assertUnlocked();
		let deleted = false;
		await this.serializedWrite(async () => {
			if (!this.entries.has(id)) return;
			const next = new Map(this.entries);
			next.delete(id);
			await this.commit(next, this.revision + 1);
			this.entries = next;
			this.revision += 1;
			deleted = true;
		});
		return deleted;
	}

	async rotate(): Promise<void> {
		this.assertUnlocked();
		await this.serializedWrite(async () => {
			const next = new Map<string, StoredEntry>();
			for (const entry of this.entries.values()) {
				await this.decrypt(entry.id, (secret) => {
					next.set(entry.id, {
						...entry,
						version: entry.version + 1,
						updatedAt: Date.now(),
						ciphertext: this.encrypt(secret),
					});
				});
			}
			await this.commit(next, this.revision + 1);
			this.entries = next;
			this.revision += 1;
		});
	}

	async withSecret<T>(
		id: ProtocolId,
		callback: (secret: Uint8Array) => T | Promise<T>,
	): Promise<T> {
		this.assertUnlocked();
		return await this.decrypt(id, callback);
	}

	private async mutate(
		input: VaultSecretInput,
		replacing: boolean,
	): Promise<SecretReference> {
		this.assertUnlocked();
		let output!: SecretReference;
		await this.serializedWrite(async () => {
			const previous = this.entries.get(input.id);
			if (replacing ? previous === undefined : previous !== undefined)
				throw new Error(replacing ? 'missing secret' : 'secret already exists');
			const updatedAt = Date.now();
			const entry: StoredEntry = {
				id: input.id,
				...(input.label === undefined ? {} : { label: input.label }),
				version: (previous?.version ?? 0) + 1,
				updatedAt,
				ciphertext: this.encrypt(input.value),
			};
			const next = new Map(this.entries).set(entry.id, entry);
			await this.commit(next, this.revision + 1);
			this.entries = next;
			this.revision += 1;
			output = Object.freeze({
				id: entry.id,
				configured: true,
				...(entry.label === undefined ? {} : { label: entry.label }),
				version: entry.version,
				updatedAt,
			});
		});
		return output;
	}

	private encrypt(secret: Uint8Array): string {
		this.assertUnlocked();
		if (
			!(secret instanceof Uint8Array) ||
			secret.byteLength > MAX_VAULT_SECRET_BYTES
		)
			throw new TypeError('vault secret is invalid');
		return this.codec
			.encrypt(Buffer.from(secret).toString('base64'))
			.toString('base64');
	}

	private async decrypt<T>(
		id: string,
		callback: (secret: Uint8Array) => T | Promise<T>,
	): Promise<T> {
		this.assertUnlocked();
		const entry = this.entries.get(id);
		if (entry === undefined) throw new Error('missing secret');
		let bytes: Uint8Array | undefined;
		try {
			const encoded = this.codec.decrypt(
				Buffer.from(entry.ciphertext, 'base64'),
			);
			const decoded = Buffer.from(encoded, 'base64');
			if (
				decoded.toString('base64') !== encoded ||
				decoded.byteLength > MAX_VAULT_SECRET_BYTES
			)
				throw new Error('encrypted vault record is invalid');
			bytes = new Uint8Array(decoded);
			return await callback(bytes);
		} finally {
			bytes?.fill(0);
		}
	}

	private serializedWrite(operation: () => Promise<void>): Promise<void> {
		const next = this.writes.then(operation);
		this.writes = next.catch(() => undefined);
		return next;
	}

	private commit(
		entries: Map<string, StoredEntry>,
		revision: number,
	): Promise<void> {
		return this.repository.commit({
			format: FORMAT,
			version: 1,
			revision,
			entries: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)),
		});
	}

	private protectorAvailable(): boolean {
		try {
			return (
				this.codec.isAvailable() &&
				this.codec.backend()?.toLowerCase() !== 'basic_text'
			);
		} catch {
			return false;
		}
	}

	private assertProtector(): void {
		if (!this.protectorAvailable()) {
			this.state = 'unavailable';
			throw new Error('OS-backed safe storage is unavailable');
		}
	}

	private assertUnlocked(): void {
		this.assertProtector();
		if (this.state !== 'unlocked') throw new Error('vault is locked');
	}
}

function parseStoredVault(raw: unknown): StoredVault {
	if (raw === undefined)
		return { format: FORMAT, version: 1, revision: 0, entries: [] };
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('encrypted vault record is invalid');
	const value = raw as Record<string, unknown>;
	if (
		value.format !== FORMAT ||
		value.version !== 1 ||
		!Number.isSafeInteger(value.revision) ||
		Number(value.revision) < 0 ||
		!Array.isArray(value.entries) ||
		value.entries.length > MAX_ENTRIES
	)
		throw new Error('encrypted vault record is invalid');
	const ids = new Set<string>();
	const entries = value.entries.map((candidate): StoredEntry => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
			throw new Error('encrypted vault record is invalid');
		const entry = candidate as Record<string, unknown>;
		if (
			typeof entry.id !== 'string' ||
			!VAULT_ID_PATTERN.test(entry.id) ||
			ids.has(entry.id) ||
			(entry.label !== undefined &&
				(typeof entry.label !== 'string' ||
					new TextEncoder().encode(entry.label).byteLength >
						MAX_VAULT_LABEL_BYTES)) ||
			!Number.isSafeInteger(entry.version) ||
			Number(entry.version) < 1 ||
			!Number.isSafeInteger(entry.updatedAt) ||
			Number(entry.updatedAt) < 0 ||
			typeof entry.ciphertext !== 'string' ||
			entry.ciphertext.length === 0 ||
			!/^[A-Za-z0-9+/]+={0,2}$/u.test(entry.ciphertext)
		)
			throw new Error('encrypted vault record is invalid');
		ids.add(entry.id);
		return {
			id: entry.id,
			...(entry.label === undefined ? {} : { label: entry.label }),
			version: Number(entry.version),
			updatedAt: Number(entry.updatedAt),
			ciphertext: entry.ciphertext,
		};
	});
	return {
		format: FORMAT,
		version: 1,
		revision: Number(value.revision),
		entries,
	};
}
