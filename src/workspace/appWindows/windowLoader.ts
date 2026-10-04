/**
 * Keeps one server's list of app windows current.
 *
 * The list is refetched whenever the server says something changed. A fetch
 * that fails says nothing about the windows: the last list that was read stays
 * as it is, because publishing an empty one would tear down every running view
 * and lose its state for a hiccup.
 */

export interface WindowLoaderOptions<Window> {
	readonly list: () => Promise<readonly Window[]>;
	/** `loaded` is false until a list has been read from this server. */
	readonly publish: (windows: readonly Window[], loaded: boolean) => void;
}

export interface WindowLoader {
	/** Fetch the list now. Only the latest of overlapping fetches is published. */
	load(): Promise<void>;
	dispose(): void;
}

export function createWindowLoader<Window>(options: WindowLoaderOptions<Window>): WindowLoader {
	let disposed = false;
	let generation = 0;
	let loadedOnce = false;
	return {
		async load() {
			generation += 1;
			const requested = generation;
			try {
				const windows = await options.list();
				if (disposed || requested !== generation) return;
				loadedOnce = true;
				options.publish(windows, true);
			} catch {
				// Before the server has ever answered there is nothing to show.
				// After that, what was shown stays until a fetch succeeds.
				if (!disposed && requested === generation && !loadedOnce) options.publish([], false);
			}
		},
		dispose() {
			disposed = true;
		},
	};
}
