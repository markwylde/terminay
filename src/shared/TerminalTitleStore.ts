import type { TerminayClient } from '@terminay/client-core';

const TITLES_EVENT = 'terminal-titles';
const TITLES_SNAPSHOT = 'terminal-titles.snapshot';

/**
 * The title each terminal displays, as the server resolved and published it
 * (ADR-0058): a name a person gave the terminal, else the title its program
 * set, else its default name.
 *
 * This is not workspace state. A program rewrites its title every second, and
 * a title that travelled with the workspace projection would wake everything
 * that reads it. Here a title is heard by whoever shows that one terminal, and
 * by nobody else: each listener subscribes to one panel.
 *
 * A server that does not publish titles leaves the store empty, and a caller
 * falls back to the title the workspace projection holds for the panel.
 */
export class TerminalTitleStore {
	private readonly titles = new Map<string, string>();
	private readonly listeners = new Map<string, Set<() => void>>();
	private readonly anyListeners = new Set<() => void>();
	/** Panels an event named while a snapshot was being fetched. The event is
	 * newer than the snapshot's answer for that panel, so it wins. */
	private touched: Set<string> | null = null;
	private unsubscribe: (() => Promise<void>) | undefined;
	private closed = false;

	constructor(
		private readonly options: Readonly<{
			client: Pick<TerminayClient, 'query' | 'subscribe'>;
			/** Whether the server negotiated the title projection. */
			enabled: boolean;
		}>,
	) {}

	/** Subscribe, then load every title. The subscription comes first so a
	 * title that changes while the snapshot is in flight is not lost. */
	async start(): Promise<void> {
		if (!this.options.enabled || this.closed || this.unsubscribe !== undefined)
			return;
		const subscription = await this.options.client.subscribe(TITLES_EVENT);
		const removeEvent = subscription.onEvent((event) =>
			this.applyEvent(event.payload),
		);
		const removeResync = subscription.onResync(() => {
			void this.load().catch(() => undefined);
		});
		this.unsubscribe = async () => {
			removeEvent();
			removeResync();
			await subscription.unsubscribe();
		};
		await this.load();
	}

	/** The title the terminal in `panelId` displays, when the server has
	 * published one. */
	title(panelId: string): string | undefined {
		return this.titles.get(panelId);
	}

	/** Hear changes to one terminal's title, and to no other's. */
	subscribe(panelId: string, listener: () => void): () => void {
		let heard = this.listeners.get(panelId);
		if (heard === undefined) {
			heard = new Set();
			this.listeners.set(panelId, heard);
		}
		heard.add(listener);
		return () => {
			const current = this.listeners.get(panelId);
			if (current === undefined) return;
			current.delete(listener);
			if (current.size === 0) this.listeners.delete(panelId);
		};
	}

	/** Hear every title change. For a view that lists many terminals by title
	 * and re-reads only the rows it shows; a single tab uses `subscribe`. */
	subscribeAny(listener: () => void): () => void {
		this.anyListeners.add(listener);
		return () => this.anyListeners.delete(listener);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		void this.unsubscribe?.().catch(() => undefined);
		this.unsubscribe = undefined;
		this.listeners.clear();
		this.anyListeners.clear();
	}

	private async load(): Promise<void> {
		const touched = new Set<string>();
		this.touched = touched;
		let result: unknown;
		try {
			result = (await this.options.client.query(TITLES_SNAPSHOT, {})).result;
		} finally {
			if (this.touched === touched) this.touched = null;
		}
		if (this.closed) return;
		const entries = isRecord(result) && isRecord(result.titles)
			? result.titles
			: {};
		const changed = new Set<string>();
		for (const panelId of [...this.titles.keys()])
			if (!touched.has(panelId) && !Object.hasOwn(entries, panelId)) {
				this.titles.delete(panelId);
				changed.add(panelId);
			}
		for (const [panelId, entry] of Object.entries(entries)) {
			if (touched.has(panelId)) continue;
			if (!isRecord(entry) || typeof entry.title !== 'string') continue;
			if (this.titles.get(panelId) === entry.title) continue;
			this.titles.set(panelId, entry.title);
			changed.add(panelId);
		}
		this.notify(changed);
	}

	private applyEvent(payload: unknown): void {
		if (this.closed || !isRecord(payload)) return;
		const panelId = payload.panelId;
		if (typeof panelId !== 'string') return;
		this.touched?.add(panelId);
		if (payload.removed === true) {
			if (!this.titles.delete(panelId)) return;
		} else {
			if (typeof payload.title !== 'string') return;
			if (this.titles.get(panelId) === payload.title) return;
			this.titles.set(panelId, payload.title);
		}
		this.notify([panelId]);
	}

	private notify(panelIds: Iterable<string>): void {
		let any = false;
		for (const panelId of panelIds) {
			any = true;
			for (const listener of [...(this.listeners.get(panelId) ?? [])])
				listener();
		}
		if (any) for (const listener of [...this.anyListeners]) listener();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
