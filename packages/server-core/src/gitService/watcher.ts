import { type FSWatcher, watch } from 'node:fs';
import type {
	GitStateWatcher,
	GitWatchHandle,
	GitWatchOptions,
} from './types.js';

/**
 * `fs.watch` for the Git service. Recursive watches use FSEvents on macOS,
 * ReadDirectoryChangesW on Windows, and one inotify watch per directory on
 * Linux, where a large tree can exhaust `max_user_watches`; that surfaces as
 * `onError`, never as a silent gap.
 */
export class NodeGitStateWatcher implements GitStateWatcher {
	watch(path: string, options: GitWatchOptions): GitWatchHandle {
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
