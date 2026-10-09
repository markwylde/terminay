import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DataRootLease } from './bootstrap.js';

const LOCK_FILE = '.terminay-server.lock.sqlite';
const OWNER_FILE = '.terminay-server.lock';
const FILE_MODE = 0o600;
const SQLITE_BUSY = 5;

interface HeldLease {
	readonly ownerPath: string;
	readonly database: DatabaseSync;
}

/**
 * The standalone server's claim on its data root, held by the kernel.
 *
 * An exclusive SQLite transaction, left open, keeps POSIX locks on the lock
 * file for as long as this process exists. The kernel drops them when the
 * process ends, however it ends, so a killed server leaves nothing to clear
 * and a paused one is still the holder (ADR-0055). The lock file is never
 * removed: unlinking it would let a second process lock a different inode.
 *
 * `.terminay-server.lock` only records who holds the root, for the message a
 * refused server prints. It decides nothing and a stale one is overwritten.
 */
export class FileDataRootLease implements DataRootLease {
	private readonly held = new Map<string, HeldLease>();

	async acquire(dataRoot: string): Promise<void> {
		const root = normalizeRoot(dataRoot);
		if (this.held.has(root))
			throw new Error('data root is already leased by this host');
		await mkdir(root, { recursive: true, mode: 0o700 });
		const lockPath = resolve(root, LOCK_FILE);
		const ownerPath = resolve(root, OWNER_FILE);
		let database: DatabaseSync | undefined;
		try {
			// `wx` never opens a file that exists. Opening and closing one that
			// this process already has locked would drop the lock.
			await open(lockPath, 'wx', FILE_MODE)
				.then((handle) => handle.close())
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code !== 'EEXIST') throw error;
				});
			database = new DatabaseSync(lockPath);
			database.exec('BEGIN EXCLUSIVE');
		} catch (error) {
			database?.close();
			if (isBusy(error)) {
				throw new DataRootInUseError(
					root,
					lockPath,
					await readLockOwner(ownerPath),
					{ cause: error },
				);
			}
			throw new DataRootLockUnavailableError(root, lockPath, { cause: error });
		}
		this.held.set(root, { ownerPath, database });
		const pending = `${ownerPath}.tmp`;
		await writeFile(
			pending,
			`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
			{ encoding: 'utf8', mode: FILE_MODE },
		);
		await rename(pending, ownerPath);
	}

	async release(dataRoot: string): Promise<void> {
		const root = normalizeRoot(dataRoot);
		const lease = this.held.get(root);
		if (lease === undefined) return;
		this.held.delete(root);
		// The record goes first, while the root is still ours to describe.
		await rm(lease.ownerPath, { force: true }).catch(() => undefined);
		lease.database.close();
	}
}

function isBusy(error: unknown): boolean {
	const errcode = (error as { errcode?: unknown } | undefined)?.errcode;
	return typeof errcode === 'number' && (errcode & 0xff) === SQLITE_BUSY;
}

/** Who the owner record says holds the root. Absent when it cannot be read. */
export type DataRootLockOwner = Readonly<{ pid?: number; startedAt?: string }>;

/** A running server holds the data root. */
export class DataRootInUseError extends Error {
	readonly dataRoot: string;
	readonly lockPath: string;
	readonly owner: DataRootLockOwner;

	constructor(
		dataRoot: string,
		lockPath: string,
		owner: DataRootLockOwner,
		options?: ErrorOptions,
	) {
		super('data root is already in use', options);
		this.name = 'DataRootInUseError';
		this.dataRoot = dataRoot;
		this.lockPath = lockPath;
		this.owner = owner;
	}
}

/** The data root could not be locked at all, so nothing proves it is free. */
export class DataRootLockUnavailableError extends Error {
	readonly dataRoot: string;
	readonly lockPath: string;

	constructor(dataRoot: string, lockPath: string, options?: ErrorOptions) {
		super('data root could not be locked', options);
		this.name = 'DataRootLockUnavailableError';
		this.dataRoot = dataRoot;
		this.lockPath = lockPath;
	}
}

async function readLockOwner(ownerPath: string): Promise<DataRootLockOwner> {
	try {
		const parsed: unknown = JSON.parse(await readFile(ownerPath, 'utf8'));
		if (typeof parsed !== 'object' || parsed === null) return {};
		const { pid, startedAt } = parsed as Record<string, unknown>;
		return {
			...(typeof pid === 'number' && Number.isSafeInteger(pid) ? { pid } : {}),
			...(typeof startedAt === 'string' && startedAt.length <= 64
				? { startedAt }
				: {}),
		};
	} catch {
		return {};
	}
}

/**
 * What an operator reads when the server refuses a held data root: that
 * another server is running on it, and how to find that server. A container's
 * process ids mean nothing outside it and its data root is a volume, so its
 * remedy is written in terms of containers and volumes.
 */
export function describeDataRootInUse(
	error: DataRootInUseError,
	options: Readonly<{ container: boolean }>,
): string {
	const { owner } = error;
	const heldBy =
		owner.startedAt === undefined
			? 'a running server'
			: `a server started at ${owner.startedAt}`;
	const lines = [
		'Terminay server did not start: another server is using its data root.',
		'',
		`  Data root: ${error.dataRoot}`,
		`  Lock file: ${error.lockPath}`,
		`  Held by:   ${heldBy}`,
		'',
		'Only one server may use a data root at a time. The lock is held by a',
		'running server and ends the moment that server does, however it stops, so',
		'there is no lock file to remove.',
		'',
		'To fix it:',
	];
	if (options.container) {
		lines.push(
			'  1. Find the container that is using this volume:',
			'       docker ps --filter volume=<your-volume>',
			'     A paused container still holds the lock.',
			'  2. Use that server, or stop it with `docker stop` and start this',
			'     container again.',
		);
	} else {
		lines.push(
			owner.pid === undefined
				? '  1. Find the terminay-server that is running on this data root.'
				: `  1. Check the server that holds it:\n       ps -p ${owner.pid}`,
			'  2. Use that server, or stop it and start this one again.',
		);
	}
	return `${lines.join('\n')}\n`;
}

/** What an operator reads when the data root cannot be locked at all. */
export function describeDataRootLockUnavailable(
	error: DataRootLockUnavailableError,
): string {
	const cause =
		error.cause instanceof Error ? error.cause.message : String(error.cause);
	const lines = [
		'Terminay server did not start: its data root could not be locked.',
		'',
		`  Data root: ${error.dataRoot}`,
		`  Lock file: ${error.lockPath}`,
		`  Cause:     ${cause}`,
		'',
		'The server locks its data root so that only one server uses it, and does',
		'not start without that lock. Keep the data root on a local filesystem',
		'that supports file locking, writable by the user the server runs as.',
	];
	return `${lines.join('\n')}\n`;
}

function normalizeRoot(dataRoot: string): string {
	if (
		typeof dataRoot !== 'string' ||
		dataRoot.trim().length === 0 ||
		dataRoot.length > 4096
	)
		throw new TypeError('data root is invalid');
	return resolve(dataRoot);
}
