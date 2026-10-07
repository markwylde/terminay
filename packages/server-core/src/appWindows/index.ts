import { type JsonValue, protocolError } from '@terminay/protocol';
import type {
	BinaryQueryHandlerResult,
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
	RequestContext,
} from '../types.js';
import {
	type AppWindowAttachment,
	AppWindowAttachmentWriter,
	appWindowAttachmentDirectory,
	MAX_APP_WINDOW_ATTACHMENT_NAME_CHARS,
	MAX_APP_WINDOW_ATTACHMENT_PART_BYTES,
	MAX_APP_WINDOW_ATTACHMENTS,
} from './attachments.js';
import { AppWindowMirrorRelay, NOT_CONTROLLER, withinClientBoundary } from './mirror.js';

export * from './attachments.js';
export * from './mirror.js';

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
	messageBegin: 'app-windows.message-begin',
	messagePart: 'app-windows.message-part',
	messageFinish: 'app-windows.message-finish',
	messageCancel: 'app-windows.message-cancel',
	context: 'app-windows.context',
	viewRequest: 'app-windows.view-request',
	viewResponse: 'app-windows.view-response',
} as const);

export const APP_WINDOW_EVENTS = Object.freeze({
	changed: 'app-windows.changed',
} as const);

/** Windows one terminal session may hold; one more is refused. */
export const MAX_APP_WINDOWS_PER_SESSION = 8;
export const MAX_APP_WINDOW_TITLE_CHARS = 80;
/** An HTML document the agent wrote. */
export const MAX_AGENT_WINDOW_HTML_BYTES = 512 * 1024;
/** The JSON value an agent gives its document to read, serialised. */
export const MAX_APP_WINDOW_DATA_BYTES = 64 * 1024;
/** A UI resource read from a connected MCP server. */
export const MAX_MCP_APP_RESOURCE_BYTES = 4 * 1024 * 1024;
/** Text a view sends to the conversation or as model context. */
export const MAX_APP_WINDOW_TEXT_BYTES = 16 * 1024;
/** Parameters of one request a view makes of its own server. */
export const MAX_APP_WINDOW_VIEW_REQUEST_BYTES = 256 * 1024;
/** What a view's own server may answer one request with. */
export const MAX_APP_WINDOW_VIEW_RESPONSE_BYTES = 4 * 1024 * 1024;
/** A response this small returns with the command; a larger one is fetched as a body. */
const MAX_INLINE_VIEW_RESPONSE_BYTES = 32 * 1024;
/** Large responses one window holds for its view to fetch. */
const MAX_HELD_VIEW_RESPONSES = 4;

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
	/** What an agent-authored document reads as `window.terminay.data`. */
	readonly data?: JsonValue;
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
	data?: JsonValue;
	csp?: AppWindowCsp;
	permissions?: Readonly<Record<string, unknown>>;
	tool?: JsonValue;
	toolInput?: JsonValue;
	toolResult?: JsonValue;
	toolCancelled?: string;
	contentRevision: number;
	createdAt: number;
	pendingContext?: string;
	/** A message from this window is being delivered (it may be waiting on a permission prompt). */
	sending?: boolean;
	/** A message with attachments whose files are still arriving. */
	upload?: PendingUpload;
	/** Responses too large for a command result, held until the view fetches them. */
	responses?: Map<string, { readonly clientId: string; readonly bytes: Uint8Array }>;
}

interface PendingUpload {
	readonly id: string;
	/** The connection that began it: the only one that may continue or cancel it. */
	readonly clientId: string;
	readonly connectionId: string | undefined;
	readonly text: string;
	readonly writer: AppWindowAttachmentWriter;
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
	 * The client holding the interactive presentation lease of the window's
	 * terminal now. Without it, views are not mirrored to other clients.
	 */
	readonly presentationHolder?: (window: AppWindowView) => string | undefined;
	/**
	 * Type a view's message into the owning terminal. Evaluates the Window
	 * Messages policy; throws to refuse.
	 */
	readonly deliverMessage?: (
		window: AppWindowView,
		text: string,
		signal: AbortSignal,
	) => Promise<void>;
	/**
	 * Attachments on a window message (ADR-0046). `authorize` evaluates the
	 * Window Messages policy for the message and its files before any byte is
	 * accepted, and throws to refuse; `type` writes the finished message to the
	 * owning terminal. Without this, messages carry text only.
	 */
	readonly attachments?: {
		readonly authorize: (
			window: AppWindowView,
			text: string,
			attachments: readonly AppWindowAttachment[],
			signal: AbortSignal,
		) => Promise<void>;
		readonly type: (
			window: AppWindowView,
			text: string,
			signal: AbortSignal,
		) => Promise<void>;
		/** Server-owned attachment scratch directory. Defaults to one under os.tmpdir(). */
		readonly directory?: string;
	};
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
const decoder = new TextDecoder('utf-8', { fatal: true });
const byteLength = (text: string): number => encoder.encode(text).byteLength;

export class AppWindowService {
	private viewRequest: AppWindowServiceOptions['viewRequest'];
	private readonly windows = new Map<string, MutableWindow>();
	private readonly listeners = new Set<() => void>();
	private readonly maxWindowsPerSession: number;
	private readonly now: () => number;
	private readonly generateId: () => string;
	private nextId = 0;
	private nextResponseId = 0;
	private nextUploadId = 0;
	/** Relays recorded views to the clients watching a terminal (ADR-0039). */
	readonly mirror: AppWindowMirrorRelay | undefined;

	constructor(private readonly options: AppWindowServiceOptions) {
		this.viewRequest = options.viewRequest;
		const presentationHolder = options.presentationHolder;
		this.mirror =
			presentationHolder === undefined
				? undefined
				: new AppWindowMirrorRelay({
						...(options.eventJournal === undefined
							? {}
							: { eventJournal: options.eventJournal }),
						window: (windowId) => {
							const window = this.windows.get(windowId);
							return window === undefined ? undefined : view(window);
						},
						sessionWindow: (terminalSessionId) => {
							const window = this.forSession(terminalSessionId)[0];
							return window === undefined ? undefined : view(window);
						},
						isPresentationHolder: (window, context) => {
							const current = this.windows.get(window.id);
							return (
								current !== undefined &&
								options.isPresentationHolder(view(current), context)
							);
						},
						presentationHolder: (window) => {
							const current = this.windows.get(window.id);
							return current === undefined
								? undefined
								: presentationHolder(view(current));
						},
					});
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
		const data = validData(input.data);
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
			...(data === undefined ? {} : { data }),
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

	/** Replace an agent-authored window's title, document, and data in place and
	 * restore it. The handle is valid only for the session that owns it. */
	replace(
		terminalSessionId: string,
		windowId: string,
		next: { readonly title: string; readonly html: string; readonly data?: JsonValue },
	): AppWindowView {
		const window = this.owned(terminalSessionId, windowId);
		if (window.source.kind !== 'agent')
			throw new AppWindowError(
				'window_invalid',
				'Only a window opened with show_window can be updated.',
			);
		const title = validTitle(next.title);
		const html = validHtml(next.html, window.source);
		const data = validData(next.data);
		this.minimiseSession(terminalSessionId);
		window.title = title;
		window.html = html;
		// The data belongs to the document it came with: a replacement without
		// any leaves the window with none.
		if (data === undefined) delete window.data;
		else window.data = data;
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
		this.abandonUpload(window);
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
		this.mirror?.endSession(terminalSessionId);
		const owned = this.forSession(terminalSessionId);
		if (owned.length === 0) return;
		for (const window of owned) {
			this.abandonUpload(window);
			this.windows.delete(window.id);
		}
		this.publish();
	}

	/** The server is stopping or MCP was disabled: everything ends. */
	endAll(): void {
		this.mirror?.endAll();
		if (this.windows.size === 0) return;
		for (const window of this.windows.values()) this.abandonUpload(window);
		this.windows.clear();
		this.publish();
	}

	/**
	 * Model context the session's views left since the last call. Each update
	 * is delivered once; a later update replaced an undelivered earlier one.
	 */
	takeModelContext(
		terminalSessionId: string,
		maxBytes: number = Number.POSITIVE_INFINITY,
	): readonly AppWindowModelContext[] {
		const taken: AppWindowModelContext[] = [];
		let used = 0;
		for (const window of this.forSession(terminalSessionId)) {
			if (window.pendingContext === undefined) continue;
			// What does not fit this result stays for the next one: a note is
			// delivered whole or not yet, never cut and never dropped.
			// Measured as it will travel: JSON escapes some characters to several bytes.
			const size =
				byteLength(JSON.stringify(window.pendingContext)) + byteLength(JSON.stringify(window.title)) + 64;
			if (used + size > maxBytes && taken.length > 0) continue;
			used += size;
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
		const own = this.windowOperations();
		const mirror = this.mirror?.operations();
		if (mirror === undefined) return own;
		return {
			queries: { ...own.queries, ...mirror.queries },
			commands: { ...own.commands, ...mirror.commands },
			policies: { ...own.policies, ...mirror.policies },
		};
	}

	/** Forget what a closed connection was watching. */
	closeConnection(connectionId: string): void {
		this.mirror?.closeConnection(connectionId);
		// An upload cannot continue without the connection its parts came on.
		for (const window of this.windows.values())
			if (window.upload?.connectionId === connectionId) this.abandonUpload(window);
	}

	private windowOperations(): OperationRegistries {
		return {
			queries: {
				[APP_WINDOW_OPERATIONS.list]: async (request: QueryRequest) =>
					asJson({
						windows: this.list().filter((window) =>
							withinClientBoundary(request.context, window),
						),
					}),

				[APP_WINDOW_OPERATIONS.content]: async (
					request: QueryRequest,
				): Promise<BinaryQueryHandlerResult> => {
					const window = this.requested(request);
					// The document and the tool data can each be far larger than a
					// protocol envelope may be, so they travel together as the body.
					return {
						result: asJson({
							window: view(window),
							...(window.csp === undefined ? {} : { csp: window.csp }),
							...(window.permissions === undefined
								? {}
								: { permissions: window.permissions }),
						}),
						body: encoder.encode(
							JSON.stringify({
								html: window.html,
								...(window.data === undefined ? {} : { data: window.data }),
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
						),
					};
				},
				[APP_WINDOW_OPERATIONS.viewResponse]: async (
					request: QueryRequest,
				): Promise<BinaryQueryHandlerResult> => {
					const window = this.requested(request);
					const responseId = record(request.envelope.payload)?.responseId;
					const held =
						typeof responseId === 'string' ? window.responses?.get(responseId) : undefined;
					// Given once, and only to the client that made the request.
					if (held === undefined || held.clientId !== request.context.clientId)
						throw protocolError('not_found', 'that response is no longer held');
					window.responses?.delete(responseId as string);
					return { result: asJson({ windowId: window.id }), body: held.bytes };
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
					const text = messageText(record(request.envelope.payload)?.text);
					// A message is something the person looking at a window sends
					// from it. A window that is minimised is not being looked at; one
					// that has just sent is minimised, so it cannot send again until
					// it has been opened again.
					if (window.state !== 'open')
						throw protocolError(
							'forbidden',
							'a minimised window cannot send a message; open it first',
						);
					if (window.sending === true)
						throw protocolError('resource', 'this window is already sending a message');
					if (this.options.deliverMessage === undefined)
						throw protocolError('unavailable', 'window messages are unavailable');
					window.sending = true;
					try {
						await this.options.deliverMessage(
							view(window),
							text,
							request.context.signal,
						);
					} finally {
						window.sending = false;
					}
					// The terminal is where the reply appears, so get out of its way.
					// (Its state may have changed while the message waited for approval.)
					if (this.windows.has(window.id) && (window.state as AppWindowState) !== 'minimised') {
						window.state = 'minimised';
						this.publish();
					}
					return asJson({ windowId: window.id });
				},
				[APP_WINDOW_OPERATIONS.messageBegin]: async (request: CommandRequest) => {
					const window = this.fromHolder(request);
					const payload = record(request.envelope.payload);
					const attachments = this.options.attachments;
					if (attachments === undefined)
						throw protocolError('unavailable', 'window message attachments are unavailable');
					const files = attachmentList(payload?.attachments);
					// With a file to send, the text may be empty: the file is the message.
					const text = payload?.text === '' ? '' : plainText(payload?.text);
					if (window.state !== 'open')
						throw protocolError(
							'forbidden',
							'a minimised window cannot send a message; open it first',
						);
					if (window.sending === true)
						throw protocolError('resource', 'this window is already sending a message');
					window.sending = true;
					try {
						// Asked once, for the whole message, before any byte is accepted.
						await attachments.authorize(view(window), text, files, request.context.signal);
						if (!this.windows.has(window.id))
							throw protocolError('not_found', 'window no longer exists');
						// Control may have moved while the question was open.
						this.fromHolder(request);
					} catch (error) {
						window.sending = false;
						throw error;
					}
					this.nextUploadId += 1;
					window.upload = {
						id: `up_${this.nextUploadId.toString(36)}`,
						clientId: request.context.clientId,
						connectionId: request.context.connectionId,
						text,
						writer: new AppWindowAttachmentWriter(
							attachments.directory ?? appWindowAttachmentDirectory(),
							files,
						),
					};
					return asJson({ windowId: window.id, uploadId: window.upload.id });
				},
				[APP_WINDOW_OPERATIONS.messagePart]: async (request: CommandRequest) => {
					const { window, upload } = this.uploading(request);
					const payload = record(request.envelope.payload);
					const file = payload?.file;
					const offset = payload?.offset;
					if (
						!Number.isSafeInteger(file) ||
						!Number.isSafeInteger(offset) ||
						(file as number) < 0 ||
						(offset as number) < 0 ||
						request.body.byteLength > MAX_APP_WINDOW_ATTACHMENT_PART_BYTES
					) {
						this.abandonUpload(window);
						throw protocolError('validation', 'attachment part is invalid');
					}
					try {
						const received = await upload.writer.write(
							file as number,
							offset as number,
							request.body,
						);
						return asJson({ windowId: window.id, received });
					} catch (error) {
						// A part that does not fit, or a disk that will not take it: the
						// message cannot be delivered whole, so it is not delivered.
						this.abandonUpload(window);
						throw error instanceof RangeError
							? protocolError('validation', error.message)
							: protocolError('resource', 'the attachment could not be written');
					}
				},
				[APP_WINDOW_OPERATIONS.messageFinish]: async (request: CommandRequest) => {
					const { window, upload } = this.uploading(request);
					const attachments = this.options.attachments;
					let paths: readonly string[];
					try {
						paths = await upload.writer.finish();
					} catch (error) {
						this.abandonUpload(window);
						throw error instanceof RangeError
							? protocolError('validation', error.message)
							: protocolError('resource', 'the attachment could not be written');
					}
					try {
						if (attachments === undefined || !this.windows.has(window.id))
							throw protocolError('not_found', 'window no longer exists');
						// The view never learns where its files went: the paths go to
						// the terminal, and only there.
						await attachments.type(
							view(window),
							attachedMessage(upload.text, paths),
							request.context.signal,
						);
					} catch (error) {
						this.abandonUpload(window);
						throw error;
					}
					delete window.upload;
					window.sending = false;
					if (this.windows.has(window.id) && window.state !== 'minimised') {
						window.state = 'minimised';
						this.publish();
					}
					return asJson({ windowId: window.id });
				},
				[APP_WINDOW_OPERATIONS.messageCancel]: async (request: CommandRequest) => {
					const window = this.requested(request);
					const upload = window.upload;
					// Whoever began it may stop it, even after losing control: that is
					// exactly when its view is taken down.
					if (
						upload !== undefined &&
						upload.id === record(request.envelope.payload)?.uploadId &&
						upload.clientId === request.context.clientId &&
						upload.connectionId === request.context.connectionId
					)
						this.abandonUpload(window);
					return asJson({ windowId: window.id });
				},
				[APP_WINDOW_OPERATIONS.context]: async (request: CommandRequest) => {
					const window = this.fromHolder(request);
					window.pendingContext = plainText(
						record(request.envelope.payload)?.text,
					);
					return asJson({ windowId: window.id });
				},
				[APP_WINDOW_OPERATIONS.viewRequest]: async (request: CommandRequest) => {
					const window = this.fromHolder(request);
					const method = record(request.envelope.payload)?.method;
					if (method !== 'tools/call' && method !== 'resources/read')
						throw protocolError('validation', 'view request method is invalid');
					// The parameters are the command's body: they may be larger than
					// a protocol envelope.
					if (request.body.byteLength > MAX_APP_WINDOW_VIEW_REQUEST_BYTES)
						throw protocolError('validation', 'view request is too large');
					let params: Record<string, JsonValue> | undefined;
					try {
						params =
							request.body.byteLength === 0
								? {}
								: (record(JSON.parse(decoder.decode(request.body))) as
										| Record<string, JsonValue>
										| undefined);
					} catch {
						params = undefined;
					}
					if (params === undefined)
						throw protocolError('validation', 'view request parameters are invalid');
					const viewRequest = this.viewRequest;
					if (window.source.kind !== 'mcp-app' || viewRequest === undefined)
						throw protocolError(
							'forbidden',
							'this window has no server to call',
						);
					const response = await viewRequest(
						view(window),
						method,
						params,
						request.context.signal,
					);
					const bytes = encoder.encode(JSON.stringify(response ?? null));
					if (bytes.byteLength > MAX_APP_WINDOW_VIEW_RESPONSE_BYTES)
						throw protocolError('validation', 'the server’s response is too large for a view');
					// A small response returns with the command. A large one is held
					// for the caller to fetch as a body, since a command's result
					// travels in an envelope.
					if (bytes.byteLength <= MAX_INLINE_VIEW_RESPONSE_BYTES)
						return asJson({ response });
					if (!this.windows.has(window.id))
						throw protocolError('not_found', 'window no longer exists');
					window.responses ??= new Map();
					const responses = window.responses;
					while (responses.size >= MAX_HELD_VIEW_RESPONSES) {
						const oldest = responses.keys().next().value;
						if (oldest === undefined) break;
						responses.delete(oldest);
					}
					this.nextResponseId += 1;
					const responseId = `res_${this.nextResponseId.toString(36)}`;
					responses.set(responseId, { clientId: request.context.clientId, bytes });
					return asJson({ responseId });
				},
			},
			policies: {
				[APP_WINDOW_OPERATIONS.list]: { scope: 'read' },
				[APP_WINDOW_OPERATIONS.content]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.setState]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.close]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.message]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.messageBegin]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.messagePart]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.messageFinish]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.messageCancel]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.context]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.viewRequest]: { scope: 'write' },
				[APP_WINDOW_OPERATIONS.viewResponse]: { scope: 'write' },
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
		// A window outside the caller's project or session does not exist for it.
		if (window === undefined || !withinClientBoundary(request.context, window))
			throw protocolError('not_found', 'window no longer exists');

		return window;
	}

	private fromHolder(request: CommandRequest): MutableWindow {
		const window = this.requested(request);
		if (!this.options.isPresentationHolder(view(window), request.context))
			throw protocolError(
				'forbidden',
				'only the client controlling this terminal can speak for its windows',
				{ details: { reason: NOT_CONTROLLER } },
			);
		return window;
	}

	/** The upload a request continues: its own, on its own connection, while it still controls the terminal. */
	private uploading(request: CommandRequest): {
		readonly window: MutableWindow;
		readonly upload: PendingUpload;
	} {
		const window = this.requested(request);
		const upload = window.upload;
		if (
			upload === undefined ||
			upload.id !== record(request.envelope.payload)?.uploadId ||
			upload.clientId !== request.context.clientId ||
			upload.connectionId !== request.context.connectionId
		)
			throw protocolError('not_found', 'that upload is no longer in progress');
		if (!this.options.isPresentationHolder(view(window), request.context)) {
			// Control moved: what was being sent from here is not sent.
			this.abandonUpload(window);
			throw protocolError(
				'forbidden',
				'only the client controlling this terminal can speak for its windows',
				{ details: { reason: NOT_CONTROLLER } },
			);
		}
		return { window, upload };
	}

	/** Stop a message whose files were arriving, and remove what arrived. */
	private abandonUpload(window: MutableWindow): void {
		const upload = window.upload;
		if (upload === undefined) return;
		delete window.upload;
		window.sending = false;
		void upload.writer.abort();
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

function validData(value: JsonValue | undefined): JsonValue | undefined {
	if (value === undefined) return undefined;
	let serialised: string | undefined;
	try {
		serialised = JSON.stringify(value);
	} catch {
		serialised = undefined;
	}
	if (serialised === undefined)
		throw new AppWindowError('window_invalid', 'Window data must be a JSON value.');
	if (
		serialised.length > MAX_APP_WINDOW_DATA_BYTES ||
		byteLength(serialised) > MAX_APP_WINDOW_DATA_BYTES
	)
		throw new AppWindowError(
			'window_too_large',
			`Window data is larger than ${MAX_APP_WINDOW_DATA_BYTES / 1024} KiB.`,
		);
	// Kept as the value it serialises to, so nothing shared with the caller remains.
	return JSON.parse(serialised) as JsonValue;
}

/**
 * Text a view asks to have typed into its terminal. It comes from untrusted
 * HTML, so it is text and nothing else: a control character would be a
 * keystroke (an escape sequence that ends the paste, an interrupt, a carriage
 * return that submits early). Tab and line feed are the only ones allowed.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses.
const KEYSTROKE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;

/** Text from a view that is text and nothing else: for the terminal, or for the model. */
function plainText(value: unknown): string {
	const text = boundedText(value);
	if (KEYSTROKE.test(text))
		throw protocolError(
			'validation',
			'text from a window may contain text, tabs, and line breaks only',
		);
	return text;
}

function messageText(value: unknown): string {
	const text = plainText(value);
	// White space alone would be a bare Enter: an answer to whatever the
	// terminal is asking, which is not a message.
	if (text.trim().length === 0)
		throw protocolError('validation', 'a window message must say something');
	return text;
}

/** The files a view offers with a message: a name to show people, and a size. */
function attachmentList(value: unknown): readonly AppWindowAttachment[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_APP_WINDOW_ATTACHMENTS)
		throw protocolError(
			'validation',
			`a message carries 1 to ${MAX_APP_WINDOW_ATTACHMENTS} attachments`,
		);
	return value.map((entry) => {
		const attachment = record(entry);
		const name = attachment?.name;
		const size = attachment?.size;
		if (
			typeof name !== 'string' ||
			name.length === 0 ||
			name.length > MAX_APP_WINDOW_ATTACHMENT_NAME_CHARS ||
			!Number.isSafeInteger(size) ||
			(size as number) < 0
		)
			throw protocolError('validation', 'attachment is invalid');
		// Shown in a permission prompt, so it is text and nothing else.
		return Object.freeze({
			name: name.replace(new RegExp(KEYSTROKE.source, 'gu'), ' ').replace(/[\t\n]/gu, ' '),
			size: size as number,
		});
	});
}

/** What is typed for a message with files: its text, then where each file is. */
function attachedMessage(text: string, paths: readonly string[]): string {
	const lines = paths.map((path) => `Attached: ${path}`).join('\n');
	return text.trim().length === 0 ? lines : `${text}\n${lines}`;
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
