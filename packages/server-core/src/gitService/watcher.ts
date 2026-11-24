import { type FSWatcher, watch as nodeWatch } from 'node:fs';
import { lstat as nodeLstat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
	createTreeWatch,
	type TreeWatchFs,
	type TreeWatchLimits,
	WatchedRootGoneError,
} from './treeWatch.js';
import type {
	GitStateWatcher,
	GitWatchHandle,
	GitWatchOptions,
} from './types.js';

export { isWatchedRootGone, WatchedRootGoneError } from './treeWatch.js';

/** The host calls a native (kernel) watch makes, for tests. */
export interface NativeWatchFs {
	watch(
		path: string,
		options: { persistent: boolean; recursive: boolean },
		listener: (event: string, filename: string | Buffer | null) => void,
	): FSWatcher;
	lstat(path: string): Promise<RootIdentityStat>;
}

interface RootIdentityStat {
	isDirectory(): boolean;
	readonly dev: number;
	readonly ino: number;
	readonly birthtimeMs?: number;
}

export interface NodeGitStateWatcherOptions {
	/** The host platform; tests inject `linux` to run the built-up watch anywhere. */
	readonly platform?: NodeJS.Platform;
	/** Filesystem and limits for the built-up watch, for tests. */
	readonly treeWatch?: {
		readonly fs?: TreeWatchFs;
		readonly limits?: Partial<TreeWatchLimits>;
	};
	/** Host calls for native watches, for tests. */
	readonly nativeFs?: NativeWatchFs;
}

const NODE_NATIVE_FS: NativeWatchFs = {
	watch: (path, options, listener) =>
		nodeWatch(path, options, (event, filename) => listener(event, filename)),
	lstat: (path) => nodeLstat(path),
};

function isCode(error: unknown, ...codes: string[]): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		codes.includes(String((error as { code?: unknown }).code))
	);
}

function sameRoot(
	stat: RootIdentityStat,
	identity: RootIdentityStat,
): boolean {
	return (
		stat.isDirectory() &&
		stat.dev === identity.dev &&
		stat.ino === identity.ino &&
		(stat.birthtimeMs ?? 0) === (identity.birthtimeMs ?? 0)
	);
}

/**
 * `fs.watch` for the Git service. Recursive watches use FSEvents on macOS and
 * ReadDirectoryChangesW on Windows. On Linux, where Node emulates recursion by
 * re-walking trees synchronously on the event loop, a recursive watch is built
 * from per-directory watches that skip what `filterDirectories` excludes
 * (ADR-0114). Any failure surfaces as `onError`, never as a silent gap; a root
 * that went away surfaces as `WatchedRootGoneError` (ADR-0141).
 */
export class NodeGitStateWatcher implements GitStateWatcher {
	readonly #buildsRecursiveWatches: boolean;
	readonly #treeWatch: NodeGitStateWatcherOptions['treeWatch'];
	readonly #fs: NativeWatchFs;

	constructor(options: NodeGitStateWatcherOptions = {}) {
		this.#buildsRecursiveWatches =
			(options.platform ?? process.platform) === 'linux';
		this.#treeWatch = options.treeWatch;
		this.#fs = options.nativeFs ?? NODE_NATIVE_FS;
	}

	/** Whether recursive watches are built from per-directory watches here. */
	get buildsRecursiveWatches(): boolean {
		return this.#buildsRecursiveWatches;
	}

	watch(path: string, options: GitWatchOptions): GitWatchHandle {
		if (options.recursive && this.#buildsRecursiveWatches)
			return createTreeWatch(path, options, this.#treeWatch);
		return this.#nativeWatch(path, options);
	}

	#nativeWatch(path: string, options: GitWatchOptions): GitWatchHandle {
		const fs = this.#fs;
		const rootName = basename(path);
		let watcher: FSWatcher | undefined;
		let closed = false;
		let failed = false;
		/** The root as it was when the watch opened; null until known. */
		let identity: RootIdentityStat | null = null;
		const identityKnown = fs.lstat(path).then(
			(stat) => {
				identity = stat;
			},
			() => undefined,
		);
		const fail = (error: unknown) => {
			if (closed || failed) return;
			failed = true;
			watcher?.close();
			options.onError(error);
		};
		/**
		 * Something about the root itself was reported. Whether it is still the
		 * directory we opened decides what it was: gone or replaced is the root
		 * going away; still there is `otherwise`.
		 */
		const checkRoot = (otherwise: () => void, original?: unknown) => {
			void identityKnown
				.then(() => fs.lstat(path))
				.then(
					(stat) => {
						if (closed || failed) return;
						if (identity !== null && !sameRoot(stat, identity))
							fail(new WatchedRootGoneError('the watched path was replaced'));
						else otherwise();
					},
					(error: unknown) => {
						if (closed || failed) return;
						if (isCode(error, 'ENOENT', 'ENOTDIR'))
							fail(new WatchedRootGoneError(undefined, { cause: error }));
						else fail(original ?? error);
					},
				);
		};
		try {
			watcher = fs.watch(
				path,
				{ persistent: false, recursive: options.recursive },
				(event, filename) => {
					if (closed || failed) return;
					const name = filename === null ? null : String(filename);
					// A rename that names the root, or nothing, may be the root
					// itself going away; anything else is an ordinary change.
					if (event === 'rename' && (name === null || name === rootName)) {
						checkRoot(() => options.onChange(name), undefined);
						return;
					}
					options.onChange(name);
				},
			);
			watcher.on('error', (error) =>
				checkRoot(() => fail(error), error),
			);
			// A watch closed by anything other than us has stopped observing.
			watcher.on('close', () => {
				if (closed) return;
				const stopped = new Error('watch closed');
				checkRoot(() => fail(stopped), stopped);
			});
			queueMicrotask(() => {
				if (!closed && !failed) options.onReady?.();
			});
		} catch (error) {
			// Report asynchronously so callers never re-enter from inside `watch`.
			queueMicrotask(() => {
				if (closed || failed) return;
				if (isCode(error, 'ENOENT', 'ENOTDIR'))
					fail(
						new WatchedRootGoneError(
							'the watched path was gone before it could be watched',
							{ cause: error },
						),
					);
				else fail(error);
			});
		}
		return {
			close() {
				if (closed) return;
				closed = true;
				watcher?.close();
			},
		};
	}
}
