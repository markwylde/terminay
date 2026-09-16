/**
 * The damping schedule ADR-0022 requires in front of change-driven work.
 *
 * A change requests a run. The first request after a quiet period runs
 * promptly. While requests keep arriving, the minimum spacing between runs
 * widens through the ramp — 1 s, 2 s, 3 s, 5 s, 10 s, 20 s — and holds at the
 * ceiling. Requests arriving inside an interval collapse into exactly one run
 * at its end, so nothing is dropped and the rate is bounded however the
 * requests arrive. A quiet period at least as long as the current interval
 * resets the ramp to its floor.
 *
 * The ramp is a floor between runs, not a delay after the last request: a
 * user watching for the first change sees it acted on at once, and only
 * sustained churn is slowed.
 */
export interface RampScheduleOptions {
	/** Minimum spacing between consecutive runs, in milliseconds, widest last. */
	readonly intervalsMs?: readonly number[];
	readonly now?: () => number;
	readonly schedule?: (
		callback: () => void,
		milliseconds: number,
	) => ReturnType<typeof setTimeout>;
	readonly cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface RampSchedule {
	/** Ask for a run. Returns true when the run happened synchronously. */
	request(): boolean;
	/** Whether a run is waiting for the current interval to end. */
	readonly pending: boolean;
	/** Forget the ramp position and cancel any pending run. */
	dispose(): void;
}

export const DEFAULT_RAMP_INTERVALS_MS: readonly number[] = Object.freeze([
	1_000, 2_000, 3_000, 5_000, 10_000, 20_000,
]);

export function createRampSchedule(
	run: () => void,
	options: RampScheduleOptions = {},
): RampSchedule {
	const intervals = validIntervals(options.intervalsMs);
	const now = options.now ?? (() => Date.now());
	const schedule =
		options.schedule ??
		((callback, milliseconds) => setTimeout(callback, milliseconds));
	const cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
	let level = 0;
	let lastRunAt: number | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const execute = (): void => {
		lastRunAt = now();
		try {
			run();
		} catch {
			/* a failed run must not stop the schedule */
		}
	};

	return {
		get pending() {
			return timer !== undefined;
		},
		request(): boolean {
			if (disposed) return false;
			// A request inside an interval collapses into the run already waiting.
			if (timer !== undefined) return false;
			const interval = intervals[level]!;
			const elapsed = lastRunAt === undefined ? Infinity : now() - lastRunAt;
			if (elapsed >= interval) {
				// Quiet for at least the current interval: back to the floor, and the
				// change that ended the quiet period is acted on at once.
				level = 0;
				execute();
				return true;
			}
			// Still inside the floor: one run at its end, and the next floor is
			// wider because changes are still arriving.
			timer = schedule(() => {
				timer = undefined;
				level = Math.min(level + 1, intervals.length - 1);
				execute();
			}, interval - elapsed);
			return false;
		},
		dispose(): void {
			disposed = true;
			if (timer !== undefined) cancelSchedule(timer);
			timer = undefined;
			level = 0;
			lastRunAt = undefined;
		},
	};
}

function validIntervals(value: readonly number[] | undefined): readonly number[] {
	if (value === undefined) return DEFAULT_RAMP_INTERVALS_MS;
	if (
		value.length === 0 ||
		value.some(
			(interval, index) =>
				!Number.isFinite(interval) ||
				interval <= 0 ||
				(index > 0 && interval < value[index - 1]!),
		)
	)
		throw new RangeError('ramp intervals must be positive and non-decreasing');
	return Object.freeze([...value]);
}
