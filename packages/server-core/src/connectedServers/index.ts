import { type JsonValue, protocolError } from '@terminay/protocol';
import { assertAutomationAuthority } from '../automationService/protocol.js';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
} from '../types.js';

/**
 * The MCP servers a user connected to Terminay (ADR-0037).
 *
 * The list is server-owned and the same for every project on the server. An
 * entry's environment-variable values and header values are credentials: they
 * are written to the server vault and are never returned to a client, which
 * learns only which names are set. Only the privileged server resolves them,
 * to start or reach the server the entry describes.
 */

export const CONNECTED_SERVER_OPERATIONS = Object.freeze({
	list: 'mcp.servers.list',
	save: 'mcp.servers.save',
	remove: 'mcp.servers.remove',
} as const);

export const CONNECTED_SERVER_EVENTS = Object.freeze({
	changed: 'mcp.servers.changed',
} as const);

export const MAX_CONNECTED_SERVERS = 32;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/u;
const MAX_COMMAND_CHARS = 4096;
const MAX_ARGS = 64;
const MAX_VALUE_BYTES = 16 * 1024;
const MAX_NAMES = 32;

/** What a client may know about an entry. No credential value appears here. */
export interface ConnectedServerView {
	readonly name: string;
	readonly enabled: boolean;
	readonly transport: 'stdio' | 'http';
	readonly command?: string;
	readonly args?: readonly string[];
	/** Names of environment variables whose values are set. */
	readonly envNames: readonly string[];
	readonly url?: string;
	/** Names of request headers whose values are set. */
	readonly headerNames: readonly string[];
}

/** An entry with its credentials, for the privileged server only. */
export type ResolvedConnectedServer =
	| {
			readonly name: string;
			readonly enabled: boolean;
			readonly transport: 'stdio';
			readonly command: string;
			readonly args: readonly string[];
			readonly env: Readonly<Record<string, string>>;
	  }
	| {
			readonly name: string;
			readonly enabled: boolean;
			readonly transport: 'http';
			readonly url: string;
			readonly headers: Readonly<Record<string, string>>;
	  };

export interface ConnectedServerStatusView {
	readonly name: string;
	readonly state: 'connected' | 'not-connected' | 'disabled' | 'idle';
	readonly tools: number;
	readonly reason?: string;
}

/**
 * A save. `env` and `headers` carry only what changes: a string sets a value,
 * `null` removes it, and a name that is absent keeps what is stored.
 */
export interface ConnectedServerSaveInput {
	/** The entry being edited; absent to add a new one. */
	readonly previousName?: string;
	readonly name: string;
	readonly enabled: boolean;
	readonly transport: 'stdio' | 'http';
	readonly command?: string;
	readonly args?: readonly string[];
	readonly url?: string;
	readonly env?: Readonly<Record<string, string | null>>;
	readonly headers?: Readonly<Record<string, string | null>>;
}

export interface ConnectedServerBackend {
	load(): Promise<unknown>;
	commit(state: { readonly version: 1; readonly servers: readonly ConnectedServerView[] }): Promise<void>;
}

/** The slice of the server vault the registry needs. */
export interface ConnectedServerVault {
	put(input: { id: string; label?: string; value: Uint8Array }): Promise<unknown>;
	replace(input: { id: string; label?: string; value: Uint8Array }): Promise<unknown>;
	remove(id: string): Promise<unknown>;
	withSecret<T>(id: string, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T>;
}

export interface ConnectedServerRegistryOptions {
	readonly backend: ConnectedServerBackend;
	readonly vault: ConnectedServerVault;
	readonly eventJournal?: OrderedEventJournalLike;
}

export class ConnectedServerError extends Error {
	readonly code: 'validation' | 'conflict' | 'not_found' | 'resource';
	constructor(code: ConnectedServerError['code'], message: string) {
		super(message);
		this.name = 'ConnectedServerError';
		this.code = code;
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const secretId = (name: string, kind: 'env' | 'header', key: string): string =>
	`mcp-server.${name}.${kind}.${Buffer.from(key, 'utf8').toString('hex')}`;

export class ConnectedServerRegistry {
	private servers: ConnectedServerView[] = [];
	private loaded = false;
	private status: () => readonly ConnectedServerStatusView[] = () => [];
	private readonly listeners = new Set<() => void>();
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly options: ConnectedServerRegistryOptions) {}

	async load(): Promise<void> {
		if (this.loaded) return;
		const stored = await this.options.backend.load();
		const list =
			isRecord(stored) && Array.isArray(stored.servers) ? stored.servers : [];
		this.servers = list.flatMap((entry) => {
			try {
				return [storedView(entry)];
			} catch {
				// A damaged entry is dropped rather than making every server unusable.
				return [];
			}
		});
		this.loaded = true;
	}

	/** The source of each entry's live connection state. */
	bindStatus(status: () => readonly ConnectedServerStatusView[]): void {
		this.status = status;
	}

	list(): readonly ConnectedServerView[] {
		return this.servers.map((server) => ({ ...server }));
	}

	onChanged(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** The connection status of entries changed; tell clients to look again. */
	notifyStatusChanged(): void {
		this.options.eventJournal?.append(CONNECTED_SERVER_EVENTS.changed, {});
	}

	/** Add an entry or change one. Credentials named in the input are written
	 * to the vault before the entry is committed. */
	save(input: ConnectedServerSaveInput): Promise<ConnectedServerView> {
		return this.serial(async () => {
			await this.load();
			const next = validate(input);
			const previousName = input.previousName;
			const existing =
				previousName === undefined
					? undefined
					: this.servers.find((server) => server.name === previousName);
			if (previousName !== undefined && existing === undefined)
				throw new ConnectedServerError('not_found', `No connected server is named ${previousName}.`);
			if (
				this.servers.some(
					(server) => server.name === next.name && server !== existing,
				)
			)
				throw new ConnectedServerError('conflict', `A connected server is already named ${next.name}.`);
			if (existing === undefined && this.servers.length >= MAX_CONNECTED_SERVERS)
				throw new ConnectedServerError('resource', `At most ${MAX_CONNECTED_SERVERS} servers can be connected.`);

			const renamed = existing !== undefined && existing.name !== next.name;
			// Stored credentials are never returned to a client, and so must not
			// be sendable to a place the client chooses: they stay only while the
			// entry still starts the same program or calls the same address.
			const sameDestination =
				existing !== undefined &&
				existing.transport === next.transport &&
				existing.command === next.command &&
				JSON.stringify(existing.args ?? []) === JSON.stringify(next.args ?? []) &&
				existing.url === next.url;
			const envNames = await this.applyCredentials(
				existing,
				next.name,
				'env',
				next.transport === 'stdio' ? (input.env ?? {}) : null,
				renamed,
				sameDestination,
			);
			const headerNames = await this.applyCredentials(
				existing,
				next.name,
				'header',
				next.transport === 'http' ? (input.headers ?? {}) : null,
				renamed,
				sameDestination,
			);
			const view: ConnectedServerView = { ...next, envNames, headerNames };
			// What is held in memory is what was written: a save that cannot be
			// committed leaves the list as it was.
			const before = this.servers;
			this.servers =
				existing === undefined
					? [...this.servers, view]
					: this.servers.map((server) => (server === existing ? view : server));
			try {
				await this.commit();
			} catch (error) {
				this.servers = before;
				throw error;
			}
			return { ...view };
		});
	}

	remove(name: string): Promise<boolean> {
		return this.serial(async () => {
			await this.load();
			const existing = this.servers.find((server) => server.name === name);
			if (existing === undefined) return false;
			for (const key of existing.envNames)
				await this.options.vault.remove(secretId(name, 'env', key)).catch(() => {});
			for (const key of existing.headerNames)
				await this.options.vault.remove(secretId(name, 'header', key)).catch(() => {});
			this.servers = this.servers.filter((server) => server !== existing);
			await this.commit();
			return true;
		});
	}

	/** Every entry with its credentials. For the privileged server only. */
	async resolved(): Promise<readonly ResolvedConnectedServer[]> {
		await this.load();
		const resolved: ResolvedConnectedServer[] = [];
		for (const server of this.servers) {
			const read = async (
				kind: 'env' | 'header',
				names: readonly string[],
			): Promise<Record<string, string>> => {
				const values: Record<string, string> = {};
				for (const key of names) {
					try {
						values[key] = await this.options.vault.withSecret(
							secretId(server.name, kind, key),
							(secret) => decoder.decode(secret),
						);
					} catch {
						// A credential the vault cannot give is left out; the server it
						// was for then fails on its own terms and says so.
					}
				}
				return values;
			};
			if (server.transport === 'stdio')
				resolved.push({
					name: server.name,
					enabled: server.enabled,
					transport: 'stdio',
					command: server.command ?? '',
					args: server.args ?? [],
					env: await read('env', server.envNames),
				});
			else
				resolved.push({
					name: server.name,
					enabled: server.enabled,
					transport: 'http',
					url: server.url ?? '',
					headers: await read('header', server.headerNames),
				});
		}
		return resolved;
	}

	/** Protocol operations for clients. All need the authority that changing
	 * the MCP permission policies needs. */
	operations(): OperationRegistries {
		const policy = { scope: 'write' } as const;
		return {
			queries: {
				[CONNECTED_SERVER_OPERATIONS.list]: async (request: QueryRequest) => {
					authorizeClient(request);
					await this.load();
					return asJson({ servers: this.list(), status: this.status() });
				},
			},
			commands: {
				[CONNECTED_SERVER_OPERATIONS.save]: async (request: CommandRequest) => {
					authorizeClient(request);
					try {
						return asJson({
							server: await this.save(
								request.envelope.payload as unknown as ConnectedServerSaveInput,
							),
						});
					} catch (error) {
						throw asProtocolError(error);
					}
				},
				[CONNECTED_SERVER_OPERATIONS.remove]: async (request: CommandRequest) => {
					authorizeClient(request);
					const name = record(request.envelope.payload)?.name;
					if (typeof name !== 'string' || !NAME_PATTERN.test(name))
						throw protocolError('validation', 'server name is invalid');
					if (!(await this.remove(name)))
						throw protocolError('not_found', `No connected server is named ${name}.`);
					return asJson({ name });
				},
			},
			policies: {
				[CONNECTED_SERVER_OPERATIONS.list]: policy,
				[CONNECTED_SERVER_OPERATIONS.save]: policy,
				[CONNECTED_SERVER_OPERATIONS.remove]: policy,
			},
		};
	}

	/**
	 * Write the credentials an edit names and return the names now set. With a
	 * `null` map the transport no longer uses this kind: everything is removed.
	 */
	private async applyCredentials(
		existing: ConnectedServerView | undefined,
		name: string,
		kind: 'env' | 'header',
		changes: Readonly<Record<string, string | null>> | null,
		renamed: boolean,
		keep: boolean,
	): Promise<readonly string[]> {
		const { vault } = this.options;
		const before = new Set(
			existing === undefined
				? []
				: kind === 'env'
					? existing.envNames
					: existing.headerNames,
		);
		const previousName = existing?.name ?? name;
		const after = new Set<string>();
		if (changes !== null) {
			for (const key of before) {
				if (Object.hasOwn(changes, key)) continue;
				// A credential was given for one destination. When the entry now
				// points somewhere else, it is not carried there unless given again.
				if (!keep) continue;
				after.add(key);
				// A rename moves the credentials it keeps to ids under the new name.
				if (renamed) {
					const value = await vault.withSecret(
						secretId(previousName, kind, key),
						(secret) => Uint8Array.from(secret),
					);
					await vault.put({ id: secretId(name, kind, key), label: label(name, kind, key), value });
				}
			}
			for (const [key, value] of Object.entries(changes)) {
				if (value === null) continue;
				const input = { id: secretId(name, kind, key), label: label(name, kind, key), value: encoder.encode(value) };
				if (before.has(key) && !renamed) await vault.replace(input);
				else await vault.put(input);
				after.add(key);
			}
		}
		for (const key of before)
			if (!after.has(key) || renamed)
				await vault.remove(secretId(previousName, kind, key)).catch(() => {});
		return [...after].sort();
	}

	private async commit(): Promise<void> {
		await this.options.backend.commit({ version: 1, servers: this.list() });
		this.options.eventJournal?.append(CONNECTED_SERVER_EVENTS.changed, {});
		for (const listener of [...this.listeners]) listener();
	}

	private serial<T>(work: () => Promise<T>): Promise<T> {
		const run = this.queue.then(work, work);
		this.queue = run.catch(() => {});
		return run;
	}
}

function label(name: string, kind: 'env' | 'header', key: string): string {
	return `MCP server ${name}: ${kind === 'env' ? 'variable' : 'header'} ${key}`.slice(0, 200);
}

/** Validate everything about an entry except its credentials' storage. */
function validate(input: ConnectedServerSaveInput): Omit<ConnectedServerView, 'envNames' | 'headerNames'> {
	if (!isRecord(input)) throw new ConnectedServerError('validation', 'The server definition is invalid.');
	if (typeof input.name !== 'string' || !NAME_PATTERN.test(input.name))
		throw new ConnectedServerError(
			'validation',
			'A name is 1 to 63 lowercase letters, digits, or hyphens, and starts with a letter or digit.',
		);
	if (input.previousName !== undefined && typeof input.previousName !== 'string')
		throw new ConnectedServerError('validation', 'The server definition is invalid.');
	const enabled = input.enabled !== false;
	if (input.transport === 'stdio') {
		const command = typeof input.command === 'string' ? input.command.trim() : '';
		if (command.length === 0 || command.length > MAX_COMMAND_CHARS || command.includes('\0'))
			throw new ConnectedServerError('validation', 'A local server needs a command to run.');
		const args = input.args ?? [];
		if (
			!Array.isArray(args) ||
			args.length > MAX_ARGS ||
			args.some((arg) => typeof arg !== 'string' || arg.length > MAX_COMMAND_CHARS || arg.includes('\0'))
		)
			throw new ConnectedServerError('validation', 'The arguments are invalid.');
		credentials(input.env, VARIABLE_NAME, 'environment variable');
		return { name: input.name, enabled, transport: 'stdio', command, args: [...args] };
	}
	if (input.transport === 'http') {
		let url: URL;
		try {
			url = new URL(String(input.url));
		} catch {
			throw new ConnectedServerError('validation', 'A remote server needs an http or https URL.');
		}
		if (
			(url.protocol !== 'https:' && url.protocol !== 'http:') ||
			url.username !== '' ||
			url.password !== '' ||
			url.toString().length > MAX_COMMAND_CHARS
		)
			throw new ConnectedServerError('validation', 'A remote server needs an http or https URL without credentials in it.');
		credentials(input.headers, HEADER_NAME, 'header');
		return { name: input.name, enabled, transport: 'http', url: url.toString() };
	}
	throw new ConnectedServerError('validation', 'A server is either a local command or a remote URL.');
}

function credentials(
	value: Readonly<Record<string, string | null>> | undefined,
	pattern: RegExp,
	noun: string,
): void {
	if (value === undefined) return;
	if (!isRecord(value) || Object.keys(value).length > MAX_NAMES)
		throw new ConnectedServerError('validation', `The ${noun}s are invalid.`);
	for (const [key, entry] of Object.entries(value)) {
		if (!pattern.test(key))
			throw new ConnectedServerError('validation', `"${key.slice(0, 40)}" is not a valid ${noun} name.`);
		if (entry !== null && (typeof entry !== 'string' || encoder.encode(entry).byteLength > MAX_VALUE_BYTES))
			throw new ConnectedServerError('validation', `The value of ${key} is invalid.`);
	}
}

function storedView(entry: unknown): ConnectedServerView {
	if (!isRecord(entry)) throw new ConnectedServerError('validation', 'invalid');
	const names = (value: unknown, pattern: RegExp): string[] =>
		Array.isArray(value)
			? value.filter((name): name is string => typeof name === 'string' && pattern.test(name)).slice(0, MAX_NAMES)
			: [];
	const base = validate(entry as unknown as ConnectedServerSaveInput);
	return {
		...base,
		envNames: base.transport === 'stdio' ? names(entry.envNames, VARIABLE_NAME) : [],
		headerNames: base.transport === 'http' ? names(entry.headerNames, HEADER_NAME) : [],
	};
}

function authorizeClient(request: QueryRequest | CommandRequest): void {
	try {
		assertAutomationAuthority(request.context);
	} catch {
		throw protocolError(
			'forbidden',
			'managing connected MCP servers requires authority to create terminals on this server',
		);
	}
}

function asProtocolError(error: unknown): unknown {
	if (!(error instanceof ConnectedServerError)) return error;
	return protocolError(error.code, error.message);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): JsonValue {
	return value as JsonValue;
}
