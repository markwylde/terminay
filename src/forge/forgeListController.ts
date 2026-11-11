/**
 * When a forge list asks the server (ADR-0106), without React.
 *
 * A list asks when it is shown, when its query changes while shown, on
 * Refresh, on window focus once its answer is a minute old, and on a
 * `forge.changed` hint while shown (or when next shown). Nothing here starts
 * a timer. An answer to a request that a newer one replaced is dropped.
 */

import type { ForgeListItemView, ForgeSourceOutcomeView } from './forgeModel.ts';

/** A list's answer is refreshed on focus once it is this old. */
export const FORGE_FOCUS_REFRESH_MS = 60_000;

export type ForgeListRequestShape = object;

export type ForgeListState = Readonly<{
	items: readonly ForgeListItemView[];
	sources: readonly ForgeSourceOutcomeView[];
	nextCursor?: string;
	noAccounts: boolean;
	loading: boolean;
	loadingMore: boolean;
	error?: string;
	fetchedAt?: number;
	/** Some answer has arrived for the current request. */
	settled: boolean;
}>;

export const EMPTY_FORGE_LIST: ForgeListState = Object.freeze({
	items: [],
	sources: [],
	noAccounts: false,
	loading: false,
	loadingMore: false,
	settled: false,
});

type RawListResult = Readonly<{
	items: readonly ForgeListItemView[];
	sources: readonly ForgeSourceOutcomeView[];
	nextCursor?: string;
	noAccounts?: boolean;
}>;

export type ForgeListFetch<Request extends ForgeListRequestShape> = (
	request: Request & { fresh?: boolean; cursor?: string },
	key: string,
) => Promise<unknown>;

export class ForgeListController<Request extends ForgeListRequestShape> {
	private request: Request | undefined;
	private requestKey = '';
	private shownKey: string | undefined;
	private visible = false;
	private stale = false;
	private generation = 0;
	private state: ForgeListState = EMPTY_FORGE_LIST;
	private readonly fetch: ForgeListFetch<Request>;
	private readonly key: string;
	private readonly onState: (state: ForgeListState) => void;
	private readonly now: () => number;

	constructor(
		fetch: ForgeListFetch<Request>,
		key: string,
		onState: (state: ForgeListState) => void,
		now: () => number = Date.now,
	) {
		this.fetch = fetch;
		this.key = key;
		this.onState = onState;
		this.now = now;
	}

	get current(): ForgeListState {
		return this.state;
	}

	/** The query; a new one while shown is asked for at once. */
	setRequest(request: Request | undefined): void {
		const key = request === undefined ? '' : JSON.stringify(request);
		this.request = request;
		if (key === this.requestKey) return;
		this.requestKey = key;
		if (request === undefined) {
			this.shownKey = undefined;
			this.generation += 1;
			this.publish(EMPTY_FORGE_LIST);
			return;
		}
		if (this.visible) this.ask(false);
	}

	/** Shown or hidden; showing asks unless the answer is for this query and nothing changed. */
	setVisible(visible: boolean): void {
		this.visible = visible;
		if (!visible || this.request === undefined) return;
		if (this.shownKey === this.requestKey && !this.stale) return;
		this.ask(false);
	}

	/** The window came to the front. */
	focus(): void {
		if (!this.visible || this.request === undefined) return;
		const at = this.state.fetchedAt;
		if (at !== undefined && this.now() - at < FORGE_FOCUS_REFRESH_MS) return;
		this.ask(false);
	}

	/** The server says something may have changed. */
	changed(): void {
		if (this.request === undefined) return;
		if (this.visible) this.ask(false);
		else this.stale = true;
	}

	refresh(): void {
		if (this.request !== undefined) this.ask(true);
	}

	loadMore(): void {
		const request = this.request;
		const cursor = this.state.nextCursor;
		if (request === undefined || cursor === undefined || this.state.loadingMore) return;
		const generation = this.generation;
		this.publish({ ...this.state, loadingMore: true });
		this.fetch({ ...request, cursor }, `${this.key}:more`).then(
			(value) => {
				if (generation !== this.generation) return;
				const result = value as RawListResult;
				const { nextCursor: _previous, ...rest } = this.state;
				this.publish({
					...rest,
					items: [...this.state.items, ...result.items],
					sources: result.sources,
					...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
					loadingMore: false,
				});
			},
			(error: unknown) => {
				if (generation !== this.generation || superseded(error)) return;
				this.publish({ ...this.state, loadingMore: false, error: message(error) });
			},
		);
	}

	private ask(fresh: boolean): void {
		const request = this.request;
		if (request === undefined) return;
		const key = this.requestKey;
		const replacing = this.shownKey !== key;
		this.shownKey = key;
		this.stale = false;
		this.generation += 1;
		const generation = this.generation;
		const { error: _error, ...previous } = this.state;
		this.publish({ ...(replacing ? EMPTY_FORGE_LIST : previous), loading: true, loadingMore: false });
		this.fetch(fresh ? { ...request, fresh: true } : { ...request }, this.key).then(
			(value) => {
				if (generation !== this.generation) return;
				const result = value as RawListResult;
				this.publish({
					items: result.items,
					sources: result.sources,
					...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
					noAccounts: result.noAccounts === true,
					loading: false,
					loadingMore: false,
					fetchedAt: this.now(),
					settled: true,
				});
			},
			(error: unknown) => {
				if (generation !== this.generation || superseded(error)) return;
				this.publish({ ...this.state, loading: false, settled: true, error: message(error) });
			},
		);
	}

	private publish(state: ForgeListState): void {
		this.state = state;
		this.onState(state);
	}
}

/** The client's `ForgeSupersededError`, known by name so this module needs no runtime import. */
function superseded(error: unknown): boolean {
	return error instanceof Error && error.name === 'ForgeSupersededError';
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
