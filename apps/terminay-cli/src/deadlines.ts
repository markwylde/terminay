/**
 * What schedules and cancels a one-shot deadline.
 *
 * The commands bound every wait on something outside this process — an engine
 * request, a container's health, a server's shutdown or readiness — with one
 * deadline. Those deadlines are scheduled through this, so a caller can decide
 * when they come due; everything else uses the process's own timers.
 */
export interface DeadlineTimers {
	setTimeout(handler: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

/** The process's own timers. */
export const GLOBAL_DEADLINE_TIMERS: DeadlineTimers = {
	setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
	clearTimeout: (handle) =>
		globalThis.clearTimeout(
			handle as ReturnType<typeof globalThis.setTimeout> | undefined,
		),
};
