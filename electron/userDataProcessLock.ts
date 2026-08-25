import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const USER_DATA_PROCESS_LOCK_FILE = '.terminay-process.lock';

export interface UserDataProcessLock {
	readonly lockPath: string;
	release(): void;
}

export interface UserDataProcessLockOptions {
	readonly pid?: number;
	readonly isPidAlive?: (pid: number) => boolean;
	/** Vite/Electron rebuilds start the replacement process before the previous
	 * owner has released the lock. Retry briefly so a live second instance still
	 * fails closed after the window. */
	readonly retryAttempts?: number;
	readonly retryDelayMs?: number;
	readonly sleep?: (ms: number) => void;
}

/**
 * Exclusive, crash-visible lease for one Desktop user-data root.
 *
 * A second live process must not compose against the same profile. A lock
 * whose recorded pid is no longer alive is treated as leftover crash state
 * and may be replaced; a live foreign pid fails closed.
 */
export function acquireUserDataProcessLock(
	userDataPath: string,
	options: UserDataProcessLockOptions = {},
): UserDataProcessLock | undefined {
	if (typeof userDataPath !== 'string' || userDataPath.trim().length === 0) {
		throw new TypeError('user-data path is required');
	}
	const pid = options.pid ?? process.pid;
	const isPidAlive = options.isPidAlive ?? pidIsAlive;
	mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
	const lockPath = path.join(userDataPath, USER_DATA_PROCESS_LOCK_FILE);
	const attempts = Math.max(1, options.retryAttempts ?? 1);
	const delayMs = Math.max(0, options.retryDelayMs ?? 100);
	const sleep = options.sleep ?? sleepSync;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const lock = tryAcquireOnce(lockPath, pid, isPidAlive);
		if (lock !== undefined) return lock;
		if (attempt + 1 < attempts) sleep(delayMs);
	}
	return undefined;
}

function tryAcquireOnce(
	lockPath: string,
	pid: number,
	isPidAlive: (pid: number) => boolean,
): UserDataProcessLock | undefined {
	if (!tryCreateLockFile(lockPath, pid)) {
		const owner = readLockOwner(lockPath);
		if (owner !== undefined && owner !== pid && isPidAlive(owner)) return undefined;
		rmSync(lockPath, { force: true });
		if (!tryCreateLockFile(lockPath, pid)) return undefined;
	}
	return {
		lockPath,
		release() {
			try {
				rmSync(lockPath, { force: true });
			} catch {
				/* shutdown still proceeds if the lock file is already gone */
			}
		},
	};
}

function sleepSync(ms: number): void {
	if (ms <= 0) return;
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryCreateLockFile(lockPath: string, pid: number): boolean {
	let fd: number | undefined;
	try {
		fd = openSync(lockPath, 'wx', 0o600);
		writeFileSync(
			fd,
			`${JSON.stringify({ pid, startedAt: new Date().toISOString() })}\n`,
		);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
		throw error;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function readLockOwner(lockPath: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			!('pid' in parsed) ||
			!Number.isSafeInteger((parsed as { pid: unknown }).pid)
		) {
			return undefined;
		}
		const owner = (parsed as { pid: number }).pid;
		return owner > 0 ? owner : undefined;
	} catch {
		return undefined;
	}
}

function pidIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
