import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
	type ProtocolError,
	STORAGE_FAILURE_REASONS,
	type StorageFailureReason,
} from '@terminay/protocol';

const MAX_CAUSE_DEPTH = 8;

/** The filesystem calls whose refusal says something about storage. `watch`
 * (where ENOSPC is the inotify limit), `kill` and `spawn` are deliberately
 * absent. */
const FILESYSTEM_SYSCALLS: ReadonlySet<string> = new Set(
	(
		'access chmod chown close copyfile cp fchmod fchown fdatasync fstat ' +
		'fsync ftruncate futime lchmod lchown link lstat lutime mkdir mkdtemp ' +
		'open opendir read readlink realpath rename rm rmdir scandir stat ' +
		'symlink truncate unlink utime utimes write writev'
	).split(' '),
);

interface FilesystemError {
	readonly code: string;
	readonly path?: unknown;
	readonly dest?: unknown;
}

/**
 * Name a command failure the server's storage caused, wherever the system
 * error sits in the cause chain (ADR-0150). The messages are fixed: no path or
 * platform text reaches the client. The refused path only chooses between the
 * two permission messages.
 */
export function storageFailure(
	error: unknown,
	dataRoot?: string,
): ProtocolError | undefined {
	let current = error;
	for (
		let depth = 0;
		depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null;
		depth += 1
	) {
		if (isFilesystemError(current)) {
			const named = nameFailure(current, dataRoot);
			if (named !== undefined) return named;
		}
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

function isFilesystemError(value: object): value is FilesystemError {
	const candidate = value as {
		code?: unknown;
		errno?: unknown;
		syscall?: unknown;
	};
	return (
		typeof candidate.code === 'string' &&
		typeof candidate.errno === 'number' &&
		typeof candidate.syscall === 'string' &&
		FILESYSTEM_SYSCALLS.has(candidate.syscall)
	);
}

function nameFailure(
	error: FilesystemError,
	dataRoot: string | undefined,
): ProtocolError | undefined {
	const named = (
		code: ProtocolError['code'],
		message: string,
		reason: StorageFailureReason,
		retryable: boolean,
	): ProtocolError => ({ code, message, details: { reason }, retryable });
	switch (error.code) {
		case 'ENOSPC':
			return named(
				'unavailable',
				"The server's disk is full",
				STORAGE_FAILURE_REASONS.full,
				true,
			);
		case 'EDQUOT':
			return named(
				'resource',
				"The server's disk quota is exceeded",
				STORAGE_FAILURE_REASONS.quotaExceeded,
				true,
			);
		case 'EROFS':
			return named(
				'unavailable',
				"The server's storage is read-only",
				STORAGE_FAILURE_REASONS.readOnly,
				false,
			);
		case 'EACCES':
		case 'EPERM':
			// `unavailable`, not `forbidden`: the device's scope is not at fault.
			return named(
				'unavailable',
				// A rename or copy names two paths; either may be the refused one.
				isInside(dataRoot, error.path) || isInside(dataRoot, error.dest)
					? 'The server does not have permission to access its data folder'
					: 'The server does not have permission to access that file or folder',
				STORAGE_FAILURE_REASONS.permission,
				false,
			);
		default:
			return undefined;
	}
}

function isInside(root: string | undefined, path: unknown): boolean {
	if (!root || typeof path !== 'string') return false;
	const below = relative(resolve(root), resolve(path));
	return below !== '..' && !below.startsWith(`..${sep}`) && !isAbsolute(below);
}
