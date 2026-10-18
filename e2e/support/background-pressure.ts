import { expect, type Page } from '@playwright/test';
import { advanceRendererClock } from './renderer-clock';

/**
 * Background pressure a responsiveness spec runs in the page, stepped by the
 * test rather than by the machine's frame rate.
 *
 * Each probe does its work one animation frame at a time and counts the
 * frames it has done. A frame runs only when the test lets it: by moving the
 * held renderer clock, or, where the window's own timers must keep running,
 * by granting the probe frames. So the spec decides how much background work
 * lies between two inputs, and what it asserts is order: an input's effect is
 * on screen while the work is still in progress, and no further frame of it
 * ran in between. How fast the machine draws frames decides nothing.
 */

/** The frame period of the held clock's animation frames. */
const FRAME_MS = 16;

/** Run this many frames of background work on the held renderer clock. */
export async function runBackgroundFrames(
	page: Page,
	frames: number,
): Promise<void> {
	await advanceRendererClock(page, frames * FRAME_MS);
}

/** The state a background probe published on `window[name]`. */
export async function readBackgroundProbe<T>(
	page: Page,
	name: string,
): Promise<T> {
	return (await page.evaluate(
		(key) => (window as unknown as Record<string, unknown>)[key],
		name,
	)) as T;
}

/**
 * Perform an input while background work is in progress, wait for its effect,
 * and assert the order: the work was still running when the input was made,
 * and it had done no further frame by the time the effect was on screen. An
 * effect that waited behind the work could not appear, because the work does
 * not move until the test lets it.
 */
export async function expectEffectAheadOfBackground<
	T extends { running: boolean },
>(
	page: Page,
	probe: string,
	input: () => Promise<void>,
	effect: () => Promise<void>,
): Promise<T> {
	const before = await readBackgroundProbe<T>(page, probe);
	expect(before?.running, `${probe} is in progress when the input is made`).toBe(
		true,
	);
	await input();
	await effect();
	expect(
		await readBackgroundProbe<T>(page, probe),
		`${probe} did no further work while the input was handled`,
	).toEqual(before);
	return before;
}
