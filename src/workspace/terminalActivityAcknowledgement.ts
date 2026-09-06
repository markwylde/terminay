export function shouldAcknowledgeInteractedActivity(options: {
	acknowledged: boolean;
	interactedSessionId: string | null;
	sessionId: string;
	status: 'working' | 'idle';
}): boolean {
	return (
		options.interactedSessionId === options.sessionId &&
		!options.acknowledged &&
		options.status !== 'working'
	);
}
