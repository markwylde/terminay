/**
 * Finished or attention activity is acknowledged on arrival only for the
 * terminal the user is in right now: the one they last clicked or typed in,
 * and still the focused one. Having typed in a terminal earlier is not enough
 * once focus has moved to another.
 */
export function shouldAcknowledgeInteractedActivity(options: {
	acknowledged: boolean;
	focusedSessionId: string | null;
	interactedSessionId: string | null;
	sessionId: string;
	status: 'working' | 'idle';
}): boolean {
	return (
		options.interactedSessionId === options.sessionId &&
		options.focusedSessionId === options.sessionId &&
		!options.acknowledged &&
		options.status !== 'working'
	);
}
