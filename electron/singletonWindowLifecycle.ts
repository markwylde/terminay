export interface SingletonWindowLifecycleTarget {
	on(event: 'close' | 'closed', listener: () => void): unknown;
	isDestroyed?(): boolean;
	readonly webContents: {
		on(event: 'destroyed', listener: () => void): unknown;
	};
}

/** Clear a singleton at the earliest close signal without letting a delayed
 * event from an old window clear its replacement. */
export function bindSingletonWindowLifecycle<T extends SingletonWindowLifecycleTarget>(
	created: T,
	getCurrent: () => T | null,
	setCurrent: (value: T | null) => void,
): () => void {
	const clear = () => {
		if (getCurrent() === created) setCurrent(null);
	};
	created.on('close', clear);
	created.on('closed', clear);
	created.webContents.on('destroyed', clear);
	return clear;
}

/** Publish a barrier as soon as native close begins and release it only after
 * BrowserWindow reports the native window fully closed. */
export function bindNativeWindowCloseBarrier(
	created: SingletonWindowLifecycleTarget,
	setBarrier: (barrier: Promise<void>) => void,
): void {
	let resolveNativeClose: (() => void) | null = null;
	let destructionRelease: ReturnType<typeof setTimeout> | null = null;
	let boundedRelease: ReturnType<typeof setTimeout> | null = null;
	const beginBarrier = () => {
		if (resolveNativeClose !== null) {
			return;
		}
		setBarrier(
			new Promise<void>((resolve) => {
				resolveNativeClose = () => {
					if (destructionRelease !== null) clearTimeout(destructionRelease);
					if (boundedRelease !== null) clearTimeout(boundedRelease);
					destructionRelease = null;
					boundedRelease = null;
					resolve();
				};
			}),
		);
		// Native `closed` is not guaranteed after Playwright closes only the
		// renderer page. Never orphan every future settings-open invocation.
		boundedRelease = setTimeout(() => resolveNativeClose?.(), 250);
	};
	created.on('close', beginBarrier);
	created.on('closed', () => {
		resolveNativeClose?.();
		resolveNativeClose = null;
	});
	created.webContents.on('destroyed', () => {
		beginBarrier();
		// WebContents destruction is authoritative for the renderer and occurs
		// immediately before/with native teardown. Cross one task boundary so a
		// replacement BrowserWindow cannot overlap that destruction turn.
		destructionRelease = setTimeout(() => {
			resolveNativeClose?.();
			resolveNativeClose = null;
		}, 0);
	});
}
