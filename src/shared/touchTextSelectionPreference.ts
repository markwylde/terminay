/**
 * Per-device touch text selection preference.
 *
 * Whether a long press over the terminal selects text is a property of the
 * device you are touching, not of the workspace every device shares. A phone
 * and a desktop attached to the same session disagree about it by nature, so
 * this never travels over the wire and never reaches host settings.
 *
 * Persistence is best-effort in the same way as the rest of this origin's
 * per-device state: storage that is unavailable, full, or disabled means the
 * device falls back to the default rather than failing.
 */

const STORAGE_KEY = 'terminay.input.touch-text-selection.v1';

/**
 * On by default. The gesture it enables is a one-second stationary hold, which
 * otherwise does nothing at all, so enabling it costs no existing behaviour.
 */
const DEFAULT_ENABLED = true;

export const TOUCH_TEXT_SELECTION_CHANGED_EVENT =
	'terminay-touch-text-selection-changed';

export function isTouchTextSelectionEnabled(): boolean {
	try {
		const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (raw === null || raw === undefined) return DEFAULT_ENABLED;
		return raw !== 'off';
	} catch {
		return DEFAULT_ENABLED;
	}
}

export function setTouchTextSelectionEnabled(enabled: boolean): void {
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
	} catch {
		/* A device that cannot remember still honours the choice for this run. */
	}
	globalThis.dispatchEvent?.(
		new CustomEvent(TOUCH_TEXT_SELECTION_CHANGED_EVENT, {
			detail: { enabled },
		}),
	);
}

/** Subscribes to changes made anywhere in this document. */
export function subscribeTouchTextSelectionEnabled(
	listener: (enabled: boolean) => void,
): () => void {
	const handle = () => listener(isTouchTextSelectionEnabled());
	globalThis.addEventListener?.(TOUCH_TEXT_SELECTION_CHANGED_EVENT, handle);
	return () => {
		globalThis.removeEventListener?.(
			TOUCH_TEXT_SELECTION_CHANGED_EVENT,
			handle,
		);
	};
}
