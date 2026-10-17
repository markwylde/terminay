import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
	loadGitTraceKey,
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
	'socketPath' | 'socketPlacement' | 'prepareSocket' | 'tokenKey'
> {
	const perRun = {
		socketPath: join(
			options.temporaryDirectory,
			`terminay-git-${createHash('sha256').update(options.serverId).digest('hex').slice(0, 12)}-${randomBytes(4).toString('hex')}.sock`,
		),
		socketPlacement: 'per-run' as const,
	};
	// Git's Trace2 socket target is a Unix socket, so a named pipe will not do.
	if (options.dataDirectory === undefined || options.platform === 'win32')
		return perRun;
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
