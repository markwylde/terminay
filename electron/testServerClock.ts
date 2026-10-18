/**
 * A clock the end-to-end suite holds for the embedded server.
 *
 * Terminal activity and notifications are specified in time: input is the
 * user's own for a second, a plain shell is finished two seconds after its
 * input goes quiet, and a notification is published once it has stayed for the
 * settle period. A test that races those periods against the real clock passes
 * or fails with the runner's load. Under this clock the server's time stands
 * still until the test advances it, so every period ends exactly when the test
 * says and never in between.
 *
 * Like the other harness switches it is inert in production: it is honoured
 * only alongside the E2E marker.
 */
export interface ManualServerClock {
	now(): number;
	setTimeout(handler: () => void, milliseconds: number): unknown;
	clearTimeout(handle: unknown): void;
	/** Move time forward, running every timer that falls due on the way, in
	 * order, each at its own due time. */
	advance(milliseconds: number): void;
}

export function embeddedManualServerClock(
	environment: Readonly<Record<string, string | undefined>>,
	start = Date.now(),
): ManualServerClock | undefined {
	if (environment.TERMINAY_TEST !== '1') return undefined;
	if (environment.TERMINAY_TEST_SERVER_CLOCK !== 'manual') return undefined;
	return createManualServerClock(start);
}

export function createManualServerClock(start: number): ManualServerClock {
	let current = start;
	let sequence = 0;
	const timers = new Map<
		number,
		{ readonly due: number; readonly handler: () => void }
	>();
	return {
		now: () => current,
		setTimeout(handler, milliseconds) {
			sequence += 1;
			timers.set(sequence, {
				due: current + Math.max(0, milliseconds),
				handler,
			});
			return sequence;
		},
		clearTimeout(handle) {
			if (typeof handle === 'number') timers.delete(handle);
		},
		advance(milliseconds) {
			if (!Number.isFinite(milliseconds) || milliseconds < 0)
				throw new RangeError('a clock only moves forward');
			const target = current + milliseconds;
			for (;;) {
				// Earliest due first; timers armed at the same instant keep their order.
				let next: number | undefined;
				for (const [handle, timer] of timers) {
					if (timer.due > target) continue;
					const best = next === undefined ? undefined : timers.get(next);
					if (best === undefined || timer.due < best.due) next = handle;
				}
				if (next === undefined) break;
				const timer = timers.get(next);
				timers.delete(next);
				if (timer === undefined) break;
				current = Math.max(current, timer.due);
				timer.handler();
			}
			current = target;
		},
	};
}
