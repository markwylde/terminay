/**
 * Opens something once the pointer or the focus has rested for a while, and
 * closes it the moment that rest ends.
 *
 * `rest` starts the wait; a second `rest` while waiting or open changes
 * nothing. `end` cancels a wait that has not run out and closes what one that
 * has opened. The timer is one per rest, never a repeating one.
 */

export type HoverDelayTimers = {
	set: (run: () => void, delayMs: number) => unknown;
	clear: (handle: unknown) => void;
};

export type HoverDelay = {
	rest: () => void;
	end: () => void;
};

const DEFAULT_TIMERS: HoverDelayTimers = {
	set: (run, delayMs) => setTimeout(run, delayMs),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createHoverDelay(
	delayMs: number,
	onOpen: () => void,
	onClose: () => void,
	timers: HoverDelayTimers = DEFAULT_TIMERS,
): HoverDelay {
	let pending: unknown;
	let isWaiting = false;
	let isOpen = false;
	return {
		rest() {
			if (isWaiting || isOpen) return;
			isWaiting = true;
			pending = timers.set(() => {
				isWaiting = false;
				isOpen = true;
				onOpen();
			}, delayMs);
		},
		end() {
			if (isWaiting) {
				isWaiting = false;
				timers.clear(pending);
			}
			if (!isOpen) return;
			isOpen = false;
			onClose();
		},
	};
}
