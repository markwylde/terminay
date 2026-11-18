import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsNewStore } from './latestWhatsNew.ts';
import {
	hasUnreadWhatsNew,
	parseLatestAnnouncement,
	parseWhatsNewMessage,
	safeExternalUrl,
	WHATS_NEW_CHECK_THROTTLE_MS,
	WHATS_NEW_LATEST_URL,
	WHATS_NEW_READY_TIMEOUT_MS,
	type WhatsNewLoadStatus,
	watchWhatsNewLoad,
	whatsNewEmbedUrl,
} from './whatsNewModel.ts';

const frame = { name: "the What's New frame" };
const fromFrame = (
	data: unknown,
	overrides: Partial<{ origin: string; source: unknown }> = {},
) => ({
	origin: 'https://terminay.com',
	source: frame,
	data,
	...overrides,
});

test('the embed URL names only the embed page and the theme', () => {
	assert.equal(
		whatsNewEmbedUrl('dark'),
		'https://terminay.com/whats-new/embed/?theme=dark',
	);
	assert.equal(
		whatsNewEmbedUrl('light'),
		'https://terminay.com/whats-new/embed/?theme=light',
	);
});

test('ready and open-external are accepted from the frame on terminay.com', () => {
	assert.deepEqual(
		parseWhatsNewMessage(
			fromFrame({ type: 'terminay.whats-new.ready', version: 1 }),
			frame,
		),
		{ type: 'terminay.whats-new.ready' },
	);
	assert.deepEqual(
		parseWhatsNewMessage(
			fromFrame({
				type: 'terminay.whats-new.open-external',
				version: 1,
				url: 'https://terminay.com/docs/bots/',
			}),
			frame,
		),
		{
			type: 'terminay.whats-new.open-external',
			url: 'https://terminay.com/docs/bots/',
		},
	);
});

test('messages from another origin or another window are dropped', () => {
	const ready = { type: 'terminay.whats-new.ready', version: 1 };
	assert.equal(
		parseWhatsNewMessage(
			fromFrame(ready, { origin: 'https://evil.example' }),
			frame,
		),
		undefined,
	);
	assert.equal(
		parseWhatsNewMessage(
			fromFrame(ready, { origin: 'http://terminay.com' }),
			frame,
		),
		undefined,
	);
	assert.equal(
		parseWhatsNewMessage(
			fromFrame(ready, { origin: 'https://app.terminay.com' }),
			frame,
		),
		undefined,
	);
	assert.equal(
		parseWhatsNewMessage(fromFrame(ready, { source: {} }), frame),
		undefined,
	);
	assert.equal(parseWhatsNewMessage(fromFrame(ready), undefined), undefined);
	assert.equal(
		parseWhatsNewMessage(fromFrame(ready, { source: null }), null),
		undefined,
	);
});

test('messages with extra keys, the wrong version or an unknown type are dropped', () => {
	assert.equal(
		parseWhatsNewMessage(
			fromFrame({ type: 'terminay.whats-new.ready', version: 1, extra: true }),
			frame,
		),
		undefined,
	);
	assert.equal(
		parseWhatsNewMessage(
			fromFrame({ type: 'terminay.whats-new.ready', version: 2 }),
			frame,
		),
		undefined,
	);
	assert.equal(
		parseWhatsNewMessage(
			fromFrame({ type: 'terminay.whats-new.navigate', version: 1 }),
			frame,
		),
		undefined,
	);
	assert.equal(
		parseWhatsNewMessage(
			fromFrame({
				type: 'terminay.whats-new.open-external',
				version: 1,
				url: 'https://terminay.com/',
				target: '_top',
			}),
			frame,
		),
		undefined,
	);
	assert.equal(
		parseWhatsNewMessage(fromFrame('terminay.whats-new.ready'), frame),
		undefined,
	);
	assert.equal(parseWhatsNewMessage(fromFrame([]), frame), undefined);
});

test('only credential-free https links may open', () => {
	for (const url of [
		'file:///etc/passwd',
		'javascript:alert(1)',
		'http://terminay.com/',
		'https://user:pass@terminay.com/',
		'https://user@terminay.com/',
		'data:text/html,hi',
		'',
		'not a url',
		42,
		`https://terminay.com/${'a'.repeat(2100)}`,
	]) {
		assert.equal(safeExternalUrl(url), undefined, String(url).slice(0, 40));
		assert.equal(
			parseWhatsNewMessage(
				fromFrame({
					type: 'terminay.whats-new.open-external',
					version: 1,
					url,
				}),
				frame,
			),
			undefined,
		);
	}
	assert.equal(
		safeExternalUrl('https://github.com/markwylde/terminay/releases'),
		'https://github.com/markwylde/terminay/releases',
	);
});

test('the announcement must name a YYYY-MM post', () => {
	assert.equal(
		parseLatestAnnouncement({ id: '2026-11', title: 'November' }),
		'2026-11',
	);
	for (const bad of [
		null,
		[],
		'x',
		{},
		{ id: '2026-13' },
		{ id: '2026-1' },
		{ id: 202611 },
		{ id: '<b>' },
	]) {
		assert.equal(parseLatestAnnouncement(bad), undefined);
	}
});

test('a post is unread when announced and not viewed on this device', () => {
	assert.equal(hasUnreadWhatsNew(undefined, undefined), false);
	assert.equal(hasUnreadWhatsNew('2026-11', undefined), true);
	assert.equal(hasUnreadWhatsNew('2026-12', '2026-11'), true);
	assert.equal(hasUnreadWhatsNew('2026-11', '2026-11'), false);
});

function fakeTimers() {
	let next = 1;
	const pending = new Map<number, () => void>();
	return {
		setTimer: (callback: () => void, ms: number) => {
			assert.equal(ms, WHATS_NEW_READY_TIMEOUT_MS);
			const handle = next++;
			pending.set(handle, callback);
			return handle;
		},
		clearTimer: (handle: unknown) => {
			pending.delete(handle as number);
		},
		fire: () => {
			for (const [handle, callback] of [...pending]) {
				pending.delete(handle);
				callback();
			}
		},
		get size() {
			return pending.size;
		},
	};
}

test('the load fails after the timeout when the page never says it is ready', () => {
	const timers = fakeTimers();
	const statuses: WhatsNewLoadStatus[] = [];
	watchWhatsNewLoad({
		online: true,
		onStatus: (s) => statuses.push(s),
		...timers,
	});
	assert.deepEqual(statuses, ['loading']);
	timers.fire();
	assert.deepEqual(statuses, ['loading', 'failed']);
});

test('a ready page clears the timeout, and a later timeout changes nothing', () => {
	const timers = fakeTimers();
	const statuses: WhatsNewLoadStatus[] = [];
	const watch = watchWhatsNewLoad({
		online: true,
		onStatus: (s) => statuses.push(s),
		...timers,
	});
	watch.ready();
	assert.equal(timers.size, 0);
	watch.ready();
	assert.deepEqual(statuses, ['loading', 'ready']);
});

test('offline shows the notice at once, and a cancelled watch reports nothing', () => {
	const timers = fakeTimers();
	const statuses: WhatsNewLoadStatus[] = [];
	watchWhatsNewLoad({
		online: false,
		onStatus: (s) => statuses.push(s),
		...timers,
	});
	assert.deepEqual(statuses, ['failed']);
	assert.equal(timers.size, 0);

	const later: WhatsNewLoadStatus[] = [];
	const watch = watchWhatsNewLoad({
		online: true,
		onStatus: (s) => later.push(s),
		...timers,
	});
	watch.cancel();
	assert.equal(timers.size, 0);
	watch.ready();
	assert.deepEqual(later, ['loading']);
});

type FetchCall = Readonly<{ input: string; init: Record<string, unknown> }>;

function storeWith(
	responses: Array<
		() => Promise<{ ok: boolean; json: () => Promise<unknown> }>
	>,
	viewed?: string,
) {
	const calls: FetchCall[] = [];
	let clock = 1_000_000;
	let stored = viewed;
	const store = createWhatsNewStore({
		fetch: (input, init) => {
			calls.push({ input, init: { ...init } });
			const next = responses.shift();
			return next === undefined
				? Promise.reject(new Error('unexpected fetch'))
				: next();
		},
		now: () => clock,
		recallViewed: () => stored,
		rememberViewed: (id) => {
			stored = id;
		},
	});
	return {
		store,
		calls,
		advance: (ms: number) => {
			clock += ms;
		},
		stored: () => stored,
	};
}

const announce = (id: unknown) => () =>
	Promise.resolve({ ok: true, json: () => Promise.resolve({ id }) });

test('the announcement is fetched without credentials or referrer, and shows a new post as unread', async () => {
	const { store, calls } = storeWith([announce('2026-11')], '2026-10');
	await store.check();
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.input, WHATS_NEW_LATEST_URL);
	assert.deepEqual(calls[0]?.init, {
		cache: 'no-store',
		credentials: 'omit',
		referrerPolicy: 'no-referrer',
		mode: 'cors',
	});
	assert.deepEqual(store.getState(), {
		announced: '2026-11',
		lastViewed: '2026-10',
		unread: true,
	});
});

test('checks within an hour are skipped; after an hour one runs again', async () => {
	const { store, calls, advance } = storeWith([
		announce('2026-11'),
		announce('2026-12'),
	]);
	await store.check();
	advance(10 * 60 * 1000);
	await store.check();
	assert.equal(calls.length, 1);
	advance(WHATS_NEW_CHECK_THROTTLE_MS);
	await store.check();
	assert.equal(calls.length, 2);
	assert.equal(store.getState().announced, '2026-12');
});

test('a failed or malformed announcement keeps the previous state silently', async () => {
	const { store, advance } = storeWith([
		announce('2026-11'),
		() => Promise.reject(new TypeError('offline')),
		() =>
			Promise.resolve({
				ok: false,
				json: () => Promise.resolve({ id: '2026-12' }),
			}),
		announce('garbage'),
		() =>
			Promise.resolve({
				ok: true,
				json: () => Promise.reject(new SyntaxError('bad json')),
			}),
	]);
	await store.check();
	for (let index = 0; index < 4; index += 1) {
		advance(WHATS_NEW_CHECK_THROTTLE_MS);
		await assert.doesNotReject(store.check());
		assert.equal(store.getState().announced, '2026-11');
	}
});

test('a failed read does not hold back the next on-demand read', async () => {
	const { store, calls } = storeWith([
		() => Promise.reject(new TypeError('offline')),
		announce('2026-11'),
	]);
	await store.check();
	assert.equal(store.getState().announced, undefined);
	await store.check();
	assert.equal(calls.length, 2);
	assert.equal(store.getState().announced, '2026-11');
	await store.check();
	assert.equal(calls.length, 2);
});

test('opening the section marks the announced post viewed; a later post is unread again', async () => {
	const { store, advance, stored } = storeWith([
		announce('2026-11'),
		announce('2026-12'),
	]);
	await store.check();
	assert.equal(store.getState().unread, true);
	let notified = 0;
	const unsubscribe = store.subscribe(() => {
		notified += 1;
	});
	store.setViewing(true);
	assert.equal(store.getState().unread, false);
	assert.equal(stored(), '2026-11');
	assert.equal(notified, 1);
	store.setViewing(false);
	advance(WHATS_NEW_CHECK_THROTTLE_MS);
	await store.check();
	assert.equal(store.getState().unread, true);
	assert.equal(stored(), '2026-11');
	unsubscribe();
});

test('a post announced while the section is on screen counts as viewed', async () => {
	const { store, stored } = storeWith([announce('2026-11')]);
	store.setViewing(true);
	await store.check();
	assert.equal(store.getState().unread, false);
	assert.equal(stored(), '2026-11');
});

test('the store schedules no timer of its own', async () => {
	const original = globalThis.setInterval;
	const originalTimeout = globalThis.setTimeout;
	let scheduled = 0;
	globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
		scheduled += 1;
		return original(...args);
	}) as typeof setInterval;
	globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
		scheduled += 1;
		return originalTimeout(...args);
	}) as typeof setTimeout;
	try {
		const { store } = storeWith([announce('2026-11')]);
		await store.check();
		store.setViewing(true);
	} finally {
		globalThis.setInterval = original;
		globalThis.setTimeout = originalTimeout;
	}
	assert.equal(scheduled, 0);
});
