import type { JsonValue } from '@terminay/protocol';
import type {
	ClientCommandResult,
	ClientSubscription,
	CommandOptions,
	SubscriptionOptions,
} from './types.js';

/** The exact server/project/session identity carried by every terminal call. */
export interface TerminalClientIdentity {
	readonly serverId: string;
	readonly projectId: string;
	readonly sessionId: string;
}

export interface TerminalClientAuthorization extends TerminalClientIdentity {
	readonly clientId?: string;
	readonly scope?: 'none' | 'read' | 'write' | 'admin';
}

export interface TerminalClientAttachRequest extends TerminalClientIdentity {
	readonly clientId: string;
	readonly authorization?: TerminalClientAuthorization;
	/** Last byte position observed by this client. Defaults to zero. */
	readonly fromPosition?: number;
	/**
	 * Upper bound for retained output included in the synchronous attach
	 * response. Live output still streams normally after attachment.
	 */
	readonly maxInitialReplayBytes?: number;
	/** True only when attaching a newly-created blank emulator. It forces a
	 * complete position-zero presentation instead of using reconnect state. */
	readonly freshPresentation?: boolean;
}

export interface TerminalClientCreateRequest {
	readonly projectId: string;
	/** One-off server-owned profile selection. No executable or environment is
	 * accepted at this boundary. */
	readonly profileId?: string;
	/** Authoritative panel identity used by the server cwd policy. */
	readonly activePanelId?: string;
	readonly cwd?: string;
	readonly cols?: number;
	readonly rows?: number;
}

export interface TerminalClientSession extends TerminalClientIdentity {
	readonly cwd: string;
	readonly launch?: Readonly<{
		profileId: string;
		profileRevision: number;
		profileName: string;
		targetSummary: string;
		workspaceRevision: number;
		settingsRevision: number;
		icon?: string;
		color?: string;
	}>;
	readonly status: 'running' | 'exited' | 'interrupted';
	readonly createdAt: number;
	readonly outputPosition: number;
	readonly replayFrom: number;
	readonly dimensions: TerminalDimensions;
	readonly pid?: number;
}

export interface TerminalClientListResult {
	readonly serverId: string;
	readonly projectId: string;
	readonly sessions: readonly TerminalClientSession[];
}

/** JSON event representation used by the application protocol. */
export type TerminalWireEvent =
	| TerminalWireOutputEvent
	| TerminalWireExitEvent
	| TerminalWireResyncEvent
	| TerminalWirePresentationEvent
	| TerminalWirePresentationUnavailableEvent;

export interface TerminalPresentationState extends TerminalClientIdentity {
	readonly revision: number;
	readonly role: 'controller' | 'read_only';
	readonly holder?: Readonly<{ clientId: string; attachmentId: string; leaseExpiresAt: number }>;
}

export interface TerminalWirePresentationEvent extends TerminalPresentationState { readonly type: 'presentation'; readonly action?: string; }
export interface TerminalWirePresentationUnavailableEvent extends TerminalClientIdentity {
	readonly type: 'presentation_unavailable';
	readonly requestedFromPosition: number;
	readonly replayFrom: number;
	readonly outputPosition: number;
}

export interface TerminalWireOutputEvent extends TerminalClientIdentity {
	readonly type: 'output';
	readonly position: number;
	readonly nextPosition: number;
	readonly replay?: boolean;
	/** Base64 bytes when the event has no binary frame body. */
	readonly bytes?: string;
}

export interface TerminalWireExitEvent extends TerminalClientIdentity {
	readonly type: 'exit';
	readonly exitCode: number;
	readonly signal: number | null;
	readonly reason?: string;
	readonly at?: number;
}

export interface TerminalWireResyncEvent extends TerminalClientIdentity {
	readonly type: 'resync_required';
	readonly fromPosition: number;
	readonly replayFrom: number;
	readonly outputPosition: number;
}

export interface TerminalStreamOutputEvent extends TerminalClientIdentity {
	readonly type: 'output';
	readonly position: number;
	readonly nextPosition: number;
	readonly bytes: Uint8Array;
	readonly replay: boolean;
}

export interface TerminalStreamExitEvent extends TerminalClientIdentity {
	readonly type: 'exit';
	readonly exitCode: number;
	readonly signal: number | null;
	readonly reason?: string;
	readonly at?: number;
}

export interface TerminalStreamResyncEvent extends TerminalClientIdentity {
	readonly type: 'resync_required';
	readonly fromPosition: number;
	readonly replayFrom: number;
	readonly outputPosition: number;
}

export type TerminalStreamEvent =
	| TerminalStreamOutputEvent
	| TerminalStreamExitEvent
	| TerminalStreamResyncEvent
	| TerminalWirePresentationEvent
	| TerminalWirePresentationUnavailableEvent;

export interface TerminalAttachResult {
	readonly attachmentId: string;
	readonly fromPosition: number;
	readonly position: number;
	readonly events?: readonly TerminalWireEvent[];
	readonly presentation: TerminalPresentationState;
}

export interface TerminalClientTransport {
	readonly query?: <T extends JsonValue = JsonValue>(
		operation: string,
		payload?: JsonValue,
		options?: CommandOptions,
	) => Promise<{ readonly result?: T }>;
	readonly command: <T extends JsonValue = JsonValue>(
		operation: string,
		payload?: JsonValue,
		options?: CommandOptions,
	) => Promise<ClientCommandResult<T> | T>;
	readonly subscribe: <T = JsonValue>(
		event: string | undefined,
		options?: SubscriptionOptions,
	) => Promise<ClientSubscription<T>>;
}

export interface TerminalClientAttachment {
	readonly attachmentId: string;
	readonly identity: TerminalClientIdentity;
	readonly initialEvents: readonly TerminalStreamEvent[];
	readonly position: number;
	readonly closed: boolean;
	readonly presentation: TerminalPresentationState;
	readonly onEvent: (
		listener: (event: TerminalStreamEvent) => void,
	) => () => void;
	readonly ack: (position: number, options?: CommandOptions) => Promise<void>;
	/** Send input through the exact attachment/session authorization boundary. */
	readonly write: (
		data: Uint8Array | string,
		options?: CommandOptions,
	) => Promise<void>;
	/** Resize only the session represented by this attachment. */
	readonly resize: (
		dimensions: TerminalDimensions,
		options?: CommandOptions,
	) => Promise<void>;
	readonly changePresentation: (mode: 'acquire' | 'renew' | 'takeover' | 'release', options?: CommandOptions) => Promise<TerminalPresentationState>;
	/** Request termination of the attached session. */
	readonly kill: (
		signal?: number | string,
		options?: CommandOptions,
	) => Promise<void>;
	readonly detach: (options?: CommandOptions) => Promise<void>;
}

export interface TerminalDimensions {
	readonly cols: number;
	readonly rows: number;
}

interface MutableAttachment {
	readonly id: string;
	readonly identity: TerminalClientIdentity;
	readonly clientId: string;
	readonly listeners: Set<(event: TerminalStreamEvent) => void>;
	readonly subscription: ClientSubscription<TerminalWireEvent>;
	unsubscribeEvent: () => void;
	readonly initialEvents: TerminalStreamEvent[];
	position: number;
	presentation: TerminalPresentationState;
	closed: boolean;
	detached: Promise<void> | undefined;
}

/**
 * Transport-neutral terminal client contract.
 *
 * A local socket, browser transport, and remote WebRTC transport all expose
 * the same command/subscription surface to this class. The implementation
 * keeps per-client/session high-water marks so a stale reconnect cursor cannot
 * replay bytes already delivered by an earlier attachment.
 */
export class TerminayTerminalClient {
	private readonly attachments = new Map<string, MutableAttachment>();
	private readonly highWatermarks = new Map<string, number>();

	constructor(private readonly transport: TerminalClientTransport) {}

	async create(
		request: TerminalClientCreateRequest,
		options: CommandOptions = {},
	): Promise<TerminalClientSession> {
		if (
			typeof request.projectId !== 'string' ||
			request.projectId.length === 0 ||
			hasInvalidIdentityCharacters(request.projectId)
		)
			throw new TypeError('terminal projectId is invalid');
		if (
			request.cwd !== undefined &&
			(typeof request.cwd !== 'string' ||
				request.cwd.length === 0 ||
				request.cwd.length > 4_096)
		)
			throw new TypeError('terminal cwd is invalid');
		for (const [name, value] of [
			['profileId', request.profileId],
			['activePanelId', request.activePanelId],
		] as const) {
			if (
				value !== undefined &&
				(typeof value !== 'string' ||
					value.length === 0 ||
					hasInvalidIdentityCharacters(value))
			)
				throw new TypeError(`terminal ${name} is invalid`);
		}
		const dimensions =
			request.cols === undefined && request.rows === undefined
				? undefined
				: validateDimensions({
						cols: request.cols ?? 80,
						rows: request.rows ?? 24,
					});
		const result = await this.invoke<TerminalClientSession>(
			'terminal.create',
			{
				projectId: request.projectId,
				...(request.profileId === undefined
					? {}
					: { profileId: request.profileId }),
				...(request.activePanelId === undefined
					? {}
					: { activePanelId: request.activePanelId }),
				...(request.cwd === undefined ? {} : { cwd: request.cwd }),
				...(dimensions === undefined ? {} : dimensions),
			},
			options,
		);
		validateCreatedSession(result);
		return Object.freeze({ ...result, dimensions: { ...result.dimensions } });
	}

	/** Read the server-owned session projection for one project.  Renderers use
	 * this instead of asking an Electron host for a terminal cwd or status. */
	async list(
		projectId: string,
		options: CommandOptions = {},
	): Promise<TerminalClientListResult> {
		if (
			typeof projectId !== 'string' ||
			projectId.length === 0 ||
			hasInvalidIdentityCharacters(projectId)
		) {
			throw new TypeError('terminal projectId is invalid');
		}
		if (this.transport.query === undefined)
			throw new Error('terminal listing is unavailable on this transport');
		const response = await this.transport.query<JsonValue>(
			'terminal.list',
			{ projectId },
			options,
		);
		const result = response.result;
		if (typeof result !== 'object' || result === null || Array.isArray(result))
			throw new TypeError('terminal list result is invalid');
		const value = result as Record<string, unknown>;
		if (
			typeof value.serverId !== 'string' ||
			value.projectId !== projectId ||
			!Array.isArray(value.sessions)
		) {
			throw new TypeError('terminal list result is invalid');
		}
		const sessions = value.sessions.map((session) => {
			validateCreatedSession(session as TerminalClientSession);
			const candidate = session as TerminalClientSession;
			if (
				candidate.serverId !== value.serverId ||
				candidate.projectId !== projectId
			)
				throw new TypeError('terminal list session identity is invalid');
			return Object.freeze({
				...candidate,
				dimensions: { ...candidate.dimensions },
			});
		});
		return Object.freeze({ serverId: value.serverId, projectId, sessions });
	}

	async currentCwd(
		projectId: string,
		sessionId: string,
		options: CommandOptions = {},
	): Promise<{
		readonly serverId: string;
		readonly projectId: string;
		readonly sessionId: string;
		readonly cwd: string;
		readonly source: 'observed' | 'spawn';
		readonly observationError?: 'unavailable' | 'failed' | 'timeout';
	}> {
		if (
			typeof projectId !== 'string' ||
			!projectId ||
			hasInvalidIdentityCharacters(projectId) ||
			typeof sessionId !== 'string' ||
			!sessionId ||
			hasInvalidIdentityCharacters(sessionId)
		) {
			throw new TypeError('terminal identity is invalid');
		}
		if (this.transport.query === undefined)
			throw new Error(
				'terminal cwd observation is unavailable on this transport',
			);
		const response = await this.transport.query<JsonValue>(
			'terminal.cwd',
			{ projectId, sessionId },
			options,
		);
		const value = response.result as Record<string, unknown>;
		if (
			typeof value !== 'object' ||
			value === null ||
			value.projectId !== projectId ||
			value.sessionId !== sessionId ||
			typeof value.serverId !== 'string' ||
			typeof value.cwd !== 'string' ||
			(value.source !== 'observed' && value.source !== 'spawn') ||
			(value.observationError !== undefined &&
				!['unavailable', 'failed', 'timeout'].includes(
					String(value.observationError),
				))
		) {
			throw new TypeError('terminal cwd result is invalid');
		}
		return Object.freeze(value) as ReturnType<
			TerminayTerminalClient['currentCwd']
		> extends Promise<infer T>
			? T
			: never;
	}

	/** Wait on the server-owned PTY activity clock. Cancellation propagates
	 * through the query signal and never relies on an Electron lifecycle host. */
	async waitForInactivity(
		projectId: string,
		sessionId: string,
		durationMs: number,
		options: CommandOptions = {},
	): Promise<void> {
		if (
			typeof projectId !== 'string' ||
			projectId.length === 0 ||
			hasInvalidIdentityCharacters(projectId) ||
			typeof sessionId !== 'string' ||
			sessionId.length === 0 ||
			hasInvalidIdentityCharacters(sessionId)
		) {
			throw new TypeError('terminal inactivity identity is invalid');
		}
		if (
			!Number.isSafeInteger(durationMs) ||
			durationMs < 0 ||
			durationMs > 24 * 60 * 60 * 1_000
		)
			throw new RangeError('terminal inactivity duration is invalid');
		if (this.transport.query === undefined)
			throw new Error(
				'terminal inactivity wait is unavailable on this transport',
			);
		const response = await this.transport.query<JsonValue>(
			'terminal.wait-inactivity',
			{ projectId, sessionId, durationMs },
			options,
		);
		const value = response.result;
		if (
			typeof value !== 'object' ||
			value === null ||
			Array.isArray(value) ||
			(value as Record<string, unknown>).projectId !== projectId ||
			(value as Record<string, unknown>).sessionId !== sessionId ||
			(value as Record<string, unknown>).inactive !== true
		) {
			throw new TypeError('terminal inactivity result is invalid');
		}
	}

	async attach(
		request: TerminalClientAttachRequest,
	): Promise<TerminalClientAttachment> {
		return this.open('terminal.attach', request);
	}

	async resume(
		request: TerminalClientAttachRequest,
	): Promise<TerminalClientAttachment> {
		return this.open('terminal.resume', request);
	}

	async detach(
		attachment: TerminalClientAttachment,
		options: CommandOptions = {},
	): Promise<void> {
		const mutable = [...this.attachments.values()].find(
			(candidate) => candidate.id === attachment.attachmentId,
		);
		if (mutable === undefined) return;
		await this.detachMutable(mutable, options);
	}

	private async open(
		operation: 'terminal.attach' | 'terminal.resume',
		request: TerminalClientAttachRequest,
	): Promise<TerminalClientAttachment> {
		validateIdentity(request);
		validateClientId(request.clientId);
		validateAuthorizationForIdentity(request.authorization, request);
		const key = clientSessionKey(request.clientId, request);
		const prior = this.attachments.get(key);
		if (prior !== undefined) await this.detachMutable(prior);
		const highWatermark = this.highWatermarks.get(key) ?? 0;
		// An omitted cursor means transport reconnect and resumes from the shared
		// delivery watermark. An explicit cursor belongs to this display surface:
		// a newly-created xterm may deliberately request retained replay from 0
		// without lowering the reconnect/acknowledgement watermark.
		if (request.freshPresentation === true && request.fromPosition !== undefined && request.fromPosition !== 0) throw new TypeError('a fresh terminal presentation must start at position zero');
		const fromPosition = request.freshPresentation === true ? 0 : request.fromPosition ?? highWatermark;
		validatePosition(fromPosition);
		const result = await this.invoke<TerminalAttachResult>(operation, {
			clientId: request.clientId,
			identity: identityPayload(request),
			...(request.authorization === undefined
				? {}
				: { authorization: authorizationPayload(request.authorization) }),
			fromPosition,
			...(request.freshPresentation === true ? { freshPresentation: true } : {}),
			...(request.maxInitialReplayBytes === undefined
				? {}
				: { maxInitialReplayBytes: request.maxInitialReplayBytes }),
		} as { readonly [key: string]: JsonValue });
		validateAttachResult(result);
		if (
			result.fromPosition < fromPosition ||
			result.position < result.fromPosition
		)
			throw new TypeError('terminal attach result position regressed');

		const initialEvents: TerminalStreamEvent[] = [];
		// The server may advance the display cursor to honor its bounded initial
		// replay budget. Decode replay relative to that authoritative boundary,
		// while retaining the independently tracked reconnect high-water mark.
		let position = result.fromPosition;
		let replayBoundary: number | undefined;
		for (const wireEvent of result.events ?? []) {
			const event = tryDecodeEvent(wireEvent, request, undefined);
			if (event === undefined) continue;
			if (!acceptEvent(event, this.highWatermarks, key, position)) continue;
			if (event.type === 'output') position = event.nextPosition;
			if (event.type === 'resync_required') {
				// The server has discarded bytes before replayFrom. Preserve that
				// boundary as the reconnect cursor; result.position is the producer
				// head, not output this client has rendered.
				replayBoundary = event.replayFrom;
				position = event.replayFrom;
				this.highWatermarks.set(
					key,
					Math.max(this.highWatermarks.get(key) ?? 0, position),
				);
			}
			initialEvents.push(event);
		}
		position =
			replayBoundary === undefined
				? Math.max(position, result.position)
				: replayBoundary;
		this.highWatermarks.set(
			key,
			Math.max(this.highWatermarks.get(key) ?? 0, position),
		);

		const subscription = await this.transport.subscribe<TerminalWireEvent>(
			'terminal',
			{
				payload: {
					attachmentId: result.attachmentId,
					clientId: request.clientId,
					serverId: request.serverId,
					projectId: request.projectId,
					sessionId: request.sessionId,
				},
			},
		);
		const mutable: MutableAttachment = {
			id: result.attachmentId,
			identity: copyIdentity(request),
			clientId: request.clientId,
			listeners: new Set(),
			subscription,
			unsubscribeEvent: () => undefined,
			initialEvents: initialEvents.map(copyEvent),
			position,
			presentation: copyPresentation(result.presentation ?? { ...copyIdentity(request), revision: 0, role: 'read_only' }),
			closed: false,
			detached: undefined,
		};
		mutable.unsubscribeEvent = subscription.onEvent((event) => {
			if (mutable.closed) return;
			if (!eventBelongsToAttachment(event.payload, mutable)) return;
			const decoded = tryDecodeEvent(
				event.payload,
				mutable.identity,
				event.body,
			);
			if (decoded === undefined) return;
			if (!acceptEvent(decoded, this.highWatermarks, key, mutable.position))
				return;
			if (decoded.type === 'output') mutable.position = decoded.nextPosition;
			if (decoded.type === 'resync_required') {
				mutable.position = decoded.replayFrom;
				this.highWatermarks.set(
					key,
					Math.max(this.highWatermarks.get(key) ?? 0, decoded.replayFrom),
				);
			}
			if (decoded.type === 'presentation') mutable.presentation = copyPresentation(decoded);
			if (mutable.listeners.size === 0) {
				// The transport subscription is necessarily live before open() can
				// return its attachment. Preserve that handoff window as replayable
				// initial events so fast shell output cannot disappear.
				mutable.initialEvents.push(copyEvent(decoded));
			} else {
				for (const listener of mutable.listeners) listener(copyEvent(decoded));
			}
		});
		this.attachments.set(key, mutable);
		return new AttachmentView(this, mutable);
	}

	private async detachMutable(
		mutable: MutableAttachment,
		options: CommandOptions = {},
	): Promise<void> {
		if (mutable.detached !== undefined) return mutable.detached;
		mutable.detached = (async () => {
			mutable.closed = true;
			mutable.unsubscribeEvent();
			try {
				await mutable.subscription.unsubscribe();
			} finally {
				this.attachments.delete(
					clientSessionKey(mutable.clientId, mutable.identity),
				);
				await this.invokeVoid(
					'terminal.detach',
					{
						attachmentId: mutable.id,
						clientId: mutable.clientId,
						identity: identityPayload(mutable.identity),
					},
					options,
				);
			}
		})();
		return mutable.detached;
	}

	async acknowledge(
		mutable: MutableAttachment,
		position: number,
		options: CommandOptions = {},
	): Promise<void> {
		if (mutable.closed) throw new Error('terminal attachment is closed');
		validatePosition(position);
		if (position > mutable.position)
			throw new RangeError(
				'terminal acknowledgement is ahead of the observed output',
			);
		await this.invokeVoid(
			'terminal.ack',
			{
				attachmentId: mutable.id,
				clientId: mutable.clientId,
				identity: identityPayload(mutable.identity),
				position,
			},
			options,
		);
	}

	async write(
		mutable: MutableAttachment,
		data: Uint8Array | string,
		options: CommandOptions = {},
	): Promise<void> {
		if (mutable.closed) throw new Error('terminal attachment is closed');
		const bytes = encodeInput(data);
		await this.invokeVoid(
			'terminal.input',
			{
				attachmentId: mutable.id,
				clientId: mutable.clientId,
				identity: identityPayload(mutable.identity),
				dataBase64: encodeBase64(bytes),
			},
			options,
		);
	}

	async resize(
		mutable: MutableAttachment,
		dimensions: TerminalDimensions,
		options: CommandOptions = {},
	): Promise<void> {
		if (mutable.closed) throw new Error('terminal attachment is closed');
		const normalized = validateDimensions(dimensions);
		await this.invokeVoid(
			'terminal.resize',
			{
				attachmentId: mutable.id,
				clientId: mutable.clientId,
				identity: identityPayload(mutable.identity),
				...normalized,
			},
			options,
		);
	}

	async changePresentation(mutable: MutableAttachment, mode: 'acquire' | 'renew' | 'takeover' | 'release', options: CommandOptions = {}): Promise<TerminalPresentationState> {
		if (mutable.closed) throw new Error('terminal attachment is closed');
		const state = await this.invoke<TerminalPresentationState>('terminal.presentation', {
			attachmentId: mutable.id,
			clientId: mutable.clientId,
			identity: identityPayload(mutable.identity),
			mode,
		}, options);
		validatePresentation(state, mutable.identity);
		mutable.presentation = copyPresentation(state);
		return mutable.presentation;
	}

	async kill(
		mutable: MutableAttachment,
		signal?: number | string,
		options: CommandOptions = {},
	): Promise<void> {
		if (mutable.closed) throw new Error('terminal attachment is closed');
		if (
			signal !== undefined &&
			((typeof signal !== 'number' && typeof signal !== 'string') ||
				(typeof signal === 'string' &&
					(signal.length === 0 || signal.length > 32)) ||
				(typeof signal === 'number' && !Number.isSafeInteger(signal)))
		)
			throw new TypeError('terminal signal is invalid');
		await this.invokeVoid(
			'terminal.kill',
			{
				attachmentId: mutable.id,
				clientId: mutable.clientId,
				identity: identityPayload(mutable.identity),
				...(signal === undefined ? {} : { signal }),
			},
			options,
		);
	}

	private async invoke<T>(
		operation: string,
		payload: JsonValue,
		options: CommandOptions = {},
	): Promise<T> {
		const response = await this.transport.command<JsonValue>(
			operation,
			payload,
			options,
		);
		if (isCommandEnvelope(response)) {
			if (response.result === undefined)
				throw new Error(`terminal operation ${operation} returned no result`);
			return response.result as T;
		}
		return response as T;
	}

	private async invokeVoid(
		operation: string,
		payload: JsonValue,
		options: CommandOptions = {},
	): Promise<void> {
		const response = await this.transport.command<JsonValue>(
			operation,
			payload,
			options,
		);
		if (isCommandEnvelope(response) && response.ok === false) {
			throw new Error(`terminal operation ${operation} failed`);
		}
	}
}

class AttachmentView implements TerminalClientAttachment {
	constructor(
		private readonly owner: TerminayTerminalClient,
		private readonly mutable: MutableAttachment,
	) {}
	get attachmentId(): string {
		return this.mutable.id;
	}
	get identity(): TerminalClientIdentity {
		return this.mutable.identity;
	}
	get initialEvents(): readonly TerminalStreamEvent[] {
		return this.mutable.initialEvents;
	}
	get position(): number {
		return this.mutable.position;
	}
	get closed(): boolean {
		return this.mutable.closed;
	}
	get presentation(): TerminalPresentationState { return this.mutable.presentation; }
	onEvent(listener: (event: TerminalStreamEvent) => void): () => void {
		if (typeof listener !== 'function')
			throw new TypeError('terminal event listener must be a function');
		this.mutable.listeners.add(listener);
		return () => this.mutable.listeners.delete(listener);
	}
	ack(position: number, options: CommandOptions = {}): Promise<void> {
		return this.owner.acknowledge(this.mutable, position, options);
	}
	write(
		data: Uint8Array | string,
		options: CommandOptions = {},
	): Promise<void> {
		return this.owner.write(this.mutable, data, options);
	}
	resize(
		dimensions: TerminalDimensions,
		options: CommandOptions = {},
	): Promise<void> {
		return this.owner.resize(this.mutable, dimensions, options);
	}
	changePresentation(mode: 'acquire' | 'renew' | 'takeover' | 'release', options: CommandOptions = {}): Promise<TerminalPresentationState> {
		return this.owner.changePresentation(this.mutable, mode, options);
	}
	kill(signal?: number | string, options: CommandOptions = {}): Promise<void> {
		return this.owner.kill(this.mutable, signal, options);
	}
	detach(options: CommandOptions = {}): Promise<void> {
		return this.owner.detach(this, options);
	}
}

function isCommandEnvelope(
	value: unknown,
): value is ClientCommandResult<JsonValue> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'ok' in value &&
		'commandId' in value
	);
}

function validateAttachResult(value: TerminalAttachResult): void {
	if (
		typeof value !== 'object' ||
		value === null ||
		typeof value.attachmentId !== 'string' ||
		value.attachmentId.length === 0 ||
		!Number.isSafeInteger(value.fromPosition) ||
		!Number.isSafeInteger(value.position)
	)
		throw new TypeError('terminal attach result is invalid');
	if (value.presentation !== undefined) validatePresentation(value.presentation, undefined);
}

function validatePresentation(value: unknown, identity: TerminalClientIdentity | undefined): asserts value is TerminalPresentationState {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('terminal presentation state is invalid');
	const candidate = value as Record<string, unknown>;
	if (!Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 0 || (candidate.role !== 'controller' && candidate.role !== 'read_only')) throw new TypeError('terminal presentation state is invalid');
	if (identity !== undefined && (candidate.serverId !== identity.serverId || candidate.projectId !== identity.projectId || candidate.sessionId !== identity.sessionId)) throw new TypeError('terminal presentation identity is invalid');
	if (candidate.holder !== undefined) {
		const holder = candidate.holder as Record<string, unknown>;
		if (typeof holder !== 'object' || holder === null || !isBoundedIdentity(holder.clientId) || !isBoundedIdentity(holder.attachmentId) || !Number.isSafeInteger(holder.leaseExpiresAt)) throw new TypeError('terminal presentation holder is invalid');
	}
}

function validateCreatedSession(value: TerminalClientSession): void {
	validateIdentity(value);
	if (
		typeof value.cwd !== 'string' ||
		value.cwd.length === 0 ||
		!Number.isSafeInteger(value.createdAt) ||
		!Number.isSafeInteger(value.outputPosition) ||
		!Number.isSafeInteger(value.replayFrom) ||
		(value.status !== 'running' &&
			value.status !== 'exited' &&
			value.status !== 'interrupted')
	)
		throw new TypeError('created terminal session is invalid');
	validateDimensions(value.dimensions);
	if (
		value.pid !== undefined &&
		(!Number.isSafeInteger(value.pid) || value.pid <= 0)
	)
		throw new TypeError('created terminal pid is invalid');
	if (value.launch !== undefined) {
		const launch = value.launch;
		if (
			!isBoundedIdentity(launch.profileId) ||
			!boundedWireText(launch.profileName, 256) ||
			!boundedWireText(launch.targetSummary, 256) ||
			![launch.profileRevision, launch.workspaceRevision, launch.settingsRevision].every(
				(revision) => Number.isSafeInteger(revision) && revision >= 0,
			) ||
			(launch.icon !== undefined && !boundedWireText(launch.icon, 128)) ||
			(launch.color !== undefined && !boundedWireText(launch.color, 128))
		)
			throw new TypeError('created terminal launch metadata is invalid');
	}
}

function boundedWireText(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0');
}

function isBoundedIdentity(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 128 && !hasInvalidIdentityCharacters(value);
}

function decodeEvent(
	event: TerminalWireEvent | JsonValue,
	identity: TerminalClientIdentity,
	body: Uint8Array | undefined,
): TerminalStreamEvent {
	if (typeof event !== 'object' || event === null || Array.isArray(event))
		throw new TypeError('terminal event is invalid');
	const candidate = event as Record<string, unknown>;
	if (
		candidate.serverId !== identity.serverId ||
		candidate.projectId !== identity.projectId ||
		candidate.sessionId !== identity.sessionId
	)
		throw new Error('terminal event identity mismatch');
	const type = candidate.type;
	if (type === 'output') {
		const position = safePosition(
			candidate.position,
			'terminal output position',
		);
		const nextPosition = safePosition(
			candidate.nextPosition,
			'terminal output position',
		);
		if (nextPosition <= position)
			throw new TypeError('terminal output position is invalid');
		const bytes =
			body === undefined
				? decodeBase64(
						typeof candidate.bytes === 'string' ? candidate.bytes : '',
					)
				: new Uint8Array(body);
		if (bytes.byteLength !== nextPosition - position)
			throw new TypeError('terminal output length does not match its position');
		return Object.freeze({
			...identity,
			type: 'output',
			position,
			nextPosition,
			bytes,
			replay: candidate.replay === true,
		});
	}
	if (type === 'exit') {
		if (
			!Number.isSafeInteger(candidate.exitCode) ||
			(typeof candidate.signal !== 'number' && candidate.signal !== null)
		)
			throw new TypeError('terminal exit event is invalid');
		return Object.freeze({
			...identity,
			type: 'exit',
			exitCode: candidate.exitCode as number,
			signal: candidate.signal as number | null,
			...(typeof candidate.reason === 'string'
				? { reason: candidate.reason }
				: {}),
			...(typeof candidate.at === 'number' ? { at: candidate.at } : {}),
		});
	}
	if (type === 'resync_required') {
		const fromPosition = safePosition(
			candidate.fromPosition,
			'terminal resync position',
		);
		const replayFrom = safePosition(
			candidate.replayFrom,
			'terminal resync position',
		);
		const outputPosition = safePosition(
			candidate.outputPosition,
			'terminal resync position',
		);
		return Object.freeze({
			...identity,
			type: 'resync_required',
			fromPosition,
			replayFrom,
			outputPosition,
		});
	}
	if (type === 'presentation') {
		validatePresentation(candidate, identity);
		return Object.freeze({ ...copyPresentation(candidate as unknown as TerminalPresentationState), type: 'presentation', ...(typeof candidate.action === 'string' ? { action: candidate.action } : {}) });
	}
	if (type === 'presentation_unavailable') {
		return Object.freeze({ ...identity, type: 'presentation_unavailable', requestedFromPosition: safePosition(candidate.requestedFromPosition, 'terminal presentation position'), replayFrom: safePosition(candidate.replayFrom, 'terminal presentation position'), outputPosition: safePosition(candidate.outputPosition, 'terminal presentation position') });
	}
	throw new TypeError('unknown terminal event type');
}

function tryDecodeEvent(
	event: TerminalWireEvent | JsonValue,
	identity: TerminalClientIdentity,
	body: Uint8Array | undefined,
): TerminalStreamEvent | undefined {
	try {
		return decodeEvent(event, identity, body);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === 'terminal event identity mismatch'
		) {
			return undefined;
		}
		throw error;
	}
}

function acceptEvent(
	event: TerminalStreamEvent,
	marks: Map<string, number>,
	key: string,
	position: number,
): boolean {
	if (event.type !== 'output') return true;
	const known = position;
	if (event.nextPosition <= known) return false;
	if (event.position < known)
		throw new Error('terminal output overlaps an acknowledged position');
	if (event.position > known)
		throw new Error('terminal output has a retained replay gap');
	marks.set(key, Math.max(marks.get(key) ?? 0, event.nextPosition));
	return true;
}

function eventBelongsToAttachment(
	payload: unknown,
	mutable: MutableAttachment,
): boolean {
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
		return false;
	const candidate = payload as Record<string, unknown>;
	if (candidate.attachmentId !== mutable.id) return false;
	if (candidate.clientId !== mutable.clientId) return false;
	if (candidate.serverId !== mutable.identity.serverId) return false;
	if (candidate.projectId !== mutable.identity.projectId) return false;
	if (candidate.sessionId !== mutable.identity.sessionId) return false;
	// The journal subscription is broader than one attachment. Only an event
	// that claims this exact attachment reaches the strict terminal decoder;
	// unrelated or auxiliary journal payloads must not tear down the panel.
	return true;
}

function copyPresentation(value: TerminalPresentationState): TerminalPresentationState {
	return Object.freeze({ serverId: value.serverId, projectId: value.projectId, sessionId: value.sessionId, revision: value.revision, role: value.role, ...(value.holder === undefined ? {} : { holder: Object.freeze({ ...value.holder }) }) });
}

function copyEvent(event: TerminalStreamEvent): TerminalStreamEvent {
	return event.type === 'output'
		? { ...event, bytes: new Uint8Array(event.bytes) }
		: { ...event };
}

function identityPayload(value: TerminalClientIdentity): {
	readonly [key: string]: JsonValue;
} {
	return {
		serverId: value.serverId,
		projectId: value.projectId,
		sessionId: value.sessionId,
	};
}

function copyIdentity(value: TerminalClientIdentity): TerminalClientIdentity {
	return {
		serverId: value.serverId,
		projectId: value.projectId,
		sessionId: value.sessionId,
	};
}

function authorizationPayload(value: TerminalClientAuthorization): {
	readonly [key: string]: JsonValue;
} {
	return {
		...identityPayload(value),
		...(value.clientId === undefined ? {} : { clientId: value.clientId }),
		...(value.scope === undefined ? {} : { scope: value.scope }),
	};
}

function clientSessionKey(
	clientId: string,
	identity: TerminalClientIdentity,
): string {
	return `${clientId}\u0000${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}`;
}

function validateIdentity(value: TerminalClientIdentity): void {
	for (const name of ['serverId', 'projectId', 'sessionId'] as const) {
		const part = value[name];
		if (
			typeof part !== 'string' ||
			part.length === 0 ||
			part.length > 128 ||
			hasInvalidIdentityCharacters(part)
		)
			throw new TypeError(`terminal ${name} is invalid`);
	}
}

/**
 * An attachment has one canonical server/project/session identity.  Earlier
 * compatibility callers could carry a second identity in `authorization`,
 * which made a terminal-only remote path appear to have its own authority.
 * Keep optional authorization metadata, but never serialize conflicting
 * identity fields to the server protocol.
 */
function validateAuthorizationForIdentity(
	authorization: TerminalClientAuthorization | undefined,
	identity: TerminalClientIdentity,
): void {
	if (authorization === undefined) return;
	validateIdentity(authorization);
	if (
		authorization.serverId !== identity.serverId ||
		authorization.projectId !== identity.projectId ||
		authorization.sessionId !== identity.sessionId
	) {
		throw new TypeError(
			'terminal authorization identity must match the attachment identity',
		);
	}
	if (authorization.clientId !== undefined)
		validateClientId(authorization.clientId);
	if (
		authorization.scope !== undefined &&
		authorization.scope !== 'none' &&
		authorization.scope !== 'read' &&
		authorization.scope !== 'write' &&
		authorization.scope !== 'admin'
	) {
		throw new TypeError('terminal authorization scope is invalid');
	}
}

function validateClientId(value: string): void {
	if (
		typeof value !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	)
		throw new TypeError('terminal clientId is invalid');
}

function hasInvalidIdentityCharacters(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function validatePosition(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new RangeError(
			'terminal position must be a non-negative safe integer',
		);
}

function validateDimensions(value: TerminalDimensions): TerminalDimensions {
	if (
		typeof value !== 'object' ||
		value === null ||
		!Number.isSafeInteger(value.cols) ||
		!Number.isSafeInteger(value.rows) ||
		value.cols < 2 ||
		value.cols > 1_000 ||
		value.rows < 1 ||
		value.rows > 1_000
	)
		throw new RangeError('terminal dimensions are invalid');
	return Object.freeze({ cols: value.cols, rows: value.rows });
}

function encodeInput(value: Uint8Array | string): Uint8Array {
	const bytes =
		typeof value === 'string' ? new TextEncoder().encode(value) : value;
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.byteLength === 0 ||
		bytes.byteLength > 1_048_576
	)
		throw new RangeError('terminal input is invalid');
	return bytes.slice();
}

function encodeBase64(value: Uint8Array): string {
	let binary = '';
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function safePosition(value: unknown, message: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new TypeError(`${message} is invalid`);
	return value as number;
}

function decodeBase64(value: string): Uint8Array {
	if (
		value.length % 4 !== 0 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
			value,
		)
	)
		throw new TypeError('terminal output bytes are not valid base64');
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1)
		bytes[index] = binary.charCodeAt(index);
	return bytes;
}
