/**
 * The shared ramp that damps work scheduled by an observed change (ADR-0028).
 * The server's Git watches and the UI's Git refreshes both run through it.
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
/**
 * The ramp, per ADR-0028 (carried forward from ADR-0022). Sustained change widens the gap between runs; a quiet
 * period drops back to the fastest step. Held at the last value rather than
 * growing without bound.
 */
export const REFRESH_RAMP_MS: readonly number[] = Object.freeze([
	1_000, 2_000, 3_000, 5_000, 10_000, 20_000,
]);

export interface RefreshScheduleOptions {
	/**
	 * Minimum time between runs, widening through this ramp while changes keep
	 * arriving and resetting after a quiet period. Defaults to
	 * `REFRESH_RAMP_MS`. A single value pins the interval.
	 *
	 * This is a floor between runs, not a delay after the last event: a trailing
	 * debounce re-fires for every event spaced wider than its delay, so it bounds
	 * latency rather than frequency.
	 */
	readonly rampMs?: readonly number[];
	/** Quiet time after which the ramp returns to its first step. Defaults to
	 *  twice the widest step. */
	readonly resetAfterMs?: number;
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
	const ramp = options.rampMs ?? REFRESH_RAMP_MS;
	if (ramp.length === 0) throw new RangeError('rampMs must not be empty');
	for (const step of ramp)
		if (!Number.isFinite(step) || step < 0)
			throw new RangeError(
				'every ramp step must be a non-negative finite number',
			);
	const resetAfterMs = options.resetAfterMs ?? ramp[ramp.length - 1] * 2;
	if (!Number.isFinite(resetAfterMs) || resetAfterMs < 0)
		throw new RangeError('resetAfterMs must be a non-negative finite number');

	const now = options.now ?? (() => Date.now());
	const setTimer =
		options.setTimer ??
		((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
	const clearTimer =
		options.clearTimer ??
		((timer) =>
			globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));

	let lastRunAt: number | undefined;
	let timer: unknown;
	let step = 0;

	const run = (): void => {
		lastRunAt = now();
		// Changes are still arriving, so widen for the next one. Held at the last
		// step rather than growing without bound.
		step = Math.min(step + 1, ramp.length - 1);
		options.run();
	};

	return {
		request(): void {
			// A run is already pending; this request is covered by it. That is what
			// makes a burst cost one run rather than one per event.
			if (timer !== undefined) return;
			const elapsed =
				lastRunAt === undefined ? Number.POSITIVE_INFINITY : now() - lastRunAt;
			// Quiet for long enough that this is a fresh burst, not a continuation.
			if (elapsed >= resetAfterMs) step = 0;
			const interval = ramp[step] ?? 0;
			if (elapsed >= interval) {
				run();
				return;
			}
			timer = setTimer(() => {
				timer = undefined;
				run();
			}, interval - elapsed);
		},
		cancel(): void {
			if (timer === undefined) return;
			clearTimer(timer);
			timer = undefined;
		},
	};
}
