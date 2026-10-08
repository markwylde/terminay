import { createHash } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
	SESSION_HOLDER_MAX_SOCKET_PATH_BYTES,
	socketPathFits,
} from '@terminay/server-core';

/**
 * Where the local control endpoint's socket goes (ADR-0054).
 *
 * A Unix socket's path is capped near 104 bytes, so a data directory at a long
 * path cannot hold one. The socket stays in the data directory whenever it
 * fits. When it does not, it goes in a runtime directory named for the data
 * directory, so the same data directory always has the same address: a
 * terminal that outlives the server was handed that address when it started.
 */

/** The socket's name inside a data directory. */
export const CONTROL_SOCKET_FILENAME = 'terminay-mcp-control.sock';
/** The socket's name inside a runtime directory, which holds nothing else. */
export const CONTROL_SOCKET_RUNTIME_FILENAME = 'control.sock';
export const CONTROL_SOCKET_WINDOWS_PIPE = '\\\\.\\pipe\\terminay-control';
/** One limit for every local socket: the one the session holder defines. */
export const CONTROL_SOCKET_MAX_PATH_BYTES =
	SESSION_HOLDER_MAX_SOCKET_PATH_BYTES;

export type ControlSocketPlacement =
	| { readonly location: 'named-pipe'; readonly path: string }
	| { readonly location: 'data-directory'; readonly path: string }
	| {
			readonly location: 'runtime-directory';
			readonly path: string;
			/** The directory that holds the socket and nothing else. */
			readonly directory: string;
	  };

export interface ControlSocketPlacementOptions {
	readonly dataDirectory: string;
	readonly platform: string;
	/** The system temporary directory, `os.tmpdir()`. */
	readonly temporaryDirectory: string;
	/** The user's runtime directory, `XDG_RUNTIME_DIR`, where there is one. */
	readonly runtimeDirectory?: string;
}

/** What was tried, for a message a person can act on. Never a token. */
export interface ControlSocketPlacementFailure {
	readonly dataDirectory: string;
	readonly socketPath: string;
	readonly socketPathBytes: number;
	readonly limitBytes: number;
	readonly runtimeDirectory: string;
	readonly runtimeSocketPathBytes: number;
	/** Why the runtime directory was not used, when its path was short enough. */
	readonly refusal?: string;
}

export class ControlSocketPlacementError extends Error {
	readonly failure: ControlSocketPlacementFailure;

	constructor(failure: ControlSocketPlacementFailure) {
		super(describeControlSocketPlacementFailure(failure));
		this.name = 'ControlSocketPlacementError';
		this.failure = failure;
	}
}

/** The runtime directory for a data directory: the same one every time. */
export function controlSocketRuntimeDirectory(
	options: Pick<
		ControlSocketPlacementOptions,
		'dataDirectory' | 'temporaryDirectory' | 'runtimeDirectory'
	>,
): string {
	const base =
		options.runtimeDirectory !== undefined &&
		isAbsolute(options.runtimeDirectory)
			? options.runtimeDirectory
			: options.temporaryDirectory;
	const name = createHash('sha256')
		.update(resolve(options.dataDirectory))
		.digest('hex')
		.slice(0, 12);
	return join(base, `terminay-${name}`);
}

/**
 * Decide where the socket goes. Reads nothing from disk: whether a runtime
 * directory may be used is `prepareControlSocketRuntimeDirectory`'s to say.
 */
export function resolveControlSocketPlacement(
	options: ControlSocketPlacementOptions,
): ControlSocketPlacement {
	if (options.platform === 'win32')
		return { location: 'named-pipe', path: CONTROL_SOCKET_WINDOWS_PIPE };
	const socketPath = join(options.dataDirectory, CONTROL_SOCKET_FILENAME);
	if (socketPathFits(socketPath))
		return { location: 'data-directory', path: socketPath };
	const directory = controlSocketRuntimeDirectory(options);
	const runtimeSocketPath = join(directory, CONTROL_SOCKET_RUNTIME_FILENAME);
	if (socketPathFits(runtimeSocketPath))
		return {
			location: 'runtime-directory',
			path: runtimeSocketPath,
			directory,
		};
	throw new ControlSocketPlacementError(
		placementFailure(options.dataDirectory, directory),
	);
}

function placementFailure(
	dataDirectory: string,
	runtimeDirectory: string,
	refusal?: string,
): ControlSocketPlacementFailure {
	const socketPath = join(dataDirectory, CONTROL_SOCKET_FILENAME);
	return {
		dataDirectory,
		socketPath,
		socketPathBytes: Buffer.byteLength(socketPath),
		limitBytes: CONTROL_SOCKET_MAX_PATH_BYTES,
		runtimeDirectory,
		runtimeSocketPathBytes: Buffer.byteLength(
			join(runtimeDirectory, CONTROL_SOCKET_RUNTIME_FILENAME),
		),
		...(refusal === undefined ? {} : { refusal }),
	};
}

/**
 * Make a runtime directory fit to hold the socket, or say why it is not.
 *
 * Its name can be worked out by anyone, so in a shared temporary directory
 * another user could have made it first. It is used only if it is a directory,
 * not a link to one, owned by this user, and closed to everyone else. One that
 * is absent is created that way. One that fails is left exactly as it was
 * found: a directory that was open may already hold something that is not
 * ours, and tightening it would hide that.
 */
export async function prepareControlSocketRuntimeDirectory(
	directory: string,
	options: { readonly userId?: number } = {},
): Promise<
	{ readonly ok: true } | { readonly ok: false; readonly reason: string }
> {
	const userId = options.userId ?? process.getuid?.();
	try {
		await mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
			return {
				ok: false,
				reason: `it could not be created (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`,
			};
	}
	let stat: Awaited<ReturnType<typeof lstat>>;
	try {
		stat = await lstat(directory);
	} catch (error) {
		return {
			ok: false,
			reason: `it could not be read (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`,
		};
	}
	if (stat.isSymbolicLink())
		return { ok: false, reason: 'it is a symbolic link' };
	if (!stat.isDirectory())
		return { ok: false, reason: 'it is not a directory' };
	if (userId !== undefined && stat.uid !== userId)
		return { ok: false, reason: 'it is not owned by the current user' };
	if ((stat.mode & 0o077) !== 0)
		return { ok: false, reason: 'other users can access it' };
	return { ok: true };
}

/**
 * Decide where the socket goes and, for a runtime directory, make sure it may
 * be used. Throws `ControlSocketPlacementError` when the socket has nowhere to
 * go.
 */
export async function placeControlSocket(
	options: ControlSocketPlacementOptions & { readonly userId?: number },
): Promise<ControlSocketPlacement> {
	const placement = resolveControlSocketPlacement(options);
	if (placement.location !== 'runtime-directory') return placement;
	const prepared = await prepareControlSocketRuntimeDirectory(
		placement.directory,
		options.userId === undefined ? {} : { userId: options.userId },
	);
	if (prepared.ok) return placement;
	throw new ControlSocketPlacementError(
		placementFailure(
			options.dataDirectory,
			placement.directory,
			prepared.reason,
		),
	);
}

/**
 * What to tell the person at the keyboard. The remedy comes before the paths,
 * which can be long.
 */
export function describeControlSocketPlacementFailure(
	failure: ControlSocketPlacementFailure,
): string {
	const fallback =
		failure.refusal === undefined
			? `The directory Terminay would use instead, ${failure.runtimeDirectory}, is also at a path too long (${failure.runtimeSocketPathBytes} bytes).`
			: `The directory Terminay would use instead, ${failure.runtimeDirectory}, cannot be used: ${failure.refusal}.`;
	return [
		"Terminay's data directory is at a path too long for a local socket.",
		`The socket's path would be ${failure.socketPathBytes} bytes and the limit is ${failure.limitBytes}.`,
		'Start Terminay with a shorter data directory.',
		`Data directory: ${failure.dataDirectory}.`,
		fallback,
	].join(' ');
}
