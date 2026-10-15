import { readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse } from 'node:path';
import {
	type BrowseRootFoldersResult,
	MAX_BROWSE_ROOT_FOLDER_ENTRIES,
	PROJECT_START_REFUSALS,
	type ProjectStartRefusal,
	type ProtocolError,
	protocolError,
} from '@terminay/protocol';

/**
 * The server's own filesystem, read to choose a project root (ADR-0066).
 *
 * It is the one filesystem read that no project root contains, so it returns
 * the names of directories and nothing else, and it canonicalizes the folder
 * it is asked for on every request: a path it listed is never trusted later.
 */
export interface RootFolderStorage {
	readonly realpath: (path: string) => Promise<string>;
	readonly stat: (path: string) => Promise<{ readonly isDirectory: boolean }>;
	readonly readDirectory: (path: string) => Promise<
		readonly {
			readonly name: string;
			readonly isDirectory: boolean;
			readonly isSymbolicLink: boolean;
		}[]
	>;
}

export const nodeRootFolderStorage: RootFolderStorage = Object.freeze({
	realpath: (path: string) => realpath(path),
	stat: async (path: string) => ({
		isDirectory: (await stat(path)).isDirectory(),
	}),
	readDirectory: async (path: string) =>
		(await readdir(path, { withFileTypes: true })).map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
			isSymbolicLink: entry.isSymbolicLink(),
		})),
});

/** A folder that cannot be used as, or browsed for, a project root. */
export class RootFolderError extends Error {
	readonly reason: ProjectStartRefusal;
	constructor(reason: ProjectStartRefusal, message: string) {
		super(message);
		this.name = 'RootFolderError';
		this.reason = reason;
	}

	toProtocolError(): ProtocolError {
		const details = { reason: this.reason };
		switch (this.reason) {
			case PROJECT_START_REFUSALS.pathMissing:
				return protocolError('not_found', this.message, { details });
			case PROJECT_START_REFUSALS.unreadable:
				return protocolError('forbidden', this.message, { details });
			default:
				return protocolError('validation', this.message, { details });
		}
	}
}

export interface RootFolderBrowserOptions {
	readonly storage?: RootFolderStorage;
	/** The server account's verified home directory. */
	readonly homeDirectory: () => Promise<string | null>;
	readonly maxEntries?: number;
}

export class RootFolderBrowser {
	private readonly storage: RootFolderStorage;
	private readonly maxEntries: number;

	constructor(private readonly options: RootFolderBrowserOptions) {
		this.storage = options.storage ?? nodeRootFolderStorage;
		this.maxEntries = options.maxEntries ?? MAX_BROWSE_ROOT_FOLDER_ENTRIES;
		if (
			!Number.isSafeInteger(this.maxEntries) ||
			this.maxEntries <= 0 ||
			this.maxEntries > MAX_BROWSE_ROOT_FOLDER_ENTRIES
		)
			throw new RangeError('maxEntries is invalid');
	}

	/** The server account's home, canonical. */
	async home(): Promise<string> {
		const home = await this.options.homeDirectory();
		if (home === null)
			throw new RootFolderError(
				PROJECT_START_REFUSALS.pathMissing,
				'The server home folder is unavailable.',
			);
		return this.canonicalDirectory(home);
	}

	/**
	 * Canonicalize a folder named by a client: an absolute path, or `~` and a
	 * path under it. It must exist as a directory now.
	 */
	async canonicalDirectory(requested: string): Promise<string> {
		const path = await this.expand(requested);
		let canonical: string;
		try {
			canonical = await this.storage.realpath(path);
		} catch (error) {
			throw fromFilesystemError(error);
		}
		let directory: boolean;
		try {
			directory = (await this.storage.stat(canonical)).isDirectory;
		} catch (error) {
			throw fromFilesystemError(error);
		}
		if (!directory)
			throw new RootFolderError(
				PROJECT_START_REFUSALS.notDirectory,
				'The folder is not a directory.',
			);
		return canonical;
	}

	/** The directory names of one folder, the home folder when none is named. */
	async browse(requested?: string): Promise<BrowseRootFoldersResult> {
		const path =
			requested === undefined
				? await this.home()
				: await this.canonicalDirectory(requested);
		let listing: Awaited<ReturnType<RootFolderStorage['readDirectory']>>;
		try {
			listing = await this.storage.readDirectory(path);
		} catch (error) {
			throw fromFilesystemError(error);
		}
		const names: string[] = [];
		let truncated = false;
		for (const entry of [...listing].sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		)) {
			if (!validEntryName(entry.name)) continue;
			if (!(await this.isDirectoryEntry(path, entry))) continue;
			if (names.length >= this.maxEntries) {
				truncated = true;
				break;
			}
			names.push(entry.name);
		}
		const parent = dirname(path);
		return {
			path,
			...(parent === path || parse(path).root === path ? {} : { parent }),
			entries: names.map((name) => ({ name })),
			truncated,
		};
	}

	/** Whether a recent folder exists as a directory now. One stat, no walk. */
	async isAvailable(path: string): Promise<boolean> {
		try {
			return (await this.storage.stat(path)).isDirectory;
		} catch {
			return false;
		}
	}

	private async isDirectoryEntry(
		folder: string,
		entry: {
			readonly isDirectory: boolean;
			readonly isSymbolicLink: boolean;
			readonly name: string;
		},
	): Promise<boolean> {
		if (entry.isDirectory) return true;
		// A link to a directory can be entered and chosen; whether it is one
		// costs one stat, and only links pay it.
		if (!entry.isSymbolicLink) return false;
		try {
			return (await this.storage.stat(join(folder, entry.name))).isDirectory;
		} catch {
			return false;
		}
	}

	private async expand(requested: string): Promise<string> {
		if (
			typeof requested !== 'string' ||
			requested.length === 0 ||
			requested.length > 4096 ||
			requested.includes('\0')
		)
			throw new RootFolderError(
				PROJECT_START_REFUSALS.invalidPath,
				'The folder path is invalid.',
			);
		if (requested === '~' || requested.startsWith('~/')) {
			const home = await this.options.homeDirectory();
			if (home === null)
				throw new RootFolderError(
					PROJECT_START_REFUSALS.pathMissing,
					'The server home folder is unavailable.',
				);
			return requested === '~' ? home : join(home, requested.slice(2));
		}
		if (!isAbsolute(requested))
			throw new RootFolderError(
				PROJECT_START_REFUSALS.invalidPath,
				'The folder path must be absolute.',
			);
		return requested;
	}
}

function validEntryName(name: string): boolean {
	return (
		typeof name === 'string' &&
		name.length > 0 &&
		name.length <= 1024 &&
		name !== '.' &&
		name !== '..' &&
		!name.includes('\0') &&
		!name.includes('/')
	);
}

function fromFilesystemError(error: unknown): RootFolderError {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? (error as { readonly code?: unknown }).code
			: undefined;
	if (code === 'ENOENT')
		return new RootFolderError(
			PROJECT_START_REFUSALS.pathMissing,
			'The folder does not exist.',
		);
	if (code === 'ENOTDIR')
		return new RootFolderError(
			PROJECT_START_REFUSALS.notDirectory,
			'The folder is not a directory.',
		);
	if (code === 'EACCES' || code === 'EPERM')
		return new RootFolderError(
			PROJECT_START_REFUSALS.unreadable,
			'The folder cannot be read by the server account.',
		);
	return new RootFolderError(
		PROJECT_START_REFUSALS.unreadable,
		'The folder could not be read.',
	);
}
