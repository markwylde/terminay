/**
 * Document-local broadcast of the status bar's visibility.
 *
 * The setting itself is the device-local `showStatusBar` terminal setting,
 * owned by the workspace. Surfaces outside the workspace — the browser host's
 * in-page View menu — only need to reflect it, so the workspace publishes the
 * current value here and they subscribe. Nothing here persists anything.
 */

export const STATUS_BAR_VISIBILITY_CHANGED_EVENT =
	'terminay-status-bar-visibility-changed';

let lastPublished = true;

export function publishStatusBarVisibility(visible: boolean): void {
	lastPublished = visible;
	globalThis.dispatchEvent?.(
		new CustomEvent(STATUS_BAR_VISIBILITY_CHANGED_EVENT, {
			detail: { visible },
		}),
	);
}

export function currentStatusBarVisibility(): boolean {
	return lastPublished;
}

export function subscribeStatusBarVisibility(
	listener: (visible: boolean) => void,
): () => void {
	const handle = (event: Event) => {
		const visible = (event as CustomEvent<{ visible?: unknown }>).detail
			?.visible;
		if (typeof visible === 'boolean') listener(visible);
	};
	globalThis.addEventListener?.(STATUS_BAR_VISIBILITY_CHANGED_EVENT, handle);
	return () => {
		globalThis.removeEventListener?.(
			STATUS_BAR_VISIBILITY_CHANGED_EVENT,
			handle,
		);
	};
}
