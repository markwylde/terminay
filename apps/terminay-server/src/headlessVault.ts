import { randomBytes } from 'node:crypto';
import { closeSync, readSync } from 'node:fs';
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	createServerVaultComposition,
	FileVaultEnvelopeStorage,
	HeadlessPassphraseVaultAdapter,
	MAX_VAULT_UNLOCK_BYTES,
	type ServerVaultComposition,
	type VaultEnvelopeStorage,
	writeFileDurably,
} from '@terminay/server-core';

/** File operations the startup state machine uses; tests inject faults. */
export interface VaultFileOps {
	readonly writeKey: (path: string, key: Uint8Array) => Promise<void>;
	readonly promote: (from: string, to: string) => Promise<void>;
}

export interface StandaloneVaultOptions {
	readonly dataRoot: string;
	readonly serverId: string;
	readonly unlockFd?: number;
	/** With `unlockFd`: move the vault to the key file (ADR-0118). */
	readonly convertToKeyFile?: boolean;
	/** Tests replace the descriptor read; production reads `unlockFd` once. */
	readonly readDescriptor?: (fd: number) => Uint8Array;
	readonly log?: (line: string) => void;
	/** Tests wrap the envelope store or file operations to inject faults. */
	readonly storage?: (inner: VaultEnvelopeStorage) => VaultEnvelopeStorage;
	readonly fileOps?: Partial<VaultFileOps>;
}

interface UnlockIo {
	readonly read: (
		fd: number,
		target: Uint8Array,
		offset: number,
		length: number,
	) => number;
	readonly close: (fd: number) => void;
}

const nodeUnlockIo: UnlockIo = {
	read: (fd, target, offset, length) =>
		readSync(fd, target, offset, length, null),
	close: (fd) => closeSync(fd),
};

/** Read and consume a one-shot inherited descriptor. Descriptor zero is
 * deliberately rejected: ordinary stdin is never a vault unlock channel. */
export function readOneShotVaultUnlockFd(
	fd: number,
	io: UnlockIo = nodeUnlockIo,
): Uint8Array {
	if (!Number.isSafeInteger(fd) || fd < 3)
		throw new Error(
			'vault unlock descriptor must be an inherited fd of 3 or greater',
		);
	const bytes = new Uint8Array(MAX_VAULT_UNLOCK_BYTES + 1);
	let used = 0;
	try {
		while (used < bytes.byteLength) {
			const count = io.read(fd, bytes, used, bytes.byteLength - used);
			if (
				!Number.isSafeInteger(count) ||
				count < 0 ||
				count > bytes.byteLength - used
			)
				throw new Error('vault unlock descriptor read failed');
			if (count === 0) break;
			used += count;
		}
	} catch (error) {
		bytes.fill(0);
		throw error;
	} finally {
		try {
			io.close(fd);
		} catch {
			bytes.fill(0);
		}
	}
	if (used > MAX_VAULT_UNLOCK_BYTES) {
		bytes.fill(0);
		throw new Error('vault unlock input exceeds its size limit');
	}
	while (used > 0 && (bytes[used - 1] === 10 || bytes[used - 1] === 13))
		used -= 1;
	if (used === 0) {
		bytes.fill(0);
		throw new Error('vault unlock input is empty');
	}
	const result = bytes.slice(0, used);
	bytes.fill(0);
	return result;
}

/** The server's own vault key, beside the envelope (ADR-0118). */
export const VAULT_KEY_FILE = 'headless-v1.key';
export const VAULT_PENDING_KEY_FILE = 'headless-v1.key.pending';
const VAULT_ENVELOPE_FILE = 'headless-v1.json';
const VAULT_KEY_BYTES = 32;

type KeyRead =
	| { readonly kind: 'missing' }
	| { readonly kind: 'unusable'; readonly reason: string }
	| { readonly kind: 'key'; readonly key: Uint8Array };

/** Read a key file only when it is a regular file within the unlock bound.
 * A file others can read is tightened to its owner. Nothing is deleted. */
async function readKeyFile(
	path: string,
	log: (line: string) => void,
): Promise<KeyRead> {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return { kind: 'missing' };
		return { kind: 'unusable', reason: 'could not be read' };
	}
	if (!info.isFile()) return { kind: 'unusable', reason: 'is not a file' };
	if (info.size > MAX_VAULT_UNLOCK_BYTES)
		return { kind: 'unusable', reason: 'is too large to be a vault key' };
	if ((info.mode & 0o077) !== 0) {
		try {
			await chmod(path, 0o600);
			log(
				`vault key ${path} was readable by others; restricted it to its owner`,
			);
		} catch {
			return {
				kind: 'unusable',
				reason: 'is readable by others and could not be restricted',
			};
		}
	}
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch {
		return { kind: 'unusable', reason: 'could not be read' };
	}
	let used = Math.min(bytes.byteLength, MAX_VAULT_UNLOCK_BYTES);
	while (used > 0 && (bytes[used - 1] === 10 || bytes[used - 1] === 13))
		used -= 1;
	const key = new Uint8Array(bytes.subarray(0, used));
	bytes.fill(0);
	if (key.byteLength === 0) return { kind: 'unusable', reason: 'is empty' };
	return { kind: 'key', key };
}

/** A fresh key, base64url-encoded so the file is printable. */
function generateKey(): Uint8Array {
	const raw = randomBytes(VAULT_KEY_BYTES);
	const encoded = Buffer.from(raw.toString('base64url'), 'utf8');
	raw.fill(0);
	const result = new Uint8Array(encoded);
	encoded.fill(0);
	return result;
}

async function flushDirectory(directory: string): Promise<void> {
	const handle = await open(directory, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

const nodeFileOps: VaultFileOps = {
	async writeKey(path, key) {
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await writeFileDurably(path, key, { mode: 0o600 });
	},
	async promote(from, to) {
		await rename(from, to);
		await flushDirectory(dirname(to));
	},
};

/** `unlock` zeroizes its input, so each attempt gets its own copy. */
async function tryUnlock(
	composition: ServerVaultComposition,
	secret: Uint8Array,
): Promise<boolean> {
	try {
		await composition.unlock({ secret: new Uint8Array(secret) });
		return composition.status().state === 'unlocked';
	} catch {
		return false;
	}
}

/**
 * Compose the standalone vault and unlock it without operator input
 * (ADR-0118). The order is: pending-key recovery, the descriptor, the key
 * file, and a new key for an empty vault. A descriptor-unlocked vault stays
 * operator-managed unless `convertToKeyFile` is set. No path removes or
 * rewrites a key file that might be the only one opening the envelope.
 */
export async function createStandaloneVaultComposition(
	options: StandaloneVaultOptions,
): Promise<ServerVaultComposition> {
	const log =
		options.log ??
		((line: string) => console.warn(`[terminay-server] ${line}`));
	const ops: VaultFileOps = { ...nodeFileOps, ...options.fileOps };
	const directory = join(options.dataRoot, 'vault');
	const envelopePath = join(directory, VAULT_ENVELOPE_FILE);
	const keyPath = join(directory, VAULT_KEY_FILE);
	const pendingPath = join(directory, VAULT_PENDING_KEY_FILE);
	const fileStorage = new FileVaultEnvelopeStorage(envelopePath);
	const adapter = await HeadlessPassphraseVaultAdapter.open({
		serverId: options.serverId,
		storage: options.storage ? options.storage(fileStorage) : fileStorage,
	});
	const composition = createServerVaultComposition(adapter);
	if (composition.status().state === 'unavailable') {
		log(`vault is unavailable: ${envelopePath} could not be read`);
		return composition;
	}

	const pending = await readKeyFile(pendingPath, log);
	let unlockedByPending = false;
	if (pending.kind === 'key') {
		try {
			unlockedByPending =
				adapter.initialized && (await tryUnlock(composition, pending.key));
		} finally {
			pending.key.fill(0);
		}
		if (unlockedByPending) {
			try {
				await ops.promote(pendingPath, keyPath);
			} catch {
				log(
					`vault is unlocked, but ${pendingPath} could not be moved to ${keyPath}; it will be retried on the next start`,
				);
			}
			return composition;
		}
	}

	const outcome = await unlockWithoutPending(
		options,
		composition,
		adapter,
		{ envelopePath, keyPath, pendingPath },
		ops,
		log,
	);
	// A pending key that did not open an envelope another secret opened never
	// committed. One that remains while the vault is locked is kept, and so is
	// one a conversion in this run still depends on.
	if (outcome.unlocked && !outcome.pendingInUse && pending.kind !== 'missing')
		await unlink(pendingPath).catch(() => undefined);
	return composition;
}

interface UnlockOutcome {
	readonly unlocked: boolean;
	/** A conversion in this run left a pending key that may open the vault. */
	readonly pendingInUse: boolean;
}

const LOCKED: UnlockOutcome = { unlocked: false, pendingInUse: false };
const UNLOCKED: UnlockOutcome = { unlocked: true, pendingInUse: false };

async function unlockWithoutPending(
	options: StandaloneVaultOptions,
	composition: ServerVaultComposition,
	adapter: HeadlessPassphraseVaultAdapter,
	paths: {
		readonly envelopePath: string;
		readonly keyPath: string;
		readonly pendingPath: string;
	},
	ops: VaultFileOps,
	log: (line: string) => void,
): Promise<UnlockOutcome> {
	const { envelopePath, keyPath, pendingPath } = paths;

	if (options.unlockFd !== undefined) {
		const read = options.readDescriptor ?? readOneShotVaultUnlockFd;
		let secret: Uint8Array | undefined;
		try {
			secret = read(options.unlockFd);
		} catch (error) {
			log(
				`vault: --vault-unlock-fd could not be read (${error instanceof Error ? error.message : 'read failed'})`,
			);
		}
		if (secret !== undefined) {
			let opened: boolean;
			try {
				opened = await tryUnlock(composition, secret);
			} finally {
				secret.fill(0);
			}
			if (opened) {
				if (options.convertToKeyFile !== true) return UNLOCKED;
				const existing = await readKeyFile(keyPath, log);
				if (existing.kind === 'key') existing.key.fill(0);
				if (existing.kind !== 'missing') {
					log(`vault: ${keyPath} already exists; not converting`);
					return UNLOCKED;
				}
				return {
					unlocked: true,
					pendingInUse: await convertToKeyFile(
						adapter,
						keyPath,
						pendingPath,
						ops,
						log,
					),
				};
			}
			log(
				'vault: the secret from --vault-unlock-fd does not unlock it; trying the key file',
			);
		}
	}

	const key = await readKeyFile(keyPath, log);
	if (key.kind === 'unusable') {
		log(`vault is locked: ${keyPath} ${key.reason}`);
		return LOCKED;
	}
	if (key.kind === 'key') {
		let opened: boolean;
		try {
			opened = await tryUnlock(composition, key.key);
		} finally {
			key.key.fill(0);
		}
		if (opened) return UNLOCKED;
		log(
			adapter.initialized
				? `vault is locked: ${keyPath} does not unlock ${envelopePath}. Restore the matching key file, or move ${envelopePath} aside to start an empty vault`
				: `vault is locked: ${keyPath} is not a usable vault key`,
		);
		return LOCKED;
	}

	if (adapter.initialized) {
		log(
			`vault is locked: it was created with a passphrase and ${keyPath} does not exist. Start the server once with --vault-unlock-fd and --vault-convert-to-key-file to convert it, or move ${envelopePath} aside to start an empty vault`,
		);
		return LOCKED;
	}

	const fresh = generateKey();
	try {
		await ops.writeKey(keyPath, fresh);
	} catch {
		fresh.fill(0);
		log(`vault is locked: ${keyPath} could not be written`);
		return LOCKED;
	}
	try {
		if (await tryUnlock(composition, fresh)) return UNLOCKED;
		log('vault is locked: a new vault could not be created');
		return LOCKED;
	} finally {
		fresh.fill(0);
	}
}

/** Write the new key aside, re-wrap (the commit point), then promote it. The
 * pending file is never removed here: after a failed re-wrap it may be the
 * only key that opens the envelope, and the next start resolves it. Returns
 * whether a pending key was left in place. */
async function convertToKeyFile(
	adapter: HeadlessPassphraseVaultAdapter,
	keyPath: string,
	pendingPath: string,
	ops: VaultFileOps,
	log: (line: string) => void,
): Promise<boolean> {
	const key = generateKey();
	try {
		try {
			await ops.writeKey(pendingPath, key);
		} catch {
			log(
				`vault is unlocked for this run, but ${pendingPath} could not be written`,
			);
			// A partial write may have left a file; it opens nothing, and the
			// next start that unlocks removes it.
			return false;
		}
		try {
			await adapter.rewrap({ secret: key });
		} catch {
			log(
				'vault is unlocked for this run, but it could not be converted to a key file; the next start will finish or discard the conversion',
			);
			return true;
		}
		try {
			await ops.promote(pendingPath, keyPath);
			return false;
		} catch {
			log(
				`vault was converted, but ${pendingPath} could not be moved to ${keyPath}; it will be retried on the next start`,
			);
			return true;
		}
	} finally {
		key.fill(0);
	}
}
