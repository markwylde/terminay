import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { JsonValue } from '@terminay/protocol';
import type {
	ConnectedTool,
	ConnectedToolGateway,
	ConnectedToolUi,
	ConnectedUiResource,
} from './appWindowTools.js';
import { CONTROL_SOCKET_ENV, CONTROL_TOKEN_ENV } from './controlEndpoint.js';

/**
 * Terminay's client side of the MCP servers a user connected (ADR-0037).
 *
 * Terminay Server, never a client, connects to each enabled entry and
 * advertises the MCP Apps extension, so those servers offer the tools that
 * have views. A local server runs once per project, in that project's root,
 * and is started only when a terminal of the project first needs its tools.
 * Nothing here retries on a timer: a lost connection is re-made by the next
 * request that needs it.
 */

export const MCP_UI_EXTENSION = 'io.modelcontextprotocol/ui';
export const MCP_UI_MIME_TYPE = 'text/html;profile=mcp-app';
export const CONNECTED_SERVER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const MAX_TOOLS_PER_ENTRY = 256;
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
/** How long a server that failed to start is left alone before a listing tries it again. */
const RETRY_FAILED_AFTER_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_REASON_CHARS = 300;
const TOOL_SEPARATOR = '__';

export type ConnectedServerEntry =
	| {
			readonly name: string;
			readonly enabled: boolean;
			readonly transport: 'stdio';
			readonly command: string;
			readonly args?: readonly string[];
			readonly env?: Readonly<Record<string, string>>;
	  }
	| {
			readonly name: string;
			readonly enabled: boolean;
			readonly transport: 'http';
			readonly url: string;
			readonly headers?: Readonly<Record<string, string>>;
	  };

export interface ConnectedServerStatus {
	readonly name: string;
	readonly state: 'connected' | 'not-connected' | 'disabled' | 'idle';
	/** Model-visible tools the entry offers, when connected. */
	readonly tools: number;
	/** Why it is not connected, bounded. */
	readonly reason?: string;
}

export interface ConnectedServerGatewayOptions {
	/** Canonical root of a project, the working directory of its local servers. */
	readonly projectRoot: (projectId: string) => string | undefined;
	/** Environment local servers start from. Terminay's control variables are
	 * always removed, so a connected server can never call back in. */
	readonly baseEnvironment?: () => Readonly<Record<string, string | undefined>>;
	readonly connectTimeoutMs?: number;
	/** The clock, for deciding when a failed server may be tried again. */
	readonly now?: () => number;
	readonly requestTimeoutMs?: number;
	readonly clientVersion?: string;
}

interface UpstreamTool {
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly inputSchema: JsonValue;
	readonly annotations?: JsonValue;
	readonly _meta?: Record<string, unknown>;
}

interface Connection {
	readonly key: string;
	readonly entry: ConnectedServerEntry;
	readonly client: Client;
	tools: readonly UpstreamTool[];
	closed: boolean;
}

export class ConnectedServerError extends Error {
	readonly code: 'not_found' | 'forbidden' | 'internal';
	constructor(code: ConnectedServerError['code'], message: string) {
		super(message);
		this.name = 'ConnectedServerError';
		this.code = code;
	}
}

export class ConnectedServerGateway implements ConnectedToolGateway {
	private entries: readonly ConnectedServerEntry[] = [];
	private readonly connections = new Map<string, Connection>();
	private readonly connecting = new Map<string, Promise<Connection | undefined>>();
	/** Stops a connection attempt that nobody may have any more: its project closed, or the gateway did. */
	private readonly opening = new Map<string, AbortController>();
	private readonly failures = new Map<string, string>();
	/** When each connection last failed to open, by connection key. */
	private readonly failedAt = new Map<string, number>();
	private readonly listeners = new Set<() => void>();
	private generation = 0;

	constructor(private readonly options: ConnectedServerGatewayOptions) {}

	/** Replace the configured entries. Connections of removed, disabled, or
	 * changed entries are closed; unchanged ones are kept. */
	setEntries(next: readonly ConnectedServerEntry[]): void {
		const valid = next.filter((entry) => CONNECTED_SERVER_NAME.test(entry.name));
		const previous = new Map(this.entries.map((entry) => [entry.name, entry]));
		// An entry that did not change keeps its identity, so a connection being
		// opened for it is not mistaken for one to an entry that was replaced.
		this.entries = Object.freeze(
			valid.map((entry) => {
				const before = previous.get(entry.name);
				return before !== undefined && JSON.stringify(before) === JSON.stringify(entry)
					? before
					: Object.freeze({ ...entry });
			}),
		);
		const current = new Map(this.entries.map((entry) => [entry.name, entry]));
		for (const [key, connection] of [...this.connections]) {
			const entry = current.get(connection.entry.name);
			if (
				entry === undefined ||
				!entry.enabled ||
				JSON.stringify(entry) !== JSON.stringify(connection.entry)
			)
				this.drop(key, connection);
		}
		for (const name of this.failures.keys()) {
			const before = previous.get(name);
			const after = current.get(name);
			if (after === undefined || JSON.stringify(before) !== JSON.stringify(after)) {
				this.failures.delete(name);
				for (const key of [...this.failedAt.keys()])
					if (key === name || key.startsWith(`${name}\u0000`)) this.failedAt.delete(key);
			}
		}
		this.changed();
	}

	/** One line per configured entry, for Settings. */
	status(): readonly ConnectedServerStatus[] {
		return this.entries.map((entry) => {
			if (!entry.enabled) return { name: entry.name, state: 'disabled', tools: 0 };
			const live = [...this.connections.values()].filter(
				(connection) => connection.entry.name === entry.name && !connection.closed,
			);
			if (live.length > 0)
				return {
					name: entry.name,
					state: 'connected',
					tools: Math.max(
						...live.map((connection) => connection.tools.filter(modelVisible).length),
					),
				};
			const reason = this.failures.get(entry.name);
			return reason === undefined
				? { name: entry.name, state: 'idle', tools: 0 }
				: { name: entry.name, state: 'not-connected', tools: 0, reason };
		});
	}

	revision(_projectId: string): string {
		return `rev-${this.generation}`;
	}

	onChanged(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async listTools(projectId: string, signal: AbortSignal): Promise<readonly ConnectedTool[]> {
		const tools: ConnectedTool[] = [];
		// A failing entry contributes nothing and never blocks the others.
		const connections = await Promise.all(
			this.entries
				.filter((entry) => entry.enabled)
				.map((entry) => this.connect(entry, projectId, signal)),
		);
		for (const connection of connections) {
			if (connection === undefined) continue;
			for (const tool of connection.tools.filter(modelVisible))
				tools.push({
					name: `${connection.entry.name}${TOOL_SEPARATOR}${tool.name}`,
					...(tool.description === undefined ? {} : { description: tool.description }),
					...(tool.title === undefined ? {} : { title: tool.title }),
					inputSchema: tool.inputSchema,
					...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
				});
		}
		return tools;
	}

	async toolUi(
		projectId: string,
		name: string,
		signal: AbortSignal,
	): Promise<ConnectedToolUi | undefined> {
		const { connection, tool } = await this.resolve(projectId, name, signal, 'model');
		const resourceUri = uiResourceUri(tool);
		if (resourceUri === undefined) return undefined;
		return {
			entry: connection.entry.name,
			tool: tool.name,
			resourceUri,
			title: tool.title ?? tool.name,
			definition: {
				name: tool.name,
				...(tool.title === undefined ? {} : { title: tool.title }),
				...(tool.description === undefined ? {} : { description: tool.description }),
				inputSchema: tool.inputSchema,
			},
		};
	}

	async callTool(
		projectId: string,
		name: string,
		args: Readonly<Record<string, JsonValue>>,
		signal: AbortSignal,
	): Promise<JsonValue> {
		const { connection, tool } = await this.resolve(projectId, name, signal, 'model');
		return this.call(connection, tool.name, args, signal);
	}

	async readUiResource(
		projectId: string,
		ui: ConnectedToolUi,
		signal: AbortSignal,
	): Promise<ConnectedUiResource> {
		const connection = await this.connected(ui.entry, projectId, signal);
		const result = await connection.client.readResource(
			{ uri: ui.resourceUri },
			{ signal, timeout: this.requestTimeout },
		);
		const content = result.contents[0] as
			| { text?: unknown; blob?: unknown; mimeType?: unknown; _meta?: { ui?: Record<string, unknown> } }
			| undefined;
		if (content === undefined)
			throw new ConnectedServerError('not_found', 'The UI resource is empty.');
		const html =
			typeof content.text === 'string'
				? content.text
				: typeof content.blob === 'string'
					? Buffer.from(content.blob, 'base64').toString('utf8')
					: undefined;
		if (html === undefined)
			throw new ConnectedServerError('not_found', 'The UI resource has no document.');
		const meta = content._meta?.ui ?? {};
		return {
			html,
			...(typeof content.mimeType === 'string' ? { mimeType: content.mimeType } : {}),
			...(isRecord(meta.csp)
				? { csp: meta.csp as NonNullable<ConnectedUiResource['csp']> }
				: {}),
			...(isRecord(meta.permissions) ? { permissions: meta.permissions } : {}),
		};
	}

	/**
	 * A view's own request. It reaches only the entry that supplied the view,
	 * and only a tool that server marks as visible to its app.
	 */
	async callFromView(
		projectId: string,
		entryName: string,
		method: 'tools/call' | 'resources/read',
		params: Readonly<Record<string, JsonValue>>,
		signal: AbortSignal,
	): Promise<JsonValue> {
		const connection = await this.connected(entryName, projectId, signal);
		if (method === 'resources/read') {
			if (typeof params.uri !== 'string' || params.uri.length > 2048)
				throw new ConnectedServerError('forbidden', 'The resource URI is invalid.');
			return (await connection.client.readResource(
				{ uri: params.uri },
				{ signal, timeout: this.requestTimeout },
			)) as unknown as JsonValue;
		}
		const tool = connection.tools.find((candidate) => candidate.name === params.name);
		if (tool === undefined || !visibility(tool).includes('app'))
			throw new ConnectedServerError(
				'forbidden',
				'This view may not call that tool.',
			);
		const args = isRecord(params.arguments) ? params.arguments : {};
		return this.call(connection, tool.name, args as Record<string, JsonValue>, signal);
	}

	/** A project closed: its local servers stop. */
	closeProject(projectId: string): void {
		let dropped = false;
		for (const [key, connection] of [...this.connections])
			if (connection.entry.transport === 'stdio' && key.endsWith(`\u0000${projectId}`)) {
				this.drop(key, connection);
				dropped = true;
			}
		for (const [key, stop] of [...this.opening])
			if (key.endsWith(`\u0000${projectId}`)) stop.abort(new Error('The project closed.'));
		if (dropped) this.changed();
	}

	/** The server is stopping or MCP was disabled. */
	closeAll(): void {
		for (const [key, connection] of [...this.connections]) this.drop(key, connection);
		for (const stop of [...this.opening.values()]) stop.abort(new Error('Connected servers were closed.'));
		this.failures.clear();
		this.failedAt.clear();
		this.changed();
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private get requestTimeout(): number {
		return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	}

	private async call(
		connection: Connection,
		tool: string,
		args: Readonly<Record<string, JsonValue>>,
		signal: AbortSignal,
	): Promise<JsonValue> {
		return (await connection.client.callTool(
			{ name: tool, arguments: args as Record<string, unknown> },
			undefined,
			{ signal, timeout: this.requestTimeout },
		)) as unknown as JsonValue;
	}

	private async resolve(
		projectId: string,
		name: string,
		signal: AbortSignal,
		audience: 'model' | 'app',
	): Promise<{ connection: Connection; tool: UpstreamTool }> {
		const at = name.indexOf(TOOL_SEPARATOR);
		const entryName = at < 0 ? '' : name.slice(0, at);
		const toolName = at < 0 ? '' : name.slice(at + TOOL_SEPARATOR.length);
		const connection = await this.connected(entryName, projectId, signal);
		const tool = connection.tools.find((candidate) => candidate.name === toolName);
		if (tool === undefined || !visibility(tool).includes(audience))
			throw new ConnectedServerError('not_found', `There is no connected tool named ${name}.`);
		return { connection, tool };
	}

	private async connected(
		entryName: string,
		projectId: string,
		signal: AbortSignal,
	): Promise<Connection> {
		const entry = this.entries.find((candidate) => candidate.name === entryName);
		if (entry === undefined || !entry.enabled)
			throw new ConnectedServerError('not_found', `No connected server is named ${entryName}.`);
		const connection = await this.connect(entry, projectId, signal, true);
		if (connection === undefined)
			throw new ConnectedServerError(
				'internal',
				`${entry.name} is not connected: ${this.failures.get(entry.name) ?? 'it did not answer'}.`,
			);
		return connection;
	}

	private keyOf(entry: ConnectedServerEntry, projectId: string): string {
		return entry.transport === 'stdio' ? `${entry.name}\u0000${projectId}` : entry.name;
	}

	/** Connect, or reuse the live connection. Undefined when the entry fails. */
	private connect(
		entry: ConnectedServerEntry,
		projectId: string,
		signal: AbortSignal,
		retryFailed = false,
	): Promise<Connection | undefined> {
		const key = this.keyOf(entry, projectId);
		const live = this.connections.get(key);
		if (live !== undefined && !live.closed) return Promise.resolve(live);
		// A server that just failed is not started again by every listing that
		// follows. It is tried again once it has been left alone for a while, when
		// its entry is saved, or when one of its tools is asked for by name.
		const failedAt = this.failedAt.get(key);
		if (
			!retryFailed &&
			failedAt !== undefined &&
			this.now() - failedAt < RETRY_FAILED_AFTER_MS
		)
			return Promise.resolve(undefined);
		// A caller that has already given up starts nothing.
		if (signal.aborted) return Promise.reject(signal.reason ?? new Error('cancelled'));
		let attempt = this.connecting.get(key);
		if (attempt === undefined) {
			const stop = new AbortController();
			this.opening.set(key, stop);
			// One attempt serves every caller waiting for this server, so it
			// belongs to none of them: a caller giving up stops waiting, and the
			// attempt runs on for the others, bounded by its own timeout.
			attempt = this.open(entry, projectId, key, stop.signal)
				.then((connection) => {
					this.failedAt.delete(key);
					return connection;
				})
				.catch((error: unknown) => {
					// Stopped because nobody may have it any more: not a failure of the server.
					if (stop.signal.aborted) return undefined;
					const reason = reasonOf(error);
					this.failedAt.set(key, this.now());
					// The tool list changes when a server's state does, not each
					// time it fails the same way: announcing that would have every
					// agent list again, and every listing start the server again.
					if (this.failures.get(entry.name) !== reason) {
						this.failures.set(entry.name, reason);
						this.changed();
					}
					return undefined;
				})
				.finally(() => {
					this.connecting.delete(key);
					if (this.opening.get(key) === stop) this.opening.delete(key);
				});
			this.connecting.set(key, attempt);
		}
		return abortable(attempt, signal);
	}

	private async open(
		entry: ConnectedServerEntry,
		projectId: string,
		key: string,
		signal: AbortSignal,
	): Promise<Connection> {
		const client = new Client(
			{ name: 'terminay', version: this.options.clientVersion ?? '1' },
			{ capabilities: { extensions: { [MCP_UI_EXTENSION]: { mimeTypes: [MCP_UI_MIME_TYPE] } } } },
		);
		const timeout = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		const transport =
			entry.transport === 'stdio'
				? new StdioClientTransport({
						command: entry.command,
						args: [...(entry.args ?? [])],
						env: this.environmentFor(entry),
						...(this.options.projectRoot(projectId) === undefined
							? {}
							: { cwd: this.options.projectRoot(projectId) as string }),
						stderr: 'ignore',
					})
				: new StreamableHTTPClientTransport(new URL(entry.url), {
						requestInit: { headers: { ...(entry.headers ?? {}) } },
					});
		try {
			await client.connect(
				// The SDK's transport classes declare optional members without
				// `undefined`, which exactOptionalPropertyTypes rejects.
				transport as Parameters<Client['connect']>[0],
				{ signal, timeout },
			);
			const { tools } = await client.listTools(undefined, { signal, timeout });
			const connection: Connection = {
				key,
				entry,
				client,
				tools: tools.slice(0, MAX_TOOLS_PER_ENTRY) as unknown as UpstreamTool[],
				closed: false,
			};
			// The entry may have been removed or changed while this was connecting,
			// or the project or the gateway closed.
			if (signal.aborted || !this.entries.includes(entry)) {
				await client.close().catch(() => {});
				throw new ConnectedServerError('not_found', 'The entry changed while connecting.');
			}
			client.onclose = () => {
				if (connection.closed) return;
				connection.closed = true;
				if (this.connections.get(key) === connection) this.connections.delete(key);
				this.failures.set(entry.name, 'The server closed the connection.');
				// A server that connects and then exits is left alone as one that
				// fails to start is. Without this, the change announced below has
				// every waiting adapter list again, and each listing start it again.
				this.failedAt.set(key, this.now());
				this.changed();
			};
			client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
				void client
					.listTools(undefined, { timeout })
					.then((next) => {
						connection.tools = next.tools.slice(0, MAX_TOOLS_PER_ENTRY) as unknown as UpstreamTool[];
						this.changed();
					})
					.catch(() => {});
			});
			this.connections.set(key, connection);
			this.failures.delete(entry.name);
			this.changed();
			return connection;
		} catch (error) {
			await client.close().catch(() => {});
			throw error;
		}
	}

	private environmentFor(
		entry: ConnectedServerEntry & { transport: 'stdio' },
	): Record<string, string> {
		const environment: Record<string, string> = {};
		const base = this.options.baseEnvironment?.() ?? process.env;
		for (const [name, value] of Object.entries({ ...base, ...(entry.env ?? {}) }))
			if (typeof value === 'string') environment[name] = value;
		// A connected server must never be able to call back into Terminay.
		delete environment[CONTROL_SOCKET_ENV];
		delete environment[CONTROL_TOKEN_ENV];
		return environment;
	}

	private drop(key: string, connection: Connection): void {
		connection.closed = true;
		this.connections.delete(key);
		void connection.client.close().catch(() => {});
	}

	private changed(): void {
		this.generation += 1;
		for (const listener of [...this.listeners]) listener();
	}
}

function visibility(tool: UpstreamTool): readonly string[] {
	const declared = (tool._meta?.ui as { visibility?: unknown } | undefined)?.visibility;
	return Array.isArray(declared) &&
		declared.every((value) => value === 'model' || value === 'app')
		? (declared as string[])
		: ['model', 'app'];
}

function modelVisible(tool: UpstreamTool): boolean {
	return visibility(tool).includes('model');
}

function uiResourceUri(tool: UpstreamTool): string | undefined {
	const meta = tool._meta ?? {};
	const uri =
		(meta.ui as { resourceUri?: unknown } | undefined)?.resourceUri ??
		meta['ui/resourceUri'];
	return typeof uri === 'string' && uri.startsWith('ui://') && uri.length <= 2048
		? uri
		: undefined;
}

/** Wait for shared work until it settles or this caller gives up; giving up does not stop the work. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason ?? new Error('cancelled'));
	return new Promise<T>((resolve, reject) => {
		const onAbort = (): void => reject(signal.reason ?? new Error('cancelled'));
		signal.addEventListener('abort', onAbort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}

function reasonOf(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.replace(/\s+/gu, ' ').slice(0, MAX_REASON_CHARS) || 'It did not answer.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
