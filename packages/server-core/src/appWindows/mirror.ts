import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
	RequestContext,
} from '../types.js';

/**
 * The view mirror relay (ADR-0039).
 *
 * The client that controls a terminal records its windows' views; this relay
 * hands each recorded batch to the other clients watching that terminal. It
 * checks who may publish, bounds what is published, and keeps nothing: a batch
 * is gone once it has been handed to the event stream.
 */

export const APP_WINDOW_MIRROR_OPERATIONS = Object.freeze({
	status: 'app-windows.mirror.status',
	watch: 'app-windows.mirror.watch',
	unwatch: 'app-windows.mirror.unwatch',
	publish: 'app-windows.mirror.publish',
	resync: 'app-windows.mirror.resync',
} as const);

export const APP_WINDOW_MIRROR_EVENTS = Object.freeze({
	/** To a watcher: one recorded batch. */
	data: 'app-windows.mirror.data',
	/** To the controlling client: whether anyone is watching, or a snapshot is wanted. */
	wanted: 'app-windows.mirror.wanted',
} as const);

export const APP_WINDOW_MIRROR_CAPABILITY = 'app-window-mirror.v1';

/**
 * Why a request made for a view was refused: the caller does not hold the
 * terminal's presentation lease. A client whose lease merely lapsed renews it
 * and tries once more; any other refusal is final.
 */
export const NOT_CONTROLLER = 'not-controller';

/** One message of a snapshot. A snapshot of any size is sent as a run of these. */
export const MAX_APP_WINDOW_MIRROR_PART_BYTES = 512 * 1024;
/** One batch of changes. */
export const MAX_APP_WINDOW_MIRROR_BATCH_BYTES = 256 * 1024;
/** A snapshot of more parts than this is a runaway, not a view. */
export const MAX_APP_WINDOW_MIRROR_SNAPSHOT_PARTS = 128;

export type AppWindowMirrorKind = 'snapshot' | 'events' | 'unavailable';

/** The part of a window the relay needs. */
export interface AppWindowMirrorTarget {
	readonly id: string;
	readonly terminalSessionId: string;
	readonly projectId: string;
	readonly contentRevision: number;
}

export interface AppWindowMirrorRelayOptions {
	readonly eventJournal?: OrderedEventJournalLike;
	readonly window: (windowId: string) => AppWindowMirrorTarget | undefined;
	/** Any window of the session, to resolve its project. */
	readonly sessionWindow: (terminalSessionId: string) => AppWindowMirrorTarget | undefined;
	readonly isPresentationHolder: (window: AppWindowMirrorTarget, context: RequestContext) => boolean;
	/** The client that holds the session's interactive presentation lease now. */
	readonly presentationHolder: (window: AppWindowMirrorTarget) => string | undefined;
}

interface Session {
	/** connection id → client id of each watching connection. */
	readonly watchers: Map<string, string>;
	/** The holder that has been asked for a snapshot and has not sent one yet. */
	snapshotAskedOf?: string;
	/** Connections that have asked for the snapshot now outstanding. */
	readonly askedBy: Set<string>;
}


export class AppWindowMirrorRelay {
	private readonly sessions = new Map<string, Session>();

	constructor(private readonly options: AppWindowMirrorRelayOptions) {}

	/** The connections watching a session, other than those of `holder`, each with its client. */
	private audience(terminalSessionId: string, holder: string | undefined): Map<string, string> {
		const watching = new Map<string, string>();
		for (const [connectionId, clientId] of this.sessions.get(terminalSessionId)?.watchers ?? [])
			if (clientId !== holder) watching.set(connectionId, clientId);
		return watching;
	}

	/** Whether the controlling client should be recording this session's views. */
	wanted(terminalSessionId: string): boolean {
		const window = this.options.sessionWindow(terminalSessionId);
		const holder = window === undefined ? undefined : this.options.presentationHolder(window);
		return this.audience(terminalSessionId, holder).size > 0;
	}

	/** Forget a connection's watches, as when it closes. */
	closeConnection(connectionId: string): void {
		for (const [terminalSessionId, session] of this.sessions) {
			if (!session.watchers.delete(connectionId)) continue;
			this.afterWatchersChanged(terminalSessionId, true);
		}
	}

	endSession(terminalSessionId: string): void {
		this.sessions.delete(terminalSessionId);
	}

	/** Every window has ended: nobody is watching anything. */
	endAll(): void {
		this.sessions.clear();
	}

	operations(): OperationRegistries {
		return {
			queries: {
				[APP_WINDOW_MIRROR_OPERATIONS.status]: async (request: QueryRequest) => {
					const terminalSessionId = this.boundedSession(request);
					// The controlling client asks this as it starts a view, which is
					// also when a snapshot request it may have missed stops mattering.
					const session = this.sessions.get(terminalSessionId);
					if (session?.snapshotAskedOf === request.context.clientId) {
						delete session.snapshotAskedOf;
						session.askedBy.clear();
					}
					return asJson({ terminalSessionId, wanted: this.wanted(terminalSessionId) });
				},
			},
			commands: {
				[APP_WINDOW_MIRROR_OPERATIONS.watch]: async (request: CommandRequest) => {
					const terminalSessionId = this.boundedSession(request);
					// A client that cannot draw a mirror must not start a recording.
					if (
						request.context.clientCapabilities?.includes(
							APP_WINDOW_MIRROR_CAPABILITY,
						) !== true
					)
						throw protocolError('unavailable', 'this client cannot show a mirror');
					if (this.options.sessionWindow(terminalSessionId) === undefined)
						throw protocolError('not_found', 'this terminal has no windows');
					const session = this.session(terminalSessionId);
					const before = this.wanted(terminalSessionId);
					session.watchers.set(request.context.connectionId, request.context.clientId);
					session.askedBy.add(request.context.connectionId);
					// Someone new is watching: they need a snapshot whether or not
					// recording was already running.
					this.askForSnapshot(terminalSessionId, !before);
					return asJson({ terminalSessionId, watching: true });
				},
				[APP_WINDOW_MIRROR_OPERATIONS.unwatch]: async (request: CommandRequest) => {
					const terminalSessionId = this.boundedSession(request);
					const session = this.sessions.get(terminalSessionId);
					if (session?.watchers.delete(request.context.connectionId) === true)
						this.afterWatchersChanged(terminalSessionId, true);
					return asJson({ terminalSessionId, watching: false });
				},
				[APP_WINDOW_MIRROR_OPERATIONS.resync]: async (request: CommandRequest) => {
					const terminalSessionId = this.boundedSession(request);
					const session = this.sessions.get(terminalSessionId);
					if (session?.watchers.has(request.context.connectionId) !== true)
						throw protocolError('forbidden', 'this connection is not watching that terminal');
					// Requests from different watchers for the same snapshot are one
					// request. A watcher asking again has waited and got nothing, so
					// its request goes through: the first may have been lost, or the
					// controlling client may not have been able to record yet.
					const again = session.askedBy.has(request.context.connectionId);
					session.askedBy.add(request.context.connectionId);
					this.askForSnapshot(terminalSessionId, again);
					return asJson({ terminalSessionId });
				},
				[APP_WINDOW_MIRROR_OPERATIONS.publish]: async (request: CommandRequest) => {
					const payload = record(request.envelope.payload);
					const windowId = payload?.windowId;
					const window =
						typeof windowId === 'string' && windowId.length <= 128
							? this.options.window(windowId)
							: undefined;
					if (window === undefined) throw protocolError('not_found', 'window no longer exists');
					if (!this.options.isPresentationHolder(window, request.context))
						throw protocolError(
							'forbidden',
							'only the client controlling this terminal can publish its views',
							{ details: { reason: NOT_CONTROLLER } },
						);
					const { epoch, seq, kind, reason, parts } = payload ?? {};
					if (
						parts !== undefined &&
						(kind !== 'snapshot' ||
							!Number.isSafeInteger(parts) ||
							(parts as number) < 2 ||
							(parts as number) > MAX_APP_WINDOW_MIRROR_SNAPSHOT_PARTS)
					)
						throw protocolError('validation', 'mirror batch parts are invalid');
					if (kind !== 'snapshot' && kind !== 'events' && kind !== 'unavailable')
						throw protocolError('validation', 'mirror batch kind is invalid');
					if (!isCounter(epoch) || !isCounter(seq))
						throw protocolError('validation', 'mirror batch position is invalid');
					if (reason !== undefined && reason !== 'too-large' && reason !== 'too-busy')
						throw protocolError('validation', 'mirror batch reason is invalid');
					// The recording itself is the request's body: bytes the relay
					// measures and passes on, and never reads.
					const limit =
						kind === 'snapshot' ? MAX_APP_WINDOW_MIRROR_PART_BYTES : MAX_APP_WINDOW_MIRROR_BATCH_BYTES;
					if (request.body.byteLength > limit)
						throw protocolError('validation', 'mirror batch is too large');
					const session = this.sessions.get(window.terminalSessionId);
					if (session !== undefined && kind !== 'events') {
						delete session.snapshotAskedOf;
						session.askedBy.clear();
					}
					const audience = this.audience(window.terminalSessionId, request.context.clientId);
					// Addressed to the connection that asked to watch, not to whoever
					// names the same client: a recording is as private as the terminal.
					for (const [toConnectionId, clientId] of audience)
						this.options.eventJournal?.publishTransient(
							APP_WINDOW_MIRROR_EVENTS.data,
							asJson({
								clientId,
								toConnectionId,
								windowId: window.id,
								terminalSessionId: window.terminalSessionId,
								contentRevision: window.contentRevision,
								epoch,
								seq,
								kind,
								...(parts === undefined ? {} : { parts }),
								...(reason === undefined ? {} : { reason }),
							}),
							request.body,
						);
					return asJson({ windowId: window.id, delivered: audience.size });
				},
			},
			policies: {
				[APP_WINDOW_MIRROR_OPERATIONS.status]: { scope: 'read' },
				[APP_WINDOW_MIRROR_OPERATIONS.watch]: { scope: 'read' },
				[APP_WINDOW_MIRROR_OPERATIONS.unwatch]: { scope: 'read' },
				[APP_WINDOW_MIRROR_OPERATIONS.resync]: { scope: 'read' },
				[APP_WINDOW_MIRROR_OPERATIONS.publish]: { scope: 'write' },
			},
		};
	}

	/** The terminal session a request names, refused when it is outside the caller's boundary. */
	private boundedSession(request: QueryRequest | CommandRequest): string {
		const terminalSessionId = sessionId(request);
		const window = this.options.sessionWindow(terminalSessionId);
		const claims = record(request.context.claims);
		const bound =
			typeof claims?.projectId === 'string' || typeof claims?.sessionId === 'string';
		if (
			// A terminal with no windows has no project to compare a bound client
			// against. Every operation answers such a client the same way, whether
			// the terminal is another project's or simply has no windows.
			(window === undefined && bound) ||
			(window !== undefined && !withinClientBoundary(request.context, window))
		)
			// The same answer as for a terminal with no windows, so that whether
			// another project's terminal has any is not something a client can learn.
			throw protocolError('not_found', 'this terminal has no windows');
		return terminalSessionId;
	}

	private session(terminalSessionId: string): Session {
		let session = this.sessions.get(terminalSessionId);
		if (session === undefined) {
			session = { watchers: new Map(), askedBy: new Set() };
			this.sessions.set(terminalSessionId, session);
		}
		return session;
	}

	private holder(terminalSessionId: string): string | undefined {
		const window = this.options.sessionWindow(terminalSessionId);
		return window === undefined ? undefined : this.options.presentationHolder(window);
	}

	/** Tell the controlling client that a snapshot is wanted, once until it sends one. */
	private askForSnapshot(terminalSessionId: string, force: boolean): void {
		const holder = this.holder(terminalSessionId);
		const session = this.session(terminalSessionId);
		if (holder === undefined || this.audience(terminalSessionId, holder).size === 0) return;
		if (!force && session.snapshotAskedOf === holder) return;
		session.snapshotAskedOf = holder;
		this.tellHolder(terminalSessionId, holder, true);
	}

	private afterWatchersChanged(terminalSessionId: string, mayStop: boolean): void {
		const session = this.sessions.get(terminalSessionId);
		if (session === undefined) return;
		const holder = this.holder(terminalSessionId);
		if (mayStop && this.audience(terminalSessionId, holder).size === 0) {
			delete session.snapshotAskedOf;
			if (holder !== undefined) this.tellHolder(terminalSessionId, holder, false);
		}
		if (session.watchers.size === 0) this.sessions.delete(terminalSessionId);
	}

	private tellHolder(terminalSessionId: string, holder: string, wanted: boolean): void {
		this.options.eventJournal?.publishTransient(
			APP_WINDOW_MIRROR_EVENTS.wanted,
			asJson({ clientId: holder, terminalSessionId, wanted }),
		);
	}
}

/**
 * Whether a connection's authenticated boundary admits a terminal. A client
 * bound to one project, or to one terminal session, may not see or touch the
 * windows of another, exactly as it may not attach to that terminal.
 */
export function withinClientBoundary(
	context: Pick<RequestContext, 'claims'>,
	target: { readonly projectId: string; readonly terminalSessionId: string },
): boolean {
	const claims = context.claims;
	if (typeof claims !== 'object' || claims === null || Array.isArray(claims))
		return true;
	if (typeof claims.projectId === 'string' && claims.projectId !== target.projectId)
		return false;
	if (
		typeof claims.sessionId === 'string' &&
		claims.sessionId !== target.terminalSessionId
	)
		return false;
	return true;
}

function sessionId(request: QueryRequest | CommandRequest): string {
	const value = record(request.envelope.payload)?.terminalSessionId;
	if (typeof value !== 'string' || value.length === 0 || value.length > 128)
		throw protocolError('validation', 'terminal session id is invalid');
	return value;
}

function isCounter(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function record(value: unknown): Record<string, JsonValue> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, JsonValue>)
		: undefined;
}

function asJson(value: unknown): JsonValue {
	return value as JsonValue;
}
