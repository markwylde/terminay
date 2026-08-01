export interface AuxiliaryWindowLifecycleTarget {
	on(event: 'closed', listener: () => void): unknown;
	readonly webContents: {
		on(event: 'destroyed' | 'render-process-gone', listener: () => void): unknown;
	};
	isDestroyed(): boolean;
	destroy(): void;
}

/**
 * Bind the terminal lifecycle of a renderer-backed auxiliary window.
 *
 * BrowserWindow `close` is deliberately excluded because it is cancelable.
 * Once the native window or its renderer is terminal, the pending host request
 * is settled exactly once. Renderer failure also destroys any surviving native
 * shell so it cannot remain as an unusable modal.
 */
export function bindAuxiliaryWindowLifecycle(
	window: AuxiliaryWindowLifecycleTarget,
	settle: () => void,
): { observeLoad(load: Promise<unknown>): void } {
	let terminal = false;

	const finish = (destroy: boolean): void => {
		if (terminal) return;
		terminal = true;
		settle();
		if (destroy && !window.isDestroyed()) window.destroy();
	};

	window.on('closed', () => finish(false));
	window.webContents.on('destroyed', () => finish(false));
	window.webContents.on('render-process-gone', () => finish(true));

	return {
		observeLoad(load: Promise<unknown>): void {
			void load.catch(() => finish(true));
		},
	};
}
