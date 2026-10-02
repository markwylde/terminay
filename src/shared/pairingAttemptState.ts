import type { TerminayPairingProgressState } from '@terminay/protocol';

/** The progress a pairing surface can show; recovery is a transition, not a
 * state of its own. */
export type PairingAttemptProgress = Exclude<
	TerminayPairingProgressState,
	'connection-recovered'
>;

export type PairingAttemptApproval = Readonly<{
	deviceName: string;
	matchCode: string;
	expiresAt: string;
}>;

export type PairingAttemptView = Readonly<{
	attemptId: string | null;
	approval: PairingAttemptApproval | null;
	progress: PairingAttemptProgress | null;
	/** What to show again once a degraded network path recovers. */
	resume: PairingAttemptProgress | null;
}>;

export type PairingAttemptEvent =
	| Readonly<{ type: 'started'; attemptId: string }>
	| Readonly<{
			type: 'approval';
			attemptId: string;
			approval: PairingAttemptApproval;
	  }>
	| Readonly<{
			type: 'progress';
			attemptId: string;
			state: TerminayPairingProgressState;
	  }>
	| Readonly<{ type: 'settled'; attemptId: string }>
	| Readonly<{ type: 'dismissed' }>;

export const IDLE_PAIRING_ATTEMPT: PairingAttemptView = Object.freeze({
	attemptId: null,
	approval: null,
	progress: null,
	resume: null,
});

/**
 * What one Desktop pairing attempt shows. Host events carry the attempt they
 * belong to, so a late event from an earlier or cancelled attempt cannot
 * change what the current one displays.
 */
export function pairingAttemptReducer(
	view: PairingAttemptView,
	event: PairingAttemptEvent,
): PairingAttemptView {
	if (event.type === 'dismissed') return IDLE_PAIRING_ATTEMPT;
	if (event.type === 'started')
		return { ...IDLE_PAIRING_ATTEMPT, attemptId: event.attemptId };
	if (view.attemptId !== event.attemptId) return view;
	switch (event.type) {
		case 'approval':
			// Approval is only pending until the host decides; a code arriving after
			// the attempt moved on must not put the prompt back.
			return view.progress === null || view.progress === 'connection-degraded'
				? { ...view, approval: event.approval }
				: view;
		case 'settled':
			// The recovery notice outlives the request that reported it: the saved
			// server is still there to retry. Everything else ends with the attempt.
			return view.progress === 'connection-lost'
				? { ...view, approval: null, resume: null }
				: IDLE_PAIRING_ATTEMPT;
		case 'progress':
			switch (event.state) {
				case 'connection-degraded':
					return view.progress === 'connection-degraded' ||
						view.progress === 'connection-lost'
						? view
						: { ...view, progress: 'connection-degraded', resume: view.progress };
				case 'connection-recovered':
					return view.progress === 'connection-degraded'
						? { ...view, progress: view.resume, resume: null }
						: view;
				case 'connection-lost':
					return {
						...view,
						approval: null,
						progress: 'connection-lost',
						resume: null,
					};
				case 'connecting':
				case 'connected':
					return view.progress === 'connection-lost'
						? view
						: { ...view, approval: null, progress: event.state, resume: null };
				default:
					return view;
			}
		default:
			return view;
	}
}
