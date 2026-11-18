/**
 * What's New: the monthly post published on terminay.com, shown in a Home
 * section (ADR-0137).
 *
 * terminay.com is the only hosted origin the workspace admits. The page is
 * framed cross-origin and sandboxed, is told nothing but its theme and that it
 * is embedded, and can talk back through exactly two closed, versioned
 * messages. Everything here is pure so the boundary can be tested on its own.
 */

export const WHATS_NEW_ORIGIN = 'https://terminay.com';
/** The public page, for Open in browser. */
export const WHATS_NEW_PAGE_URL = `${WHATS_NEW_ORIGIN}/whats-new/`;
/** The framed page: no site chrome, analytics or third-party requests. */
export const WHATS_NEW_EMBED_URL = `${WHATS_NEW_ORIGIN}/whats-new/embed/`;
export const WHATS_NEW_LATEST_URL = `${WHATS_NEW_ORIGIN}/whats-new/latest.json`;

/** No top navigation, popups, forms, modals, or permission delegation. The
 * frame keeps terminay.com's own origin for its scripts; being cross-origin it
 * still cannot reach the workspace. */
export const WHATS_NEW_SANDBOX = 'allow-scripts allow-same-origin';

/** How long the page has to say it rendered before the offline notice shows. */
export const WHATS_NEW_READY_TIMEOUT_MS = 15_000;

/** The announcement is read on demand (ADR-0028), and no more often than this. */
export const WHATS_NEW_CHECK_THROTTLE_MS = 60 * 60 * 1000;

export type WhatsNewAppearance = 'light' | 'dark';

/** The embedded page's address. It carries the theme and nothing about the
 * user's workspace. */
export function whatsNewEmbedUrl(appearance: WhatsNewAppearance): string {
	return `${WHATS_NEW_EMBED_URL}?theme=${appearance}`;
}

export type WhatsNewMessage =
	| Readonly<{ type: 'terminay.whats-new.ready' }>
	| Readonly<{ type: 'terminay.whats-new.open-external'; url: string }>;

function hasExactKeys(value: object, keys: readonly string[]): boolean {
	const own = Object.keys(value);
	return own.length === keys.length && keys.every((key) => own.includes(key));
}

/** A credential-free `https:` URL, normalised, or undefined. */
export function safeExternalUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length === 0 || value.length > 2048)
		return undefined;
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== 'https:') return undefined;
	if (parsed.username !== '' || parsed.password !== '') return undefined;
	return parsed.href;
}

/**
 * Accept a message only from the frame the section shows, from terminay.com,
 * with exactly the keys of one of the two messages. Anything else is dropped.
 */
export function parseWhatsNewMessage(
	event: Readonly<{ origin: string; source: unknown; data: unknown }>,
	frameWindow: unknown,
): WhatsNewMessage | undefined {
	if (frameWindow === null || frameWindow === undefined) return undefined;
	if (event.source !== frameWindow) return undefined;
	if (event.origin !== WHATS_NEW_ORIGIN) return undefined;
	const data = event.data;
	if (typeof data !== 'object' || data === null || Array.isArray(data))
		return undefined;
	const record = data as Record<string, unknown>;
	if (record.version !== 1) return undefined;
	if (record.type === 'terminay.whats-new.ready') {
		return hasExactKeys(record, ['type', 'version'])
			? { type: 'terminay.whats-new.ready' }
			: undefined;
	}
	if (record.type === 'terminay.whats-new.open-external') {
		if (!hasExactKeys(record, ['type', 'version', 'url'])) return undefined;
		const url = safeExternalUrl(record.url);
		return url === undefined
			? undefined
			: { type: 'terminay.whats-new.open-external', url };
	}
	return undefined;
}

const POST_ID = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isWhatsNewPostId(value: unknown): value is string {
	return typeof value === 'string' && POST_ID.test(value);
}

/** The announced post's identifier, or undefined for anything malformed. */
export function parseLatestAnnouncement(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return undefined;
	const id = (value as Record<string, unknown>).id;
	return isWhatsNewPostId(id) ? id : undefined;
}

/** A post is unread when one is announced and this device has not viewed it. */
export function hasUnreadWhatsNew(
	announced: string | undefined,
	lastViewed: string | undefined,
): boolean {
	return announced !== undefined && announced !== lastViewed;
}

export type WhatsNewLoadStatus = 'loading' | 'ready' | 'failed';

export type WhatsNewLoadWatch = Readonly<{
	/** The page said it rendered. */
	ready: () => void;
	cancel: () => void;
}>;

/**
 * Watch one load of the page. A cross-origin frame's `load` fires for error
 * pages too, so only the page's own `ready` message counts as success. With
 * the device offline the notice shows at once; otherwise after the timeout.
 */
export function watchWhatsNewLoad(
	options: Readonly<{
		online: boolean;
		onStatus: (status: WhatsNewLoadStatus) => void;
		setTimer: (callback: () => void, ms: number) => unknown;
		clearTimer: (handle: unknown) => void;
	}>,
): WhatsNewLoadWatch {
	let settled = false;
	const settle = (status: WhatsNewLoadStatus) => {
		if (settled) return;
		settled = true;
		if (handle !== undefined) options.clearTimer(handle);
		options.onStatus(status);
	};
	let handle: unknown;
	if (!options.online) {
		settle('failed');
	} else {
		options.onStatus('loading');
		handle = options.setTimer(() => {
			handle = undefined;
			settle('failed');
		}, WHATS_NEW_READY_TIMEOUT_MS);
	}
	return {
		ready: () => settle('ready'),
		cancel: () => {
			settled = true;
			if (handle !== undefined) options.clearTimer(handle);
		},
	};
}

/** Whether an on-demand check may run now. */
export function shouldCheckWhatsNew(
	lastCheckedAt: number | undefined,
	now: number,
): boolean {
	return (
		lastCheckedAt === undefined ||
		now - lastCheckedAt >= WHATS_NEW_CHECK_THROTTLE_MS ||
		now < lastCheckedAt
	);
}
