/**
 * Decides whether a previewed page's request to open a link is honoured.
 *
 * The request comes from a document that runs file-provided script, so nothing
 * about it is trusted: the page's own link handling is a convenience, and this
 * is the check. The sandbox proxy has already dropped a request made while
 * nobody was using the page; the workspace asks its own browser the same thing.
 */

const MAX_URL_CHARS = 4096;
const MIN_LINK_INTERVAL_MS = 1000;

export interface PreviewLinkState {
	lastOpenedAt: number;
}

/** The URL to open for this message, or nothing when it is not to be opened. */
export function previewLinkToOpen(
	message: unknown,
	state: PreviewLinkState,
	context: { readonly now: number; readonly userActive: boolean },
): string | undefined {
	if (typeof message !== 'object' || message === null) return undefined;
	const { method, params } = message as { method?: unknown; params?: unknown };
	if (method !== 'ui/open-link' || typeof params !== 'object' || params === null)
		return undefined;
	const raw = (params as { url?: unknown }).url;
	if (typeof raw !== 'string' || raw.length > MAX_URL_CHARS) return undefined;
	if (!context.userActive) return undefined;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
	if (url.username !== '' || url.password !== '') return undefined;
	// One link at a time: a page cannot fill the screen with tabs.
	if (context.now - state.lastOpenedAt < MIN_LINK_INTERVAL_MS) return undefined;
	state.lastOpenedAt = context.now;
	return url.toString();
}
