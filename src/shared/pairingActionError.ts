const USED_OR_EXPIRED_LINK =
	/(?:pairing (?:room|link).*(?:used|expired|replaced|unavailable)|unknown[- ]room|no[- ]registered[- ]host|pairing[- ]room[- ]unavailable|(?:expired|replaced) before (?:it|this device) was approved)/iu;
const UNREACHABLE_SERVER =
	/\b(?:timed out|timeout)\b|did not answer in time|connection to the server was lost|\bICE\b|connectivity/iu;

/**
 * What to tell a user when a connection action rejects. Electron wraps a
 * main-process rejection as `Error invoking remote method '<channel>': <Name>:
 * <message>`; neither the channel nor the error class is something they can
 * act on.
 */
export function friendlyPairingActionError(cause: unknown): string {
	const raw = cause instanceof Error ? cause.message : String(cause);
	const message = raw
		.replace(/^Error invoking remote method '[^']+':\s*/u, '')
		.replace(/^(?:[A-Z][A-Za-z]*)?Error:\s*/u, '')
		.trim();
	if (USED_OR_EXPIRED_LINK.test(message))
		return 'This pairing link has already been used or has expired. Generate a new link on the server.';
	if (UNREACHABLE_SERVER.test(message))
		return 'Could not connect to the server. Check that its signaling address and UDP media route are reachable, then try again.';
	return message || 'The connection action failed.';
}
