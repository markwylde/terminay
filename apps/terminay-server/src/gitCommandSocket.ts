import { createHash, randomBytes } from 'node:crypto';
import { join, win32 } from 'node:path';
import {
	currentWindowsUserSid,
	loadGitTraceKey,
	protectWindowsDirectory,
	type WorktreeCaptureHostOptions,
} from '@terminay/server-core';
import {
	GIT_COMMAND_SOCKET_FILENAMES,
	prepareControlSocketRuntimeDirectory,
	resolveControlSocketPlacement,
} from './mcp/controlSocketPlacement.js';

export interface GitCommandSocketOptions {
	/** The server's data directory. Absent, nothing outlives the run. */
	readonly dataDirectory?: string;
	readonly serverId: string;
	readonly platform: string;
	/** The system temporary directory, `os.tmpdir()`. */
	readonly temporaryDirectory: string;
	/** The user's runtime directory, `XDG_RUNTIME_DIR`, where there is one. */
	readonly runtimeDirectory?: string;
}

/**
 * Where Git in each terminal reports, and the key its tokens come from
 * (ADR-0069). A server with a data directory has one fixed address, placed as
 * ADR-0054 places every local socket, and one key, so a shell kept running
 * across a restart still reaches the server and is still recognised by it.
 */
export function gitCommandSocketHostOptions(
	options: GitCommandSocketOptions,
): Pick<
	WorktreeCaptureHostOptions,
	| 'socketPath'
	| 'traceDirectory'
	| 'socketPlacement'
	| 'prepareSocket'
	| 'tokenKey'
> {
	const perRun = {
		socketPath: join(
			options.temporaryDirectory,
			`terminay-git-${createHash('sha256').update(options.serverId).digest('hex').slice(0, 12)}-${randomBytes(4).toString('hex')}.sock`,
		),
		socketPlacement: 'per-run' as const,
	};
	if (options.platform === 'win32') return windowsHostOptions(options, perRun);
	if (options.dataDirectory === undefined) return perRun;
	let tokenKey: Buffer;
	try {
		tokenKey = loadGitTraceKey(options.dataDirectory);
	} catch {
		return perRun;
	}
	let placement: ReturnType<typeof resolveControlSocketPlacement>;
	try {
		placement = resolveControlSocketPlacement({
			dataDirectory: options.dataDirectory,
			fileNames: GIT_COMMAND_SOCKET_FILENAMES,
			platform: options.platform,
			temporaryDirectory: options.temporaryDirectory,
			...(options.runtimeDirectory === undefined
				? {}
				: { runtimeDirectory: options.runtimeDirectory }),
		});
	} catch {
		return perRun;
	}
	if (placement.location === 'runtime-directory') {
		const directory = placement.directory;
		return {
			socketPath: placement.path,
			socketPlacement: 'runtime-directory',
			tokenKey,
			// A directory that is not the user's own and closed to others is
			// never used: Git goes unreported rather than through it.
			prepareSocket: async () =>
				(await prepareControlSocketRuntimeDirectory(directory)).ok,
		};
	}
	return {
		socketPath: placement.path,
		socketPlacement: 'data-directory',
		tokenKey,
	};
}

/**
 * Node cannot serve a Unix socket on Windows, and Git for Windows has no
 * named-pipe target, so Git writes its events into a directory instead
 * (ADR-0079). With a data directory it has a fixed address there, so a shell
 * kept across a restart reports to the next run; without one it lasts a run.
 */
function windowsHostOptions(
	options: GitCommandSocketOptions,
	perRun: { readonly socketPath: string },
): Pick<
	WorktreeCaptureHostOptions,
	| 'socketPath'
	| 'traceDirectory'
	| 'prepareTraceDirectory'
	| 'socketPlacement'
	| 'tokenKey'
> {
	// Windows paths, whatever host computes them, so the choice is testable.
	const runDirectory = {
		socketPath: perRun.socketPath,
		traceDirectory: win32.join(
			options.temporaryDirectory,
			win32.basename(perRun.socketPath, '.sock'),
		),
		prepareTraceDirectory: protectTraceDirectory,
		socketPlacement: 'trace-directory' as const,
	};
	if (options.dataDirectory === undefined) return runDirectory;
	let tokenKey: Buffer;
	try {
		tokenKey = loadGitTraceKey(options.dataDirectory);
	} catch {
		return runDirectory;
	}
	return {
		socketPath: perRun.socketPath,
		traceDirectory: win32.join(options.dataDirectory, 'run', 'git-trace'),
		prepareTraceDirectory: protectTraceDirectory,
		socketPlacement: 'trace-directory',
		tokenKey,
	};
}

/** Only this user, SYSTEM and Administrators may write Git's events (ADR-0079). */
function protectTraceDirectory(path: string): boolean {
	const userSid = currentWindowsUserSid();
	return userSid !== null && protectWindowsDirectory(path, userSid);
}
