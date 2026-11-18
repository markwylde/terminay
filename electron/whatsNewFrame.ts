/**
 * The one hosted page a server-UI window may load in a subframe: the What's
 * New embed on terminay.com (ADR-0137). A main frame is never allowed to
 * leave the server, and no other hosted origin or path is admitted.
 */

const WHATS_NEW_EMBED_ORIGIN = 'https://terminay.com';
const WHATS_NEW_EMBED_PATH = '/whats-new/embed/';

export function isAllowedWhatsNewSubframe(
	url: string,
	isMainFrame: boolean,
): boolean {
	if (isMainFrame) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	return (
		parsed.origin === WHATS_NEW_EMBED_ORIGIN &&
		parsed.username === '' &&
		parsed.password === '' &&
		parsed.pathname.startsWith(WHATS_NEW_EMBED_PATH) &&
		!parsed.pathname.includes('/../')
	);
}
