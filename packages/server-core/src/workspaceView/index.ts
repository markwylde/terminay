import { randomUUID } from 'node:crypto';
import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	RequestContext,
} from '../types.js';

/**
 * The workspace view relay (ADR-0070).
 *
 * Which project, folder, and tab a client shows, and how its panes are split
 * and sized, is that client's own state. An MCP caller that reads or changes
 * the view asks the one client it is talking from: the relay sends that
 * client an addressed event and waits for the command that answers it. The
 * client is where a change is applied, never what allows it, and its answer
 * is data the caller's adapter checks before anything reaches an agent.
 */

export const WORKSPACE_VIEW_OPERATIONS = Object.freeze({
	/** A connection says it can apply view requests. */
	attach: 'workspace-view.attach',
	/** The answer to one view request. */
	respond: 'workspace-view.respond',
} as const);

export const WORKSPACE_VIEW_EVENTS = Object.freeze({
	/** To one connection: `{ requestId, op, params }`. */
	request: 'workspace-view.request',
} as const);

/** Feature capability of a client that applies view requests. */
export const WORKSPACE_VIEW_CAPABILITY = 'workspace-view.v1';

export const WORKSPACE_VIEW_OPS = Object.freeze([
	'layout',
	'focus',
	'place',
	'resize',
	'arrange',
	'showProject',
	'selectFolder',
	'openFile',
	'closeTab',
	/** Present a workspace window (ADR-0072): a native window on Desktop, the
	 * shown view in a browser. */
	'presentView',
	/** Show Home, with one of its sections in front (ADR-0072). */
	'showHome',
] as const);
export type WorkspaceViewOp = (typeof WORKSPACE_VIEW_OPS)[number];

/** How long a client has to answer before the request fails. */
export const WORKSPACE_VIEW_TIMEOUT_MS = 10_000;
/** The largest answer a client may give. */
export const MAX_WORKSPACE_VIEW_REPLY_BYTES = 256 * 1024;
/** Requests one connection may have outstanding. */
export const MAX_PENDING_WORKSPACE_VIEW_REQUESTS = 32;

/** The client an agent is talking from, as the server knows it. */
export interface WorkspaceViewTarget {
	readonly clientId: string;
	/** Absent when only the client is known; any attached connection of it may answer. */
	readonly connectionId?: string;
}

export type WorkspaceViewErrorCode =
	/** No attached connection, it went away, or it did not answer in time. */
	| 'unavailable'
	| 'cancelled'
	/** The client could not do it; `reason` says why in the client's words. */
	| 'refused';

export class WorkspaceViewError extends Error {
	constructor(
		readonly code: WorkspaceViewErrorCode,
		message: string,
		/** For `refused`: the client's own bounded reason code. */
		readonly reason?: string,
	) {
		super(message);
		this.name = 'WorkspaceViewError';
	}
}

export interface WorkspaceViewRelayOptions {
	readonly eventJournal?: OrderedEventJournalLike;
	readonly timeoutMs?: number;
}

interface Attached {
	readonly clientId: string;
	readonly claims: JsonValue | undefined;
}

interface Pending {
	readonly connectionId: string;
	readonly resolve: (value: JsonValue) => void;
	readonly reject: (error: WorkspaceViewError) => void;
}

const CLIENT_REASON = /^[a-z_]{1,32}$/u;
const MAX_CLIENT_MESSAGE_CHARS = 512;

export class WorkspaceViewRelay {
	private readonly attached = new Map<string, Attached>();
	private readonly pending = new Map<string, Pending>();
	private readonly timeoutMs: number;

	constructor(private readonly options: WorkspaceViewRelayOptions = {}) {
		this.timeoutMs = options.timeoutMs ?? WORKSPACE_VIEW_TIMEOUT_MS;
	}

	/**
	 * The attached connection that answers for a target, if any. A target
	 * that names a connection is that connection or nothing: a client id is
	 * what a client says it is, so a second connection naming it is not it.
	 */
	connectionFor(target: WorkspaceViewTarget): string | undefined {
		if (target.connectionId !== undefined) {
			const attached = this.attached.get(target.connectionId);
			return attached?.clientId === target.clientId
				? target.connectionId
				: undefined;
		}
		let found: string | undefined;
		for (const [connectionId, attached] of this.attached)
			if (attached.clientId === target.clientId) found = connectionId;
		return found;
	}

	/** Whether the connection's authenticated boundary admits a project. */
	admits(connectionId: string, projectId: string): boolean {
		const claims = this.attached.get(connectionId)?.claims;
		if (typeof claims !== 'object' || claims === null || Array.isArray(claims))
			return true;
		const bound = (claims as Record<string, JsonValue>).projectId;
		return typeof bound !== 'string' || bound === projectId;
	}

	/**
	 * Ask the target's client to apply one view operation, and resolve with
	 * its answer. `projectId` is the project the operation acts on; a client
	 * whose connection is bound to another project is never asked.
	 */
	request(
		target: WorkspaceViewTarget,
		op: WorkspaceViewOp,
		params: JsonValue,
		projectId: string | undefined,
		signal?: AbortSignal,
	): Promise<JsonValue> {
		const connectionId = this.connectionFor(target);
		if (
			connectionId === undefined ||
			(projectId !== undefined && !this.admits(connectionId, projectId))
		)
			return Promise.reject(
				new WorkspaceViewError(
					'unavailable',
					'No Terminay window is available to show this. Open the project in a Terminay window and try again.',
				),
			);
		if (signal?.aborted)
			return Promise.reject(
				new WorkspaceViewError('cancelled', 'The view request was cancelled.'),
			);
		let outstanding = 0;
		for (const pending of this.pending.values())
			if (pending.connectionId === connectionId) outstanding += 1;
		if (outstanding >= MAX_PENDING_WORKSPACE_VIEW_REQUESTS)
			return Promise.reject(
				new WorkspaceViewError(
					'unavailable',
					'The Terminay window is busy with other view requests.',
				),
			);
		const requestId = randomUUID();
		return new Promise<JsonValue>((resolve, reject) => {
			const finish = (): void => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				this.pending.delete(requestId);
			};
			const onAbort = (): void => {
				finish();
				reject(
					new WorkspaceViewError('cancelled', 'The view request was cancelled.'),
				);
			};
			const timer = setTimeout(() => {
				finish();
				reject(
					new WorkspaceViewError(
						'unavailable',
						'The Terminay window did not answer in time.',
					),
				);
			}, this.timeoutMs);
			timer.unref?.();
			signal?.addEventListener('abort', onAbort, { once: true });
			this.pending.set(requestId, {
				connectionId,
				resolve: (value) => {
					finish();
					resolve(value);
				},
				reject: (error) => {
					finish();
					reject(error);
				},
			});
			this.options.eventJournal?.publishTransient(WORKSPACE_VIEW_EVENTS.request, {
				clientId: target.clientId,
				toConnectionId: connectionId,
				requestId,
				op,
				params,
			});
		});
	}

	/** Forget a connection, failing whatever it was asked and has not answered. */
	closeConnection(connectionId: string): void {
		this.attached.delete(connectionId);
		for (const pending of [...this.pending.values()])
			if (pending.connectionId === connectionId)
				pending.reject(
					new WorkspaceViewError(
						'unavailable',
						'The Terminay window closed before it answered.',
					),
				);
	}

	endAll(): void {
		this.attached.clear();
		for (const pending of [...this.pending.values()])
			pending.reject(
				new WorkspaceViewError('unavailable', 'The server is stopping.'),
			);
	}

	operations(): OperationRegistries {
		return {
			commands: {
				[WORKSPACE_VIEW_OPERATIONS.attach]: (request: CommandRequest) => {
					this.attached.set(request.context.connectionId, {
						clientId: request.context.clientId,
						claims: request.context.claims,
					});
					return { attached: true };
				},
				[WORKSPACE_VIEW_OPERATIONS.respond]: (request: CommandRequest) =>
					this.respond(request.envelope.payload, request.context),
			},
			policies: {
				[WORKSPACE_VIEW_OPERATIONS.attach]: { scope: 'read' },
				[WORKSPACE_VIEW_OPERATIONS.respond]: { scope: 'read' },
			},
		};
	}

	private respond(payload: JsonValue, context: RequestContext): JsonValue {
		const body = record(payload);
		const requestId = body?.requestId;
		if (typeof requestId !== 'string' || requestId.length > 64)
			throw protocolError('validation', 'requestId is required');
		const pending = this.pending.get(requestId);
		// Only the connection that was asked may answer, and an answer for a
		// request that has ended is simply late.
		if (pending === undefined || pending.connectionId !== context.connectionId)
			throw protocolError('not_found', 'no such view request is pending');
		let size: number;
		try {
			size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
		} catch {
			size = Number.POSITIVE_INFINITY;
		}
		if (size > MAX_WORKSPACE_VIEW_REPLY_BYTES) {
			pending.reject(
				new WorkspaceViewError(
					'unavailable',
					'The Terminay window answered with too much.',
				),
			);
			throw protocolError('validation', 'view reply is too large');
		}
		if (body?.ok === true) {
			pending.resolve((body.result ?? null) as JsonValue);
			return { accepted: true };
		}
		const error = record(body?.error);
		const reason =
			typeof error?.code === 'string' && CLIENT_REASON.test(error.code)
				? error.code
				: 'failed';
		const message =
			typeof error?.message === 'string'
				? error.message.slice(0, MAX_CLIENT_MESSAGE_CHARS)
				: 'The Terminay window could not do that.';
		pending.reject(new WorkspaceViewError('refused', message, reason));
		return { accepted: true };
	}
}

function record(value: unknown): Record<string, JsonValue> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, JsonValue>)
		: undefined;
}
