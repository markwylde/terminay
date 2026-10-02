export function friendlyPairingActionError(cause: unknown): string {
	const raw = cause instanceof Error ? cause.message : String(cause);
	const message = raw.replace(/^Error invoking remote method '[^']+':\s*/u, '');
	if (
		/(?:pairing (?:room|link).*(?:used|expired|replaced|unavailable)|unknown[- ]room|no[- ]registered[- ]host|pairing[- ]room[- ]unavailable|(?:expired|replaced) before (?:it|this device) was approved)/iu.test(
			message,
		)
	)
		return 'This pairing link has already been used or has expired. Generate a new link on the server.';
	if (/\b(?:timed out|timeout)\b|\bICE\b|connectivity/iu.test(message))
		return 'Could not connect to the server. Check that its signaling address and UDP media route are reachable, then try again.';
	return message || 'The connection action failed.';
}
