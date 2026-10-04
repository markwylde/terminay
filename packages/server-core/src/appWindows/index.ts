import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	BinaryQueryHandlerResult,
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
	RequestContext,
} from '../types.js';

/**
 * Server-owned app windows (ADR-0037).
 *
 * A window belongs to the terminal session whose MCP capability opened it. The
 * server holds the record; the client that holds that session's presentation
 * lease runs the view. Nothing here is persisted: a restart ends every window.
 */

export const APP_WINDOW_OPERATIONS = Object.freeze({
	list: 'app-windows.list',
	content: 'app-windows.content',
	setState: 'app-windows.set-state',
	close: 'app-windows.close',
	message: 'app-windows.message',
	context: 'app-windows.context',
	viewRequest: 'app-windows.view-request',
} as const);

export const APP_WINDOW_EVENTS = Object.freeze({
	changed: 'app-windows.changed',
} as const);

/** Windows one terminal session may hold; one more is refused. */
export const MAX_APP_WINDOWS_PER_SESSION = 8;
export const MAX_APP_WINDOW_TITLE_CHARS = 80;
/** An HTML document the agent wrote. */
export const MAX_AGENT_WINDOW_HTML_BYTES = 512 * 1024;
/** A UI resource read from a connected MCP server. */
export const MAX_MCP_APP_RESOURCE_BYTES = 4 * 1024 * 1024;
/** Text a view sends to the conversation or as model context. */
export const MAX_APP_WINDOW_TEXT_BYTES = 16 * 1024;
/** Parameters of one request a view makes of its own server. */
export const MAX_APP_WINDOW_VIEW_REQUEST_BYTES = 256 * 1024;

export type AppWindowState = 'open' | 'minimised';

export type AppWindowSource =
	| { readonly kind: 'agent' }
	| {
			readonly kind: 'mcp-app';
			/** The connected-server entry that supplied the view. */
			readonly server: string;
			readonly tool: string;
			readonly resourceUri: string;
	  };

/** Origins an MCP App's UI resource declares it needs. */
export interface AppWindowCsp {
	readonly connectDomains?: readonly string[];
	readonly resourceDomains?: readonly string[];
	readonly frameDomains?: readonly string[];
	readonly baseUriDomains?: readonly string[];
}

export interface AppWindowOpenInput {
	readonly terminalSessionId: string;
	readonly projectId: string;
	readonly title: string;
	readonly source: AppWindowSource;
	readonly html: string;
	readonly csp?: AppWindowCsp;
	readonly permissions?: Readonly<Record<string, unknown>>;
	/** The tool definition and call arguments an MCP App view starts from. */
	readonly tool?: JsonValue;
	readonly toolInput?: JsonValue;
}

/** What every client may know about a window. */
export interface AppWindowView {
	readonly id: string;
	readonly terminalSessionId: string;
	readonly projectId: string;
	readonly title: string;
	readonly source: AppWindowSource;
	readonly state: AppWindowState;
	/** Changes whenever the document, tool result, or cancellation changes. */
	readonly contentRevision: number;
	readonly createdAt: number;
}

interface MutableWindow {
	id: string;
	terminalSessionId: string;
	projectId: string;
	title: string;
	source: AppWindowSource;
	state: AppWindowState;
	html: string;
	csp?: AppWindowCsp;
	permissions?: Readonly<Record<string, unknown>>;
	tool?: JsonValue;
	toolInput?: JsonValue;
	toolResult?: JsonValue;
	toolCancelled?: string;
	contentRevision: number;
	createdAt: number;
	pendingContext?: string;
}

export type AppWindowErrorCode =
	| 'window_limit'
	| 'window_not_found'
	| 'window_invalid'
	| 'window_too_large'
	| 'not_presentation_holder'
	| 'unsupported';

export class AppWindowError extends Error {
	readonly code: AppWindowErrorCode;

	constructor(code: AppWindowErrorCode, message: string) {
		super(message);
		this.name = 'AppWindowError';
		this.code = code;
	}
}

export interface AppWindowServiceOptions {
	readonly eventJournal?: OrderedEventJournalLike;
	readonly maxWindowsPerSession?: number;
	readonly now?: () => number;
	readonly generateId?: () => string;
	/**
	 * Whether `clientId` holds the interactive presentation lease of the
	 * window's terminal. Only that client may speak for a view.
	 */
	readonly isPresentationHolder: (
		window: AppWindowView,
		context: RequestContext,
	) => boolean;
	/**
	 * Type a view's message into the owning terminal. Evaluates the Window
	 * Messages policy; throws to refuse.
	 */
	readonly deliverMessage?: (
		window: AppWindowView,
		text: string,
		signal: AbortSignal,
	) => Promise<void>;
	/** Forward an MCP App view's request to the server that supplied it. */
	readonly viewRequest?: (
		window: AppWindowView,
		method: 'tools/call' | 'resources/read',
		params: Readonly<Record<string, JsonValue>>,
		signal: AbortSignal,
	) => Promise<JsonValue>;
}

/** Model context a view left for the next tool result from its terminal. */
export interface AppWindowModelContext {
	readonly title: string;
	readonly text: string;
}

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).byteLength;

export class AppWindowService {
	private viewRequest: AppWindowServiceOptions['viewRequest'];
	private readonly windows = new Map<string, MutableWindow>();
	private readonly listeners = new Set<() => void>();
	private readonly maxWindowsPerSession: number;
	private readonly now: () => number;
	private readonly generateId: () => string;
	private nextId = 0;

	constructor(private readonly options: AppWindowServiceOptions) {
		this.viewRequest = options.viewRequest;
		this.maxWindowsPerSession =
			options.maxWindowsPerSession ?? MAX_APP_WINDOWS_PER_SESSION;
		this.now = options.now ?? Date.now;
		this.generateId =
			options.generateId ??
			(() => {
				this.nextId += 1;
				return `win_${this.now().toString(36)}_${this.nextId.toString(36)}`;
			});
	}

	/** Bind where an MCP App view's own requests go. The gateway that reaches
	 * connected servers is composed by the host, after this service. */
	bindViewRequests(handler: AppWindowServiceOptions['viewRequest']): void {
		this.viewRequest = handler;
	}

	/** Open a window in a terminal session. It starts open; the session's other
	 * windows are minimised. */
	open(input: AppWindowOpenInput): AppWindowView {
		const title = validTitle(input.title);
		const html = validHtml(input.html, input.source);
		const held = this.forSession(input.terminalSessionId).length;
		if (held >= this.maxWindowsPerSession)
			throw new AppWindowError(
				'window_limit',
				`This terminal already has ${this.maxWindowsPerSession} windows. Close one before opening another.`,
			);
		this.minimiseSession(input.terminalSessionId);
		const window: MutableWindow = {
			id: this.generateId(),
			terminalSessionId: input.terminalSessionId,
			projectId: input.projectId,
			title,
			source: Object.freeze({ ...input.source }),
			state: 'open',
			html,
			contentRevision: 1,
			createdAt: this.now(),
			...(input.csp === undefined ? {} : { csp: input.csp }),
			...(input.permissions === undefined
				? {}
				: { permissions: input.permissions }),
			...(input.tool === undefined ? {} : { tool: input.tool }),
			...(input.toolInput === undefined ? {} : { toolInput: input.toolInput }),
		};
		this.windows.set(window.id, window);
		this.publish();
		return view(window);
	}

	/** Replace an agent-authored window's title and document in place and
	 * restore it. The handle is valid only for the session that owns it. */
	replace(
		terminalSessionId: string,
		windowId: string,
		next: { readonly title: string; readonly html: string },
	): AppWindowView {
		const window = this.owned(terminalSessionId, windowId);
		if (window.source.kind !== 'agent')
			throw new AppWindowError(
				'window_invalid',
				'Only a window opened with show_window can be updated.',
			);
		const title = validTitle(next.title);
		const html = validHtml(next.html, window.source);
		this.minimiseSession(terminalSessionId);
		window.title = title;
		window.html = html;
		window.state = 'open';
		window.contentRevision += 1;
		this.publish();
		return view(window);
	}

	/** Close one window of a session. False when the session has no such
	 * window, including when it belongs to another session. */
	close(terminalSessionId: string, windowId: string): boolean {
		const window = this.windows.get(windowId);
		if (window === undefined || window.terminalSessionId !== terminalSessionId)
			return false;
		this.windows.delete(windowId);
		this.publish();
		return true;
	}

	/** Windows of one session, or of every session, oldest first. */
	list(terminalSessionId?: string): readonly AppWindowView[] {
		const windows =
			terminalSessionId === undefined
				? [...this.windows.values()]
				: this.forSession(terminalSessionId);
		return windows
			.sort((left, right) => left.createdAt - right.createdAt)
			.map(view);
	}

	/** The tool call that opened an MCP App window completed. */
	setToolResult(windowId: string, result: JsonValue): void {
		const window = this.windows.get(windowId);
		if (window === undefined) return;
		window.toolResult = result;
		window.contentRevision += 1;
		this.publish();
	}

	/** The tool call that opened an MCP App window failed or was cancelled. */
	setToolCancelled(windowId: string, reason: string): void {
		const window = this.windows.get(windowId);
		if (window === undefined) return;
		window.toolCancelled = reason.slice(0, 1024);
		window.contentRevision += 1;
		this.publish();
	}

	/** The terminal session ended: its windows end with it. */
	endSession(terminalSessionId: string): void {
		const owned = this.forSession(terminalSessionId);
		if (owned.length === 0) return;
		for (const window of owned) this.windows.delete(window.id);
		this.publish();
	}

	/** The server is stopping or MCP was disabled: everything ends. */
	endAll(): void {
		if (this.windows.size === 0) return;
		this.windows.clear();
		this.publish();
	}

	/**
	 * Model context the session's views left since the last call. Each update
	 * is delivered once; a later update replaced an undelivered earlier one.
	 */
	takeModelContext(terminalSessionId: string): readonly AppWindowModelContext[] {
		const taken: AppWindowModelContext[] = [];
		for (const window of this.forSession(terminalSessionId)) {
			if (window.pendingContext === undefined) continue;
			taken.push({ title: window.title, text: window.pendingContext });
			delete window.pendingContext;
		}
		return taken;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Protocol operations for clients. Listing is open to any reader; anything
	 * that changes a window or speaks for a view needs write authority, and a
	 * view's own requests are honoured only from the presentation holder. */
	operations(): OperationRegistries {
		return {
			queries: {
				[APP_WINDOW_OPERATIONS.list]: async () =>
					asJson({ windows: this.list() }),
				[APP_WINDOW_OPERATIONS.content]: async (
					request: QueryRequest,
				): Promise<BinaryQueryHandlerResult> => {
					const window = this.requested(request);
					return {
						result: asJson({
							window: view(window),
							...(window.csp === undefined ? {} : { csp: window.csp }),
							...(window.permissions === undefined
								? {}
								: { permissions: window.permissions }),
							...(window.tool === undefined ? {} : { tool: window.tool }),
							...(window.toolInput === undefined
								? {}
								: { toolInput: window.toolInput }),
							...(window.toolResult === undefined
								? {}
								: { toolResult: window.toolResult }),
							...(window.toolCancelled === undefined
								? {}
								: { toolCancelled: window.toolCancelled }),
						}),
						body: encoder.encode(window.html),
					};
				},
			},
			commands: {
				[APP_WINDOW_OPERATIONS.setState]: async (request: CommandRequest) => {
					const window = this.requested(request);
					const state = record(request.envelope.payload)?.state;
					if (state !== 'open' && state !== 'minimised')
						throw protocolError('validation', 'window state is invalid');
					if (window.state !== state) {
						if (state === 'open') this.minimiseSession(window.terminalSessionId);
						window.state = state;
						this.publish();
					}
					return asJson({ windowId: window.id, state });
				},
				[APP_WINDOW_OPERATIONS.close]: async (request: CommandRequest) => {
					const window = this.requested(request);
					this.close(window.terminalSessionId, window.id);
					return asJson({ windowId: window.id });
				},
				[APP_WINDOW_OPERATIONS.message]: async (request: CommandRequest) => {
					const window = this.fromHolder(request);
					const text = boundedText(record(request.envelope.payload)?.text);
					if (this.options.deliverMessage === undefined)
						throw protocolError('unavailable', 'window messages are unavailable');
					await this.options.deliverMessage(
						view(window),
						text,
						request.context.signal,
					);
					// The terminal is where the reply appears, so get out of its way.
					if (this.windows.has(window.id) && window.state !== 'minimised') {
						window.state = 'minimised';
						this.publish();
					}
					return asJson({ windowId: window.id });
				},
				[APP_WINDOW_OPERATIONS.context]: async (request: CommandRequest) => {
					const window = this.fromHolder(request);
					window.pendingContext = boundedText(
						record(request.envelope.payload)?.text,
					);
					return asJson({ windowId: window.id });
				},
				[APP_WINDOW_OPERATIONS.viewRequest]: async (request: CommandRequest) => {
					const window = this.fromHolder(request);
					const payload = record(request.envelope.payload);
					const method = payload?.method;
					const params = record(payload?.params) ?? {};
					if (method !== 'tools/call' && method !== 'resources/read')
						throw protocolError('validation', 'view request method is invalid');
					if (
						byteLength(JSON.stringify(params)) > MAX_APP_WINDOW_VIEW_REQUEST_BYTES
					)
						throw protocolError('validation', 'view request is too large');
					const viewRequest = this.viewRequest;
					if (window.source.kind !== 'mcp-app' || viewRequest === undefined)
						throw protocolError(
							'forbidden',
							'this window has no server to call',
						);
					return asJson({
						response: await viewRequest(
							view(window),
							method,
							params as Readonly<Record<string, JsonValue>>,
							request.context.signal,
						),
					});
				},
			},
			policies: {
				[APP_WINDOW_OPERATIONS.list]: { scope: 'read' },
				[APP_WINDOW_OPERATIONS.content]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.setState]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.close]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.message]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.context]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.viewRequest]: { scope: 'write' },
			},
		};
	}

	private requested(request: QueryRequest | CommandRequest): MutableWindow {
		const windowId = record(request.envelope.payload)?.windowId;
		if (
			typeof windowId !== 'string' ||
			windowId.length === 0 ||
			windowId.length > 128
		)
			throw protocolError('validation', 'window id is invalid');
		const window = this.windows.get(windowId);
		if (window === undefined)
			throw protocolError('not_found', 'window no longer exists');
		return window;
	}

	private fromHolder(request: CommandRequest): MutableWindow {
		const window = this.requested(request);
		if (!this.options.isPresentationHolder(view(window), request.context))
			throw protocolError(
				'forbidden',
				'only the client controlling this terminal can speak for its windows',
			);
		return window;
	}

	private owned(terminalSessionId: string, windowId: string): MutableWindow {
		const window = this.windows.get(windowId);
		if (window === undefined || window.terminalSessionId !== terminalSessionId)
			throw new AppWindowError(
				'window_not_found',
				'This terminal has no window with that handle.',
			);
		return window;
	}

	private forSession(terminalSessionId: string): MutableWindow[] {
		return [...this.windows.values()].filter(
			(window) => window.terminalSessionId === terminalSessionId,
		);
	}

	private minimiseSession(terminalSessionId: string): void {
		for (const window of this.forSession(terminalSessionId))
			window.state = 'minimised';
	}

	private publish(): void {
		// Journal events reach every subscriber whatever its authority, so they
		// carry only ids and terminals; clients refetch through the operations.
		this.options.eventJournal?.append(
			APP_WINDOW_EVENTS.changed,
			asJson({
				windows: this.list().map(
					({ id, terminalSessionId, state, contentRevision }) => ({
						id,
						terminalSessionId,
						state,
						contentRevision,
					}),
				),
			}),
		);
		for (const listener of this.listeners) listener();
	}
}

function view(window: MutableWindow): AppWindowView {
	return Object.freeze({
		id: window.id,
		terminalSessionId: window.terminalSessionId,
		projectId: window.projectId,
		title: window.title,
		source: window.source,
		state: window.state,
		contentRevision: window.contentRevision,
		createdAt: window.createdAt,
	});
}

function validTitle(value: string): string {
	const title = typeof value === 'string' ? value.trim() : '';
	if (title.length === 0 || [...title].length > MAX_APP_WINDOW_TITLE_CHARS)
		throw new AppWindowError(
			'window_invalid',
			`A window title must be 1 to ${MAX_APP_WINDOW_TITLE_CHARS} characters.`,
		);
	return title;
}

function validHtml(value: string, source: AppWindowSource): string {
	if (typeof value !== 'string' || value.length === 0)
		throw new AppWindowError('window_invalid', 'A window needs an HTML document.');
	const limit =
		source.kind === 'agent'
			? MAX_AGENT_WINDOW_HTML_BYTES
			: MAX_MCP_APP_RESOURCE_BYTES;
	// A UTF-16 length over the limit is already too many bytes; otherwise count.
	if (value.length > limit || byteLength(value) > limit)
		throw new AppWindowError(
			'window_too_large',
			`The HTML document is larger than ${Math.floor(limit / 1024)} KiB.`,
		);
	return value;
}

function boundedText(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > MAX_APP_WINDOW_TEXT_BYTES ||
		byteLength(value) > MAX_APP_WINDOW_TEXT_BYTES
	)
		throw protocolError(
			'validation',
			`text must be 1 byte to ${MAX_APP_WINDOW_TEXT_BYTES / 1024} KiB`,
		);
	return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asJson(value: unknown): JsonValue {
	return value as JsonValue;
}
