/**
 * One server's view mirror, as the workspace uses it (ADR-0039).
 *
 * On the client that controls a terminal, the hub tells each running view when
 * to record and hands its batches to the server. On every other client it
 * watches the terminal, puts the batches it receives back in order, and gives
 * them to the mirror that draws them. A mirror is either in step or loading:
 * a batch that does not follow the last one is never applied.
 */
import type { AppWindowClient, AppWindowMirrorBatch, AppWindowMirrorData } from '@terminay/client-core';
import type { FieldState } from './fieldState.ts';

export type MirrorHubClient = Pick<
	AppWindowClient,
	| 'mirrorWanted'
	| 'watchMirror'
	| 'unwatchMirror'
	| 'resyncMirror'
	| 'publishMirror'
	| 'onMirrorData'
	| 'onMirrorWanted'
>;

/** A running view that can be told to record. */
export interface MirrorRecorder {
	/** Record, or send a fresh snapshot if already recording. */
	start(): void;
	stop(): void;
}

/** A mirror that draws what it is given. */
export interface MirrorSink {
	apply(kind: 'snapshot' | 'events', data: string): void;
	/** The mirror is out of step and waiting for a snapshot. */
	loading(): void;
	/** The view cannot be mirrored for now. */
	unavailable(): void;
}

type Position = {
	epoch: number;
	next: number;
	/** A snapshot arriving in parts: what has come so far, and how many there are. */
	pending?: { readonly parts: number; readonly chunks: string[] };
};

interface Watched {
	readonly sink: MirrorSink;
	position: Position | undefined;
}

interface WatchedSession {
	readonly windows: Map<string, Watched>;
	/** A snapshot has been asked for and has not arrived. */
	resyncing: boolean;
	/** Snapshots asked for in a row without one arriving whole. */
	attempts: number;
}

/**
 * How many times in a row a mirror asks again before it gives up. A connection
 * that cannot carry a snapshot before the next gap would otherwise ask forever.
 */
const MAX_RESYNC_ATTEMPTS = 4;
/**
 * How long a mirror waits for a snapshot it asked for before asking again. The
 * request, or the snapshot, can be lost; without this a mirror would wait for
 * ever. It is one wait per request, and it stops after the attempts above.
 */
const SNAPSHOT_WAIT_MS = 5000;

/**
 * How long after a mirror stops what it last showed can still be carried into
 * a view that starts here. Taking control replaces the mirror with the view at
 * once; anything older is a view this client stopped looking at.
 */
const CARRY_OVER_MS = 30_000;

export interface MirrorHubOptions {
	readonly snapshotWaitMs?: number;
	/** The clock, replaceable in tests. */
	readonly now?: () => number;
	/** The timer, replaceable in tests. */
	readonly setTimer?: (run: () => void, ms: number) => unknown;
	readonly clearTimer?: (timer: unknown) => void;
}

const stateKey = (sessionId: string, windowId: string): string => `${sessionId}\n${windowId}`;

export class AppWindowMirrorHub {
	private readonly recorders = new Map<string, Map<string, MirrorRecorder>>();
	private readonly wanted = new Map<string, boolean>();
	private readonly watched = new Map<string, WatchedSession>();
	private readonly subscriptions: (() => void)[] = [];
	private disposed = false;

	private readonly client: MirrorHubClient;
	private readonly options: MirrorHubOptions;
	/** The wait for each watched terminal's outstanding snapshot. */
	private readonly waits = new Map<string, unknown>();
	/** What each mirrored view's controls held, and when its mirror stopped. */
	private readonly states = new Map<string, { state: FieldState; stoppedAt?: number }>();

	constructor(client: MirrorHubClient, options: MirrorHubOptions = {}) {
		this.client = client;
		this.options = options;
		this.subscriptions.push(
			client.onMirrorWanted((sessionId, wanted) => this.setWanted(sessionId, wanted)),
			client.onMirrorData(
				(data) => this.receive(data),
				() => this.lostEvents(),
			),
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of this.subscriptions) unsubscribe();
		for (const sessionId of this.watched.keys()) {
			this.stopWaiting(sessionId);
			void this.client.unwatchMirror(sessionId).catch(() => {});
		}
		this.watched.clear();
		this.recorders.clear();
		this.states.clear();
	}

	// --- the controlling client ---

	/** A view started on this client. It records while someone is watching. */
	registerRecorder(sessionId: string, windowId: string, recorder: MirrorRecorder): () => void {
		let session = this.recorders.get(sessionId);
		if (session === undefined) {
			session = new Map();
			this.recorders.set(sessionId, session);
		}
		session.set(windowId, recorder);
		if (this.wanted.get(sessionId) === true) recorder.start();
		// What the server last said may predate this client taking control.
		void this.client
			.mirrorWanted(sessionId)
			.then((wanted) => {
				if (this.disposed || this.recorders.get(sessionId)?.get(windowId) !== recorder) return;
				const before = this.wanted.get(sessionId);
				this.wanted.set(sessionId, wanted);
				if (wanted && before !== true) recorder.start();
				else if (!wanted && before === true) this.setWanted(sessionId, false);
			})
			.catch(() => {});
		return () => {
			const current = this.recorders.get(sessionId);
			if (current?.get(windowId) !== recorder) return;
			current.delete(windowId);
			if (current.size === 0) {
				this.recorders.delete(sessionId);
				this.wanted.delete(sessionId);
			}
		};
	}

	/** Hand one recorded batch to the server. Rejects when this client may not publish. */
	publish(windowId: string, batch: AppWindowMirrorBatch): Promise<void> {
		return this.client.publishMirror(windowId, batch);
	}

	private setWanted(sessionId: string, wanted: boolean): void {
		const recorders = this.recorders.get(sessionId);
		if (recorders === undefined) return;
		this.wanted.set(sessionId, wanted);
		for (const recorder of recorders.values()) {
			if (wanted) recorder.start();
			else recorder.stop();
		}
	}

	// --- a client that observes ---

	/** Show a window of a terminal this client does not control. */
	watch(sessionId: string, windowId: string, sink: MirrorSink): () => void {
		let session = this.watched.get(sessionId);
		const first = session === undefined;
		if (session === undefined) {
			session = { windows: new Map(), resyncing: true, attempts: 0 };
			this.watched.set(sessionId, session);
		}
		const entry: Watched = { sink, position: undefined };
		session.windows.set(windowId, entry);
		sink.loading();
		// Watching asks the controlling client for a snapshot of every view; a
		// window joining a terminal already watched has to ask for itself.
		if (first) {
			this.waitForSnapshot(sessionId);
			void this.client.watchMirror(sessionId).catch(() => sink.unavailable());
		}
		else this.resync(sessionId);
		return () => {
			const current = this.watched.get(sessionId);
			if (current?.windows.get(windowId) !== entry) return;
			current.windows.delete(windowId);
			const held = this.states.get(stateKey(sessionId, windowId));
			if (held !== undefined) held.stoppedAt = this.now();
			if (current.windows.size > 0) return;
			this.watched.delete(sessionId);
			this.stopWaiting(sessionId);
			if (!this.disposed) void this.client.unwatchMirror(sessionId).catch(() => {});
		};
	}

	/** Ask for a fresh snapshot of a watched terminal's views, once until one arrives. */
	resync(sessionId: string): void {
		const session = this.watched.get(sessionId);
		if (session === undefined || session.resyncing) return;
		if (session.attempts >= MAX_RESYNC_ATTEMPTS) {
			// This connection is not keeping up. Say so instead of asking forever;
			// the next snapshot that does arrive whole brings the mirror back.
			for (const entry of session.windows.values()) entry.sink.unavailable();
			return;
		}
		session.attempts += 1;
		session.resyncing = true;
		this.waitForSnapshot(sessionId);
		void this.client.resyncMirror(sessionId).catch(() => {
			session.resyncing = false;
		});
	}

	/** Having asked for a snapshot, ask again if none has come after a while. */
	private waitForSnapshot(sessionId: string): void {
		this.stopWaiting(sessionId);
		const set = this.options.setTimer ?? ((run, ms) => setTimeout(run, ms));
		this.waits.set(
			sessionId,
			set(() => {
				this.waits.delete(sessionId);
				const session = this.watched.get(sessionId);
				if (this.disposed || session === undefined) return;
				// Still waiting for a snapshot that was asked for, or for the rest
				// of one whose first parts came and whose last never did.
				const partial = [...session.windows.values()].filter(
					(entry) => entry.position?.pending !== undefined,
				);
				if (!session.resyncing && partial.length === 0) return;
				for (const entry of partial) {
					entry.position = undefined;
					entry.sink.loading();
				}
				session.resyncing = false;
				this.resync(sessionId);
			}, this.options.snapshotWaitMs ?? SNAPSHOT_WAIT_MS),
		);
	}

	private stopWaiting(sessionId: string): void {
		const timer = this.waits.get(sessionId);
		if (timer === undefined) return;
		this.waits.delete(sessionId);
		(this.options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(timer);
	}

	/** A mirror says what the view it shows holds: what was typed, ticked, chosen, and where it is scrolled. */
	rememberState(sessionId: string, windowId: string, state: FieldState): void {
		// Only a mirror being shown has anything to say.
		if (this.watched.get(sessionId)?.windows.has(windowId) !== true) return;
		this.forgetStale();
		this.states.set(stateKey(sessionId, windowId), { state });
	}

	/**
	 * A view is starting on this client. If this client was mirroring that
	 * window until a moment ago, it has just taken control: what the mirror
	 * showed is handed over, once, to be put into the new view.
	 */
	takeState(sessionId: string, windowId: string): FieldState | undefined {
		this.forgetStale();
		const key = stateKey(sessionId, windowId);
		const held = this.states.get(key);
		if (held === undefined || held.stoppedAt === undefined) return undefined;
		this.states.delete(key);
		return held.state;
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private forgetStale(): void {
		const now = this.now();
		for (const [key, held] of this.states)
			if (held.stoppedAt !== undefined && now - held.stoppedAt > CARRY_OVER_MS) this.states.delete(key);
	}

	/** A mirror drew the snapshot it was given: whatever went wrong before is over. */
	drawn(sessionId: string): void {
		const session = this.watched.get(sessionId);
		if (session !== undefined) session.attempts = 0;
	}

	/** A mirror could not draw what it was given. */
	failed(sessionId: string, windowId: string): void {
		const entry = this.watched.get(sessionId)?.windows.get(windowId);
		if (entry === undefined) return;
		entry.position = undefined;
		entry.sink.loading();
		this.resync(sessionId);
	}

	private receive(data: AppWindowMirrorData): void {
		const session = this.watched.get(data.terminalSessionId);
		const entry = session?.windows.get(data.windowId);
		if (session === undefined || entry === undefined) return;
		if (data.kind === 'unavailable' || (data.kind === 'snapshot' && data.seq === 0)) {
			session.resyncing = false;
			this.stopWaiting(data.terminalSessionId);
		}
		if (data.kind === 'unavailable') {
			entry.position = undefined;
			entry.sink.unavailable();
			return;
		}
		// A snapshot that has arrived is not yet one that could be drawn: the
		// count of attempts is cleared by `drawn`, when the mirror says it was.
		const complete = (snapshot: string): void => {
			this.stopWaiting(data.terminalSessionId);
			entry.sink.apply('snapshot', snapshot);
		};
		if (data.kind === 'snapshot' && data.seq === 0) {
			// Every snapshot is the new truth. Epochs only pair changes with their
			// snapshot; a new document, or a new controlling client, counts from one.
			const parts = data.parts ?? 1;
			if (parts === 1) {
				entry.position = { epoch: data.epoch, next: 1 };
				complete(data.data);
			} else {
				// The mirror keeps showing what it had until the whole snapshot is
				// here, and does not wait for the rest of it for ever.
				entry.position = { epoch: data.epoch, next: 1, pending: { parts, chunks: [data.data] } };
				this.waitForSnapshot(data.terminalSessionId);
			}
			return;
		}
		const position = entry.position;
		if (position !== undefined && data.epoch === position.epoch) {
			if (data.seq < position.next) return;
			const pending = position.pending;
			if (data.seq === position.next && data.kind === 'snapshot' && pending !== undefined) {
				position.next += 1;
				pending.chunks.push(data.data);
				// Each part that arrives is progress; the wait starts again.
				this.waitForSnapshot(data.terminalSessionId);
				if (pending.chunks.length === pending.parts) {
					delete position.pending;
					complete(pending.chunks.join(''));
				}
				return;
			}
			// Changes apply only to a snapshot that has arrived whole.
			if (data.seq === position.next && data.kind === 'events' && pending === undefined) {
				position.next += 1;
				entry.sink.apply('events', data.data);
				return;
			}
		}
		// A gap, or changes to a snapshot this mirror never had.
		entry.position = undefined;
		entry.sink.loading();
		this.resync(data.terminalSessionId);
	}

	/** The connection dropped events: no mirror can be trusted to be in step. */
	private lostEvents(): void {
		for (const [sessionId, session] of this.watched) {
			for (const entry of session.windows.values()) {
				entry.position = undefined;
				entry.sink.loading();
			}
			session.resyncing = false;
			this.resync(sessionId);
		}
	}
}
