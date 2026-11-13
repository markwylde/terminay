import { type FSWatcher, watch } from 'node:fs';
import {
	createTreeWatch,
	type TreeWatchFs,
	type TreeWatchLimits,
} from './treeWatch.js';
import type {
	GitStateWatcher,
	GitWatchHandle,
	GitWatchOptions,
} from './types.js';

export interface NodeGitStateWatcherOptions {
	/** The host platform; tests inject `linux` to run the built-up watch anywhere. */
	readonly platform?: NodeJS.Platform;
	/** Filesystem and limits for the built-up watch, for tests. */
	readonly treeWatch?: {
		readonly fs?: TreeWatchFs;
		readonly limits?: Partial<TreeWatchLimits>;
	};
}

/**
 * `fs.watch` for the Git service. Recursive watches use FSEvents on macOS and
 * ReadDirectoryChangesW on Windows. On Linux, where Node emulates recursion by
 * re-walking trees synchronously on the event loop, a recursive watch is built
 * from per-directory watches that skip what `filterDirectories` excludes
 * (ADR-0113). Any failure surfaces as `onError`, never as a silent gap.
 */
export class NodeGitStateWatcher implements GitStateWatcher {
	readonly #buildsRecursiveWatches: boolean;
	readonly #treeWatch: NodeGitStateWatcherOptions['treeWatch'];

	constructor(options: NodeGitStateWatcherOptions = {}) {
		this.#buildsRecursiveWatches =
			(options.platform ?? process.platform) === 'linux';
		this.#treeWatch = options.treeWatch;
	}

	/** Whether recursive watches are built from per-directory watches here. */
	get buildsRecursiveWatches(): boolean {
		return this.#buildsRecursiveWatches;
	}

	watch(path: string, options: GitWatchOptions): GitWatchHandle {
		if (options.recursive && this.#buildsRecursiveWatches)
			return createTreeWatch(path, options, this.#treeWatch);
		let watcher: FSWatcher | undefined;
		let closed = false;
		let failed = false;
		const fail = (error: unknown) => {
			if (closed || failed) return;
			failed = true;
			options.onError(error);
		};
		try {
			watcher = watch(
				path,
				{ persistent: false, recursive: options.recursive },
				(_event, filename) => {
					if (closed) return;
					options.onChange(filename === null ? null : String(filename));
				},
			);
			watcher.on('error', fail);
			// A watch closed by anything other than us has stopped observing.
			watcher.on('close', () => fail(new Error('watch closed')));
		} catch (error) {
			// Report asynchronously so callers never re-enter from inside `watch`.
			queueMicrotask(() => fail(error));
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
