/**
 * The terminal the user is in right now: the one they last clicked or typed
 * in, still the focused one, in a window that itself has focus. Having typed
 * in a terminal earlier is not enough once focus has moved to another, and a
 * user who has gone to another application is in no terminal at all.
 */
export function isInteractingWithTerminal(options: {
	focusedSessionId: string | null;
	interactedSessionId: string | null;
	sessionId: string;
	windowFocused: boolean;
}): boolean {
	return (
		options.windowFocused &&
		options.interactedSessionId === options.sessionId &&
		options.focusedSessionId === options.sessionId
	);
}

/**
 * Finished or attention activity is acknowledged on arrival only for the
 * terminal the user is in right now.
 */
export function shouldAcknowledgeInteractedActivity(options: {
	acknowledged: boolean;
	focusedSessionId: string | null;
	interactedSessionId: string | null;
	sessionId: string;
	status: 'working' | 'idle';
	windowFocused: boolean;
}): boolean {
	return (
		isInteractingWithTerminal(options) &&
		!options.acknowledged &&
		options.status !== 'working'
	);
}
