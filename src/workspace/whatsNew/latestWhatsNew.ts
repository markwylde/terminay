/**
 * Which What's New post terminay.com announces, and whether this device has
 * opened it.
 *
 * The announcement is read on demand only, when the workspace starts and when
 * Home is selected, and no more often than once an hour. Nothing re-reads it
 * on a timer (ADR-0028). A failed or malformed read leaves the previous state
 * in place and reports nothing. The request carries no credentials or
 * referrer (ADR-0137).
 */

import { useSyncExternalStore } from 'react';
import {
	recallWhatsNewViewed,
	rememberWhatsNewViewed,
} from '../localViewState.ts';
import {
	hasUnreadWhatsNew,
	parseLatestAnnouncement,
	shouldCheckWhatsNew,
	WHATS_NEW_LATEST_URL,
} from './whatsNewModel.ts';

export type WhatsNewState = Readonly<{
	announced: string | undefined;
	lastViewed: string | undefined;
	unread: boolean;
}>;

type Fetch = (
	input: string,
	init: Readonly<{
		cache: 'no-store';
		credentials: 'omit';
		referrerPolicy: 'no-referrer';
		mode: 'cors';
	}>,
) => Promise<Readonly<{ ok: boolean; json: () => Promise<unknown> }>>;

export type WhatsNewStoreOptions = Readonly<{
	fetch?: Fetch;
	now?: () => number;
	recallViewed?: () => string | undefined;
	rememberViewed?: (postId: string) => void;
}>;

export type WhatsNewStore = Readonly<{
	getState: () => WhatsNewState;
	subscribe: (listener: () => void) => () => void;
	/** Read the announcement unless it was read within the last hour. */
	check: () => Promise<void>;
	/**
	 * Whether the What's New section is on screen. While it is, whatever is
	 * announced counts as viewed.
	 */
	setViewing: (viewing: boolean) => void;
}>;

export function createWhatsNewStore(
	options: WhatsNewStoreOptions = {},
): WhatsNewStore {
	const fetchImpl: Fetch | undefined =
		options.fetch ??
		(typeof globalThis.fetch === 'function'
			? (input, init) => globalThis.fetch(input, init)
			: undefined);
	const now = options.now ?? Date.now;
	const recall = options.recallViewed ?? recallWhatsNewViewed;
	const remember = options.rememberViewed ?? rememberWhatsNewViewed;
	const listeners = new Set<() => void>();
	let announced: string | undefined;
	let lastViewed = recall();
	let viewing = false;
	let lastCheckedAt: number | undefined;
	let inFlight: Promise<void> | undefined;
	let state: WhatsNewState = derive();

	function derive(): WhatsNewState {
		return {
			announced,
			lastViewed,
			unread: hasUnreadWhatsNew(announced, lastViewed),
		};
	}

	function publish(): void {
		const next = derive();
		if (
			next.announced === state.announced &&
			next.lastViewed === state.lastViewed &&
			next.unread === state.unread
		)
			return;
		state = next;
		for (const listener of listeners) listener();
	}

	function viewAnnounced(): void {
		if (announced === undefined || announced === lastViewed) return;
		lastViewed = announced;
		remember(announced);
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		check() {
			if (inFlight !== undefined) return inFlight;
			if (fetchImpl === undefined) return Promise.resolve();
			const at = now();
			if (!shouldCheckWhatsNew(lastCheckedAt, at)) return Promise.resolve();
			inFlight = (async () => {
				try {
					const response = await fetchImpl(WHATS_NEW_LATEST_URL, {
						cache: 'no-store',
						credentials: 'omit',
						referrerPolicy: 'no-referrer',
						mode: 'cors',
					});
					if (!response.ok) return;
					const id = parseLatestAnnouncement(await response.json());
					if (id === undefined) return;
					// Only an announcement actually read starts the hour; a failed
					// read leaves the next selection of Home free to try again.
					lastCheckedAt = at;
					announced = id;
					// A post announced while the section is in front is being read.
					if (viewing) viewAnnounced();
					publish();
				} catch {
					/* Offline or refused: keep what we had and say nothing. */
				} finally {
					inFlight = undefined;
				}
			})();
			return inFlight;
		},
		setViewing(next) {
			viewing = next;
			if (!next) return;
			viewAnnounced();
			publish();
		},
	};
}

let shared: WhatsNewStore | undefined;

/** The window's store. Tests build their own with `createWhatsNewStore`. */
export function whatsNewStore(): WhatsNewStore {
	shared ??= createWhatsNewStore();
	return shared;
}

export function useWhatsNew(
	store: WhatsNewStore = whatsNewStore(),
): WhatsNewState {
	return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
