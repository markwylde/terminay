/**
 * Rate limit for Git status refreshes.
 *
 * A trailing debounce bounds latency, not frequency: it re-fires for every
 * event spaced wider than its delay, so a steady trickle of filesystem
 * activity sustains refreshes at the debounce frequency however expensive each
 * one is. A 120 ms debounce in front of a refresh that spawns `git status`
 * (0.28 s on a ten-thousand-file tree) therefore free-ran at roughly 8 Hz.
 *
 * This schedules on a minimum interval instead. The first request after a
 * quiet period runs promptly — that is the case a user is actually watching,
 * having just saved a file — and further requests collapse into exactly one
 * run at the end of the interval, so nothing is dropped and the rate is
 * bounded no matter how the events arrive.
 */
export interface RefreshScheduleOptions {
	/** Never run more often than this. Set above the cost of one run so runs
	 *  cannot queue behind one another. */
	readonly minIntervalMs: number;
	readonly run: () => void;
	readonly now?: () => number;
	readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimer?: (timer: unknown) => void;
}

export interface RefreshSchedule {
	/** Ask for a refresh. Runs now, or folds into the pending run. */
	request(): void;
	/** Drop any pending run. */
	cancel(): void;
}

export function createRefreshSchedule(
	options: RefreshScheduleOptions,
): RefreshSchedule {
	const { minIntervalMs } = options;
	if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0)
		throw new RangeError('minIntervalMs must be a non-negative finite number');

	const now = options.now ?? (() => Date.now());
	const setTimer =
		options.setTimer ??
		((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
	const clearTimer =
		options.clearTimer ??
		((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));

	let lastRunAt: number | undefined;
	let timer: unknown;

	const run = (): void => {
		lastRunAt = now();
		options.run();
	};

	return {
		request(): void {
			// A run is already pending; this request is covered by it. That is what
			// makes a burst cost one refresh rather than one per event.
			if (timer !== undefined) return;
			const elapsed = lastRunAt === undefined ? Number.POSITIVE_INFINITY : now() - lastRunAt;
			if (elapsed >= minIntervalMs) {
				run();
				return;
			}
			timer = setTimer(() => {
				timer = undefined;
				run();
			}, minIntervalMs - elapsed);
		},
		cancel(): void {
			if (timer === undefined) return;
			clearTimer(timer);
			timer = undefined;
		},
	};
}
