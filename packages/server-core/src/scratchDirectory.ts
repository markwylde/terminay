import { lstat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

/**
 * Where the server keeps fixed-name scratch files a terminal is handed a path
 * to: clipboard images, dropped files, window-message attachments.
 *
 * The system temporary directory is shared by every account on a POSIX host
 * (the standalone unit gives the server no private one, so that terminals
 * which outlive it keep a working `/tmp`). A fixed name directly under it
 * could be created, or replaced by a link, by anyone. So every such directory
 * lives under one root named for this account, made owner-only, and checked
 * before each use: a real directory, not a link, owned by this account, with
 * no group or other access. Windows' temporary directory is already the
 * user's own.
 */

export interface ScratchPlatform {
	readonly platform?: NodeJS.Platform;
	readonly uid?: number;
	readonly temporaryDirectory?: string;
}

function currentUid(): number | undefined {
	return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

/** The per-account scratch root: `<tmp>/terminay-<uid>`, or `<tmp>\terminay` on Windows. */
export function scratchRoot(options: ScratchPlatform = {}): string {
	const platform = options.platform ?? process.platform;
	const temporary = options.temporaryDirectory ?? tmpdir();
	if (platform === 'win32') return join(temporary, 'terminay');
	const uid = options.uid ?? currentUid();
	return join(temporary, uid === undefined ? 'terminay' : `terminay-${uid}`);
}

/** A named directory under the scratch root. */
export function scratchSubdirectory(
	name: string,
	options: ScratchPlatform = {},
): string {
	return join(scratchRoot(options), name);
}

export class UnsafeScratchDirectoryError extends Error {
	constructor(
		readonly directory: string,
		readonly reason: string,
	) {
		super(`the scratch directory ${directory} is not safe to use: ${reason}`);
		this.name = 'UnsafeScratchDirectoryError';
	}
}

async function ensureOne(
	directory: string,
	platform: NodeJS.Platform,
	uid: number | undefined,
): Promise<void> {
	try {
		// Not recursive: the parent has been checked already, and a recursive
		// mkdir would silently accept whatever is at this path.
		await mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
	}
	const stat = await lstat(directory);
	if (stat.isSymbolicLink())
		throw new UnsafeScratchDirectoryError(directory, 'it is a symbolic link');
	if (!stat.isDirectory())
		throw new UnsafeScratchDirectoryError(directory, 'it is not a directory');
	if (platform === 'win32') return;
	if (uid !== undefined && stat.uid !== uid)
		throw new UnsafeScratchDirectoryError(
			directory,
			'it belongs to another account',
		);
	if ((stat.mode & 0o077) !== 0)
		throw new UnsafeScratchDirectoryError(
			directory,
			'other accounts can reach it',
		);
}

/**
 * Make `directory` if it is missing and refuse it unless it is safe. When it
 * lies under the scratch root, the root and every directory between are made
 * and checked too, from the top down. Any other directory (a test's, or one an
 * operator configured) is checked on its own, after its parents are made.
 */
export async function ensureScratchDirectory(
	directory: string,
	options: ScratchPlatform = {},
): Promise<void> {
	const platform = options.platform ?? process.platform;
	const uid = options.uid ?? currentUid();
	const root = scratchRoot(options);
	const below = relative(root, directory);
	const underRoot =
		below === '' || (!below.startsWith('..') && !isAbsolute(below));
	if (!underRoot) {
		await mkdir(dirname(directory), { recursive: true });
		await ensureOne(directory, platform, uid);
		return;
	}
	await ensureOne(root, platform, uid);
	let current = root;
	for (const part of below.split(sep).filter((segment) => segment.length > 0)) {
		current = join(current, part);
		await ensureOne(current, platform, uid);
	}
}
