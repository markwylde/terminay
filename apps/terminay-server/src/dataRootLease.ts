import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DataRootLease } from './bootstrap.js';

const LOCK_FILE = '.terminay-server.lock';
const LOCK_MODE = 0o600;

interface HeldLease {
	readonly root: string;
	readonly lockPath: string;
	readonly handle: Awaited<ReturnType<typeof open>>;
}

/**
 * A host-owned, crash-visible lease for an embedded server data root.
 *
 * `open(..., "wx")` makes acquisition atomic across processes. A lock is
 * deliberately not treated as stale automatically: silently stealing a root
 * can create two authorities and corrupt durable state. Recovery is an
 * explicit host operation after the owning process has been verified gone.
 */
export class FileDataRootLease implements DataRootLease {
	private readonly held = new Map<string, HeldLease>();

	async acquire(dataRoot: string): Promise<void> {
		const root = normalizeRoot(dataRoot);
		if (this.held.has(root))
			throw new Error('data root is already leased by this host');
		await mkdir(root, { recursive: true, mode: 0o700 });
		const lockPath = resolve(root, LOCK_FILE);
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(lockPath, 'wx', LOCK_MODE);
			await handle.writeFile(
				`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
				'utf8',
			);
			await handle.sync();
			this.held.set(root, { root, lockPath, handle });
		} catch (error) {
			await handle?.close().catch(() => undefined);
			if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
				throw new DataRootInUseError(
					root,
					lockPath,
					await readLockOwner(lockPath),
					{ cause: error },
				);
			}
			throw error;
		}
	}

	async release(dataRoot: string): Promise<void> {
		const root = normalizeRoot(dataRoot);
		const lease = this.held.get(root);
		if (lease === undefined) return;
		this.held.delete(root);
		await lease.handle.close().catch(() => undefined);
		await rm(lease.lockPath, { force: true }).catch(() => undefined);
	}
}

/** Who a lock file says wrote it. Absent when the file cannot be read as one. */
export type DataRootLockOwner = Readonly<{ pid?: number; startedAt?: string }>;

/** Another server holds the data root, or one died without releasing it. */
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

async function readLockOwner(lockPath: string): Promise<DataRootLockOwner> {
	try {
		const parsed: unknown = JSON.parse(await readFile(lockPath, 'utf8'));
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
 * What an operator reads when the server refuses a locked data root: what
 * happened, why the server will not clear it itself, and the commands that do.
 * A container's process ids mean nothing outside it and its data root is a
 * volume, so its remedy is written in terms of containers and volumes.
 */
export function describeDataRootInUse(
	error: DataRootInUseError,
	options: Readonly<{ container: boolean }>,
): string {
	const { owner } = error;
	const leftBy =
		owner.startedAt === undefined
			? 'an earlier server'
			: `a server started at ${owner.startedAt}`;
	const lines = [
		'Terminay server did not start: its data root is locked.',
		'',
		`  Data root: ${error.dataRoot}`,
		`  Lock file: ${error.lockPath}`,
		`  Left by:   ${leftBy}`,
		'',
		'Only one server may use a data root at a time. Either another server is',
		'running on it now, or an earlier one was killed before it could remove its',
		'lock. The lock is never removed automatically, because two servers on one',
		'data root would corrupt it.',
		'',
		'To fix it:',
	];
	if (options.container) {
		lines.push(
			'  1. Check that no other container is using this volume:',
			'       docker ps --filter volume=<your-volume>',
			'     If one is, use it, or stop it with `docker stop` before starting this one.',
			'  2. If none is, remove the stale lock and start this container again:',
			`       docker run --rm -v <your-volume>:${error.dataRoot} --entrypoint rm <this-image> ${error.lockPath}`,
			'',
			'Stop the server with `docker stop`, not `docker kill` or `docker rm -f`, so',
			'it removes its lock on the way out.',
		);
	} else {
		lines.push(
			owner.pid === undefined
				? '  1. Check that no other terminay-server is running on this data root.'
				: `  1. Check whether the server that wrote the lock is still running:\n       ps -p ${owner.pid}`,
			'     If it is, use it, or stop it before starting this one.',
			'  2. If it is not, remove the stale lock and start the server again:',
			`       rm ${error.lockPath}`,
		);
	}
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
