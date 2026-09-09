import type { TerminalStreamEvent, TerminalStreamSkipEvent } from '@terminay/client-core';

/**
 * A resume the server refused is a discontinuity, not a dead end.
 *
 * A panel reconnects by asking to resume from the exact position it last
 * rendered. When the shell printed more than the server retains while the
 * connection was down, that position is behind the replay window and the
 * server answers `presentation_unavailable` rather than inventing a screen.
 * That is the same shape of problem as a congestion skip — the display's
 * position is no longer reachable — so it is handed to the same bounded
 * recovery, which re-attaches with a fresh presentation from the live head.
 *
 * Only a resume qualifies. When the attach that was refused was already a
 * fresh presentation, no better request exists and the caller must surface a
 * retryable error instead.
 */
export function presentationRefusalSkip(
	event: TerminalStreamEvent,
	attach: Readonly<{ freshPresentation: boolean }>,
): TerminalStreamSkipEvent | undefined {
	if (event.type !== 'presentation_unavailable') return undefined;
	if (attach.freshPresentation) return undefined;
	return Object.freeze({
		serverId: event.serverId,
		projectId: event.projectId,
		sessionId: event.sessionId,
		type: 'skip',
		fromPosition: event.requestedFromPosition,
		toPosition: Math.max(event.requestedFromPosition, event.outputPosition),
		// The lane that served this display's position is gone; that is the
		// existing recoverable reason, so no new reason enters diagnostics.
		reason: 'attachment_closed',
	});
}
