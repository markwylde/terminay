/**
 * Runs work on the next animation frame, or shortly after when no frame comes.
 *
 * Chromium delivers no animation frames to a window that is hidden or covered
 * by another application, so work that must still happen there — reporting a
 * terminal that finished while the user is elsewhere — cannot wait on a frame
 * alone. Timers keep firing in that state, so one stands in for the frame.
 */

export const FRAME_FALLBACK_MS = 100;

export type FrameHost = Pick<
	Window,
	| 'cancelAnimationFrame'
	| 'clearTimeout'
	| 'requestAnimationFrame'
	| 'setTimeout'
>;

export function requestFrameOrTimeout(
	callback: () => void,
	host: FrameHost = window,
): void {
	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		host.cancelAnimationFrame(frame);
		host.clearTimeout(timer);
		callback();
	};
	const frame = host.requestAnimationFrame(run);
	const timer = host.setTimeout(run, FRAME_FALLBACK_MS);
}
