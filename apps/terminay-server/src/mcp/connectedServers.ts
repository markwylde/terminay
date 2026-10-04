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
	private readonly failures = new Map<string, string>();
	private readonly listeners = new Set<() => void>();
	private generation = 0;

	constructor(private readonly options: ConnectedServerGatewayOptions) {}

	/** Replace the configured entries. Connections of removed, disabled, or
	 * changed entries are closed; unchanged ones are kept. */
	setEntries(next: readonly ConnectedServerEntry[]): void {
		const valid = next.filter((entry) => CONNECTED_SERVER_NAME.test(entry.name));
		const previous = new Map(this.entries.map((entry) => [entry.name, entry]));
		this.entries = Object.freeze(valid.map((entry) => Object.freeze({ ...entry })));
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
			if (after === undefined || JSON.stringify(before) !== JSON.stringify(after))
				this.failures.delete(name);
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
		if (dropped) this.changed();
	}

	/** The server is stopping or MCP was disabled. */
	closeAll(): void {
		for (const [key, connection] of [...this.connections]) this.drop(key, connection);
		this.failures.clear();
		this.changed();
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
		const connection = await this.connect(entry, projectId, signal);
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
	): Promise<Connection | undefined> {
		const key = this.keyOf(entry, projectId);
		const live = this.connections.get(key);
		if (live !== undefined && !live.closed) return Promise.resolve(live);
		const pending = this.connecting.get(key);
		if (pending !== undefined) return pending;
		const attempt = this.open(entry, projectId, key, signal)
			.catch((error: unknown) => {
				this.failures.set(entry.name, reasonOf(error));
				this.changed();
				return undefined;
			})
			.finally(() => this.connecting.delete(key));
		this.connecting.set(key, attempt);
		return attempt;
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
			// The entry may have been removed or changed while this was connecting.
			if (!this.entries.includes(entry)) {
				await client.close().catch(() => {});
				throw new ConnectedServerError('not_found', 'The entry changed while connecting.');
			}
			client.onclose = () => {
				if (connection.closed) return;
				connection.closed = true;
				if (this.connections.get(key) === connection) this.connections.delete(key);
				this.failures.set(entry.name, 'The server closed the connection.');
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

function reasonOf(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.replace(/\s+/gu, ' ').slice(0, MAX_REASON_CHARS) || 'It did not answer.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
