/**
 * Live xterm surfaces attach the WebGL renderer so box-drawing and block
 * glyphs fill the cell. This policy stays transport-neutral: callers supply
 * the addon factory, and a failed or lost GPU context must fall back to the
 * DOM renderer rather than leave a blank terminal.
 */

export type TerminalWebglAddonLike = {
	activate(terminal: unknown): void;
	dispose(): void;
	onContextLoss(listener: () => void): { dispose(): void } | undefined;
};

export type AttachTerminalWebglRendererResult = {
	readonly attached: boolean;
	readonly dispose: () => void;
};

/**
 * Load the GPU renderer after xterm has opened. Construction and context-loss
 * failures dispose the addon so xterm keeps its default DOM renderer.
 */
export function attachTerminalWebglRenderer(
	terminal: {
		loadAddon(addon: {
			activate(terminal: unknown): void;
			dispose(): void;
		}): void;
	},
	createAddon: () => TerminalWebglAddonLike,
): AttachTerminalWebglRendererResult {
	let addon: TerminalWebglAddonLike | undefined;
	let contextLossSubscription: { dispose(): void } | undefined;
	let disposed = false;

	const dispose = () => {
		if (disposed) return;
		disposed = true;
		const subscription = contextLossSubscription;
		contextLossSubscription = undefined;
		const current = addon;
		addon = undefined;
		try {
			subscription?.dispose();
		} catch {
			// A failed listener teardown cannot block the DOM fallback.
		}
		try {
			current?.dispose();
		} catch {
			// A failed GPU dispose cannot block the DOM fallback.
		}
	};

	try {
		addon = createAddon();
		terminal.loadAddon(addon);
		const subscription = addon.onContextLoss(() => {
			dispose();
		});
		if (subscription && typeof subscription.dispose === 'function') {
			contextLossSubscription = subscription;
		}
		return { attached: true, dispose };
	} catch {
		dispose();
		return { attached: false, dispose: () => {} };
	}
}
