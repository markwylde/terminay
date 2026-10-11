/**
 * A plain shell reports a command as finished a moment after the user types
 * it, and rings its bell at them as they type. For the terminal the user is
 * in right now that is not news: the one they last clicked or typed in, still
 * the focused one, in a window that itself has focus. A user who has gone to
 * another application is in no terminal at all.
 *
 * An agent's terminal is never acknowledged this way. Where the user is when
 * an agent finishes or asks for them says nothing about whether they saw it.
 */
export function shouldAcknowledgeInteractedActivity(options: {
	acknowledged: boolean;
	/** Whether an agent provider owns this terminal's activity. */
	claimed: boolean;
	focusedSessionId: string | null;
	interactedSessionId: string | null;
	sessionId: string;
	status: 'working' | 'idle';
	windowFocused: boolean;
}): boolean {
	return (
		!options.claimed &&
		options.windowFocused &&
		options.interactedSessionId === options.sessionId &&
		options.focusedSessionId === options.sessionId &&
		!options.acknowledged &&
		options.status !== 'working'
	);
}
