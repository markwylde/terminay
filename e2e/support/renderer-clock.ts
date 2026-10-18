import type { Page } from '@playwright/test';

/** How far ahead of the furthest window the held clock is set. */
const HOLD_MARGIN_MS = 100;

/**
 * A clock the test holds for the renderer.
 *
 * Hover delays, a dropped order's preview, and other things the interface
 * does after a while are specified in time. A test that sleeps through such a
 * period and then asserts races the runner's load. Under a held clock the
 * renderer's timers, animation frames, and `Date.now`/`performance.now` stand
 * still until the test advances them, so a period ends exactly when the test
 * says: "not yet" is asserted with the deadline provably still ahead, and
 * "now" by moving the clock across it.
 *
 * Hold it only for the stretch being timed and release it after: the
 * terminal draws on animation frames, which do not run while it is held.
 */
export async function holdRendererClock(page: Page): Promise<void> {
	await installRendererClock(page);
	// The clock is the whole application's: every window and frame keeps its
	// own copy, and they drift apart by a few milliseconds as each is run.
	// It is held a little ahead of the one furthest on, so that none is
	// behind it by the time it is held; a timer due in that margin runs.
	let now = 0;
	for (const each of page.context().pages())
		for (const frame of each.frames())
			now = Math.max(
				now,
				await frame.evaluate(() => Date.now()).catch(() => 0),
			);
	await page.clock.pauseAt(now + HOLD_MARGIN_MS);
}

const installed = new WeakSet<Page>();

/**
 * Put the renderer's timers on the test's clock without stopping it: time
 * goes on as it does, but a timer armed from now on can later be run out by
 * holding and advancing the clock. A timer armed before this is beyond the
 * test's reach, so install it before the gesture that arms the one to time.
 */
export async function installRendererClock(page: Page): Promise<void> {
	if (installed.has(page)) return;
	await page.clock.install();
	installed.add(page);
}

/**
 * Move the held clock forward, running each timer that falls due on the way,
 * then wait until the work those timers handed to the renderer has run.
 */
export async function advanceRendererClock(
	page: Page,
	milliseconds: number,
): Promise<void> {
	await page.clock.runFor(milliseconds);
	await afterRendererTasks(page);
}

/** Let the held clock run with real time again. */
export async function releaseRendererClock(page: Page): Promise<void> {
	await page.clock.resume();
}

/**
 * Resolves once every task the renderer had already queued has run. React
 * renders a timer's state change in a message task it posts as the timer
 * runs; a message posted after it is delivered after it, so what the timer
 * changed is on screen when this returns. A negative assertion made after it
 * is ordered after the point where the change would have happened.
 */
export async function afterRendererTasks(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const channel = new MessageChannel();
				channel.port1.onmessage = () => {
					channel.port1.close();
					resolve();
				};
				channel.port2.postMessage(undefined);
			}),
	);
}

/**
 * Resolves once the renderer has drawn a frame after this call. Pointer
 * moves are read by a drag on its next frame, so a move followed by this has
 * been seen by the drag, and the next move is a frame later in its history.
 *
 * Animation libraries keep the frame scheduler they found when they loaded,
 * the browser's own, so this waits on that one even when the test's clock is
 * installed.
 */
export async function nextAnimationFrame(page: Page): Promise<void> {
	await page.evaluate(() => {
		const clock = (
			globalThis as {
				__pwClock?: {
					builtins: { requestAnimationFrame: typeof requestAnimationFrame };
				};
			}
		).__pwClock;
		const frame =
			clock?.builtins.requestAnimationFrame ?? requestAnimationFrame;
		return new Promise<void>((resolve) => frame(() => resolve()));
	});
}
