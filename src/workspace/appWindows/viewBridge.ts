/**
 * The host side of the MCP Apps view contract (SEP-1865) for one app window.
 *
 * A view is untrusted. Everything it sends arrives here as data and is matched
 * against a fixed set of methods; nothing a view says can name an application
 * command. The bridge has no DOM of its own: the window layer gives it a way to
 * post to the view's sandbox proxy and the handful of things a view may ask
 * for, which keeps the contract testable without a browser.
 */

export const VIEW_PROTOCOL_VERSION = '2026-01-26';
const PROXY_READY = 'ui/notifications/sandbox-proxy-ready';
const RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';
const MAX_VIEW_TEXT_CHARS = 16 * 1024;
const MAX_URL_CHARS = 4096;
const MIN_LINK_INTERVAL_MS = 1000;
const ATTACHMENT_PART = 'terminay/attachment-part';
/** Files one message may carry. */
export const MAX_VIEW_ATTACHMENTS = 16;
const MAX_ATTACHMENT_NAME_CHARS = 255;
/** The most the host asks a view for at once. */
const MAX_ATTACHMENT_PART_BYTES = 256 * 1024;

/** A file a view offers with a message. */
export interface ViewAttachment {
	readonly name: string;
	readonly size: number;
}

/** Read one part of an offered file from the view. */
export type ViewAttachmentReader = (
	file: number,
	offset: number,
	length: number,
) => Promise<Uint8Array>;

export type ViewDisplayMode = 'pip' | 'fullscreen';

/** What the host tells a view about where it is shown. */
export interface ViewHostContext {
	readonly displayMode: ViewDisplayMode;
	readonly platform: 'desktop' | 'mobile';
	readonly touch: boolean;
	/** The body's width, and either its fixed height or the most it may grow to. */
	readonly width: number;
	readonly height?: number;
	readonly maxHeight?: number;
	readonly theme: 'dark' | 'light';
	readonly variables: Readonly<Record<string, string>>;
}

export interface ViewBridgeContent {
	/** The complete view document, policy included. */
	readonly html: string;
	readonly allow: string;
	readonly source: 'agent' | 'mcp-app';
	/** Whether this connection carries files on a window message. */
	readonly attachments?: boolean;
	readonly tool?: unknown;
	readonly toolInput?: unknown;
	readonly toolResult?: unknown;
	readonly toolCancelled?: string;
}

/** The only things a view can cause, each already authorised by the server. */
export interface ViewBridgeHost {
	post(message: unknown): void;
	context(): ViewHostContext;
	/** The view reported its content height. */
	resized(height: number): void;
	sendMessage(text: string): Promise<void>;
	/**
	 * Send a message with files. The host decides whether to send (it may ask
	 * the person first) and reads each file from the view a part at a time.
	 */
	sendAttachments?(
		text: string,
		attachments: readonly ViewAttachment[],
		readPart: ViewAttachmentReader,
	): Promise<void>;
	updateContext(text: string): Promise<void>;
	/** An MCP App view calling its own server. */
	viewRequest(
		method: 'tools/call' | 'resources/read',
		params: Record<string, unknown>,
	): Promise<unknown>;
	openLink(url: string): void;
	/** Returns the display mode actually in effect afterwards. */
	requestDisplayMode(mode: ViewDisplayMode): ViewDisplayMode;
	/** An agent-authored view asked to be closed. */
	close(): void;
	log?(level: string, data: unknown): void;
}

type Rpc = {
	readonly jsonrpc: '2.0';
	readonly id?: string | number;
	readonly method?: string;
	readonly params?: unknown;
};

export class AppViewBridge {
	private initialized = false;
	private resourceSent = false;
	private resultSent = false;
	private cancelledSent = false;
	private lastContext = '';
	private nextHostId = 0;
	private lastLinkAt = 0;
	/** Parts the host has asked the view for and not yet had. */
	private readonly parts = new Map<
		string,
		{
			readonly length: number;
			readonly resolve: (bytes: Uint8Array) => void;
			readonly reject: (error: Error) => void;
		}
	>();
	private content: ViewBridgeContent;
	private readonly host: ViewBridgeHost;

	constructor(content: ViewBridgeContent, host: ViewBridgeHost) {
		this.content = content;
		this.host = host;
	}

	/** Handle one message that arrived from this view's sandbox proxy. */
	async handle(message: unknown): Promise<void> {
		if (!isRpc(message)) return;
		const { id, method } = message;
		// A reply to something the host asked: a part of a file, or teardown.
		if (method === undefined) {
			this.partArrived(message);
			return;
		}
		const params = isRecord(message.params) ? message.params : {};
		const reply = (result: unknown): void => {
			if (id !== undefined) this.host.post({ jsonrpc: '2.0', id, result });
		};
		const fail = (code: number, text: string): void => {
			if (id !== undefined)
				this.host.post({ jsonrpc: '2.0', id, error: { code, message: text } });
		};

		switch (method) {
			case PROXY_READY:
				// Sent once per proxy document. A second one would let a view that
				// broke out of its frame replace the document it runs.
				if (this.resourceSent) return;
				this.resourceSent = true;
				this.host.post({
					jsonrpc: '2.0',
					method: RESOURCE_READY,
					params: { html: this.content.html, allow: this.content.allow },
				});
				return;
			case 'ui/initialize':
				reply({
					protocolVersion: VIEW_PROTOCOL_VERSION,
					hostInfo: { name: 'terminay', version: '1' },
					hostCapabilities: {
						openLinks: {},
						logging: {},
						...(this.content.source === 'mcp-app'
							? { serverTools: {}, serverResources: {} }
							: {}),
					},
					hostContext: {
						...(this.content.tool === undefined
							? {}
							: { toolInfo: { tool: this.content.tool } }),
						availableDisplayModes: ['pip', 'fullscreen'],
						userAgent: 'terminay',
						...this.contextPayload(),
					},
				});
				return;
			case 'ui/notifications/initialized':
				if (this.initialized) return;
				this.initialized = true;
				this.lastContext = JSON.stringify(this.contextPayload());
				if (this.content.source === 'mcp-app')
					this.host.post({
						jsonrpc: '2.0',
						method: 'ui/notifications/tool-input',
						params: { arguments: this.content.toolInput ?? {} },
					});
				this.deliverOutcome();
				return;
			case 'ui/notifications/size-changed': {
				const height = params.height;
				if (typeof height === 'number' && Number.isFinite(height) && height > 0)
					this.host.resized(Math.min(Math.ceil(height), 100_000));
				return;
			}
			case 'ui/message': {
				if (params.attachments !== undefined) {
					const sendAttachments = this.host.sendAttachments?.bind(this.host);
					if (
						this.content.source !== 'agent' ||
						this.content.attachments !== true ||
						sendAttachments === undefined
					)
						return fail(-32000, 'Attachments are unavailable');
					const offered = offeredAttachments(params.attachments);
					// With a file to send, the text may be empty.
					const body = attachmentMessageText(params.content);
					if (offered === undefined || body === undefined)
						return fail(-32602, 'Invalid message format');
					try {
						await sendAttachments(
							body,
							offered.map(({ name, size }) => ({ name, size })),
							(file, offset, length) => {
								const id = offered[file]?.id;
								return id === undefined
									? Promise.reject(new Error('No such attachment'))
									: this.requestPart(id, offset, length);
							},
						);
						reply({});
					} catch (error) {
						fail(-32000, errorText(error, 'Message sending denied'));
					}
					return;
				}
				const text = messageText(params.content);
				if (text === undefined) return fail(-32602, 'Invalid message format');
				try {
					await this.host.sendMessage(text);
					reply({});
				} catch (error) {
					fail(-32000, errorText(error, 'Message sending denied'));
				}
				return;
			}
			case 'ui/update-model-context': {
				const text = contextText(params);
				if (text === undefined) return fail(-32602, 'Invalid content format');
				try {
					await this.host.updateContext(text);
					reply({});
				} catch (error) {
					fail(-32000, errorText(error, 'Context update denied'));
				}
				return;
			}
			case 'ui/open-link': {
				const url = params.url;
				if (
					typeof url !== 'string' ||
					url.length > MAX_URL_CHARS ||
					!isWebUrl(url)
				)
					return fail(-32000, 'Invalid URL');
				// One link at a time: a view cannot fill the screen with tabs.
				if (Date.now() - this.lastLinkAt < MIN_LINK_INTERVAL_MS)
					return fail(-32000, 'Too many links were opened; try again in a moment');
				this.lastLinkAt = Date.now();
				this.host.openLink(url);
				reply({});
				return;
			}
			case 'ui/request-display-mode': {
				const wanted = params.mode === 'fullscreen' ? 'fullscreen' : 'pip';
				reply({ mode: this.host.requestDisplayMode(wanted) });
				return;
			}
			case 'ui/request-close':
				// Offered only to the agent's own views, through their bootstrap.
				if (this.content.source !== 'agent')
					return fail(-32601, `Method not found: ${method}`);
				reply({});
				this.host.close();
				return;
			case 'tools/call':
			case 'resources/read':
				if (this.content.source !== 'mcp-app')
					return fail(-32601, `Method not found: ${method}`);
				try {
					reply(await this.host.viewRequest(method, params));
				} catch (error) {
					fail(-32000, errorText(error, 'The request was refused'));
				}
				return;
			case 'notifications/message':
				this.host.log?.(String(params.level ?? 'info'), params.data);
				return;
			case 'ping':
				reply({});
				return;
			default:
				fail(-32601, `Method not found: ${method}`);
		}
	}

	/** The window's content changed on the server (a tool result arrived). */
	updateContent(content: ViewBridgeContent): void {
		this.content = content;
		if (this.initialized) this.deliverOutcome();
	}

	/** Where the view is shown changed: tell it, once per actual change. */
	contextChanged(): void {
		if (!this.initialized) return;
		const payload = this.contextPayload();
		const key = JSON.stringify(payload);
		if (key === this.lastContext) return;
		this.lastContext = key;
		this.host.post({
			jsonrpc: '2.0',
			method: 'ui/notifications/host-context-changed',
			params: payload,
		});
	}

	/** Ask the view for one part of a file it offered with a message. */
	private requestPart(id: string, offset: number, length: number): Promise<Uint8Array> {
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			!Number.isSafeInteger(length) ||
			length <= 0 ||
			length > MAX_ATTACHMENT_PART_BYTES
		)
			return Promise.reject(new RangeError('attachment part is invalid'));
		this.nextHostId += 1;
		const requestId = `host-${this.nextHostId}`;
		return new Promise((resolve, reject) => {
			this.parts.set(requestId, { length, resolve, reject });
			this.host.post({
				jsonrpc: '2.0',
				id: requestId,
				method: ATTACHMENT_PART,
				params: { id, offset, length },
			});
		});
	}

	/** A view answered a request for part of a file. It is untrusted: it gets
	 * exactly the bytes asked for accepted, and nothing else. */
	private partArrived(message: Rpc): void {
		if (typeof message.id !== 'string') return;
		const waiting = this.parts.get(message.id);
		if (waiting === undefined) return;
		this.parts.delete(message.id);
		const result = (message as { readonly result?: unknown }).result;
		const bytes = isRecord(result) ? result.bytes : undefined;
		if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== waiting.length)
			waiting.reject(new Error('The window did not provide the file'));
		else waiting.resolve(new Uint8Array(bytes));
	}

	/** The view is gone: whatever was being read from it will never arrive. */
	abandonParts(): void {
		const waiting = [...this.parts.values()];
		this.parts.clear();
		for (const part of waiting) part.reject(new Error('The window closed'));
	}

	/** Tell the view it is about to be removed. */
	teardown(reason: string): void {
		this.abandonParts();
		if (!this.initialized) return;
		this.nextHostId += 1;
		this.host.post({
			jsonrpc: '2.0',
			id: `host-${this.nextHostId}`,
			method: 'ui/resource-teardown',
			params: { reason },
		});
	}

	private deliverOutcome(): void {
		if (this.content.source !== 'mcp-app') return;
		if (this.content.toolResult !== undefined && !this.resultSent) {
			this.resultSent = true;
			this.host.post({
				jsonrpc: '2.0',
				method: 'ui/notifications/tool-result',
				params: this.content.toolResult,
			});
		} else if (
			this.content.toolCancelled !== undefined &&
			!this.cancelledSent &&
			!this.resultSent
		) {
			this.cancelledSent = true;
			this.host.post({
				jsonrpc: '2.0',
				method: 'ui/notifications/tool-cancelled',
				params: { reason: this.content.toolCancelled },
			});
		}
	}

	private contextPayload(): Record<string, unknown> {
		const context = this.host.context();
		return {
			theme: context.theme,
			styles: { variables: context.variables },
			displayMode: context.displayMode,
			platform: context.platform,
			deviceCapabilities: { touch: context.touch, hover: !context.touch },
			containerDimensions:
				context.height === undefined
					? {
							width: Math.round(context.width),
							...(context.maxHeight === undefined
								? {}
								: { maxHeight: Math.round(context.maxHeight) }),
						}
					: {
							width: Math.round(context.width),
							height: Math.round(context.height),
						},
		};
	}
}

function isRpc(value: unknown): value is Rpc {
	if (!isRecord(value) || value.jsonrpc !== '2.0') return false;
	if (value.method !== undefined && typeof value.method !== 'string')
		return false;
	return (
		value.id === undefined ||
		typeof value.id === 'string' ||
		(typeof value.id === 'number' && Number.isFinite(value.id))
	);
}

function messageText(content: unknown): string | undefined {
	if (!isRecord(content) || content.type !== 'text') return undefined;
	return boundedText(content.text);
}

/** The text of a message that carries files: bounded as any message is, and allowed to be empty. */
function attachmentMessageText(content: unknown): string | undefined {
	if (!isRecord(content) || content.type !== 'text') return undefined;
	return content.text === '' ? '' : boundedText(content.text);
}

function offeredAttachments(
	value: unknown,
): readonly (ViewAttachment & { readonly id: string })[] | undefined {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VIEW_ATTACHMENTS)
		return undefined;
	const offered: (ViewAttachment & { id: string })[] = [];
	for (const entry of value) {
		if (
			!isRecord(entry) ||
			typeof entry.id !== 'string' ||
			entry.id.length === 0 ||
			entry.id.length > 64 ||
			typeof entry.name !== 'string' ||
			entry.name.length === 0 ||
			entry.name.length > MAX_ATTACHMENT_NAME_CHARS ||
			typeof entry.size !== 'number' ||
			!Number.isSafeInteger(entry.size) ||
			entry.size < 0
		)
			return undefined;
		offered.push({ id: entry.id, name: entry.name, size: entry.size });
	}
	return offered;
}

function contextText(params: Record<string, unknown>): string | undefined {
	const blocks = Array.isArray(params.content) ? params.content : [];
	const text = blocks
		.map((block) =>
			isRecord(block) && typeof block.text === 'string' ? block.text : '',
		)
		.filter((part) => part.length > 0)
		.join('\n');
	if (text.length > 0) return boundedText(text);
	if (isRecord(params.structuredContent)) {
		try {
			return boundedText(JSON.stringify(params.structuredContent));
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function boundedText(value: unknown): string | undefined {
	return typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_VIEW_TEXT_CHARS
		? value
		: undefined;
}

function isWebUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

function errorText(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.length > 0
		? error.message.slice(0, 500)
		: fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
