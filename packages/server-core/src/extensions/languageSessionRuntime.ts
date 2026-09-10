import { Buffer } from 'node:buffer';
import { type ChildProcess, spawn } from 'node:child_process';
import { isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
	LanguageCompletionItemDto,
	LanguageCompletionKind,
	LanguageDiagnosticDto,
	LanguageDiagnosticSeverity,
	LanguageLocationDto,
	LanguagePosition,
	LanguageRange,
} from '@terminay/protocol';
import {
	type ExtensionLanguageDiagnosticsNotification,
	type ExtensionLanguageMethod,
	type ExtensionLanguageSessionExit,
	parseExtensionLanguagePosition,
} from './languageProtocol.js';

/**
 * A minimal Language Server Protocol client, owned by the extension child.
 *
 * The extension supplies only argv and environment; framing, initialise,
 * document sync, deadlines, translation, and death are the host's. No LSP
 * JSON-RPC crosses the application protocol, and no third-party LSP client
 * library is involved: the wire format here is Content-Length framed JSON-RPC
 * and nothing else.
 */
export interface LanguageServerLaunchLike {
	readonly command: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	readonly initializationOptions?: unknown;
	readonly description?: string;
}

export interface LanguageServerProviderLike {
	launch(
		request: { languageServerId: string; projectRoot: string },
		signal: AbortSignal,
	): Promise<LanguageServerLaunchLike> | LanguageServerLaunchLike;
}

export interface LanguageSessionRuntimeOptions {
	/** Where a translated `publishDiagnostics` goes. */
	readonly onDiagnostics: (
		notification: ExtensionLanguageDiagnosticsNotification,
	) => void;
	/** Reported exactly once per session that ends without being asked to. */
	readonly onSessionExit: (exit: ExtensionLanguageSessionExit) => void;
	readonly spawnProcess?: typeof spawn;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly startTimeoutMs?: number;
	readonly requestTimeoutMs?: number;
	readonly shutdownTimeoutMs?: number;
}

const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_SESSIONS = 16;
const MAX_OPEN_DOCUMENTS = 64;
const MAX_COMPLETION_ITEMS = 200;
const MAX_DEFINITION_LOCATIONS = 50;
const MAX_DIAGNOSTICS = 500;
const MAX_TEXT_FIELD = 8 * 1024;
/** Bounded well below the private IPC frame limit so a result always fits. */
const MAX_RESULT_BYTES = 192 * 1024;
/** How much unframed stdout is buffered before the session is given up on.
 * Well above the largest legal frame, so no real message is ever refused. */
const MAX_STDOUT_BUFFER_BYTES = MAX_RESULT_BYTES * 8;
/** Names of the environment a language server inherits before `launch.env`. */
const INHERITED_ENVIRONMENT = Object.freeze([
	'PATH',
	'HOME',
	// Under Desktop the extension child is Electron running as Node; a language
	// server launched through `process.execPath` needs the same flag or it
	// starts a GUI instead of a server.
	'ELECTRON_RUN_AS_NODE',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TMPDIR',
	'TZ',
]);
const COMPLETION_KINDS: readonly LanguageCompletionKind[] = Object.freeze([
	'text',
	'method',
	'function',
	'constructor',
	'field',
	'variable',
	'class',
	'interface',
	'module',
	'property',
	'unit',
	'value',
	'enum',
	'keyword',
	'snippet',
	'color',
	'file',
	'reference',
	'folder',
	'enumMember',
	'constant',
	'struct',
	'event',
	'operator',
	'typeParameter',
]);
const SEVERITIES: readonly LanguageDiagnosticSeverity[] = Object.freeze([
	'error',
	'warning',
	'information',
	'hint',
]);

interface OpenDocument {
	readonly languageId: string;
	revision: number;
	version: number;
}

interface PendingRequest {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

class LanguageServerUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LanguageServerUnavailableError';
	}
}

class LanguageSession {
	private readonly documents = new Map<string, OpenDocument>();
	private readonly pending = new Map<number, PendingRequest>();
	private buffer = Buffer.alloc(0);
	/** How far the buffer has already been searched for a frame header. */
	private scanned = 0;
	private nextId = 0;
	private child: ChildProcess | undefined;
	private ended = false;
	private stoppedDeliberately = false;
	private startFailure: string | undefined;
	description: string | undefined;

	/** Whether this session's single exit has already been reported. */
	get exitReported(): boolean {
		return this.ended;
	}

	/**
	 * Mark a start that failed with the child already alive.
	 *
	 * The teardown that follows is not a deliberate stop, whatever it looks
	 * like from the outside: the one exit this session reports has to say
	 * `start-failed`, or the manager's failure cooldown is cleared by a
	 * `stopped` it never asked for and the server respawns on every keystroke.
	 */
	markStartFailed(failure: string): void {
		this.startFailure = failure;
	}

	constructor(
		readonly sessionId: string,
		readonly languageServerId: string,
		readonly projectRoot: string,
		private readonly options: Required<
			Pick<
				LanguageSessionRuntimeOptions,
				'onDiagnostics' | 'onSessionExit' | 'startTimeoutMs' | 'requestTimeoutMs' | 'shutdownTimeoutMs'
			>
		> & {
			readonly spawnProcess: typeof spawn;
			readonly environment: Readonly<Record<string, string | undefined>>;
		},
	) {}

	async start(
		launch: LanguageServerLaunchLike,
		signal: AbortSignal,
	): Promise<void> {
		if (
			typeof launch?.command !== 'string' ||
			launch.command.length === 0 ||
			launch.command.includes('\0')
		)
			throw new TypeError('language server launch command is invalid');
		const args = [...(launch.args ?? [])];
		if (args.some((value) => typeof value !== 'string' || value.includes('\0')))
			throw new TypeError('language server launch arguments are invalid');
		this.description = boundedText(launch.description, 200);
		const child = this.options.spawnProcess(launch.command, args, {
			cwd: this.projectRoot,
			env: languageServerEnvironment(this.options.environment, launch.env),
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.child = child;
		child.stdout?.on('data', (chunk: Buffer | string) =>
			this.receive(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk),
		);
		// A language server's stderr is diagnostic noise for a person, never a
		// protocol input. Read it so a chatty server cannot block on a full pipe.
		child.stderr?.on('data', () => undefined);
		child.once('error', (error) =>
			this.die('exited', { failure: boundedText(error.message, 512) }),
		);
		child.once('exit', (code, terminationSignal) =>
			this.die('exited', {
				...(typeof code === 'number' ? { exitCode: code } : {}),
				...(typeof terminationSignal === 'string'
					? { signal: terminationSignal }
					: {}),
			}),
		);
		await this.request(
			'initialize',
			{
				processId: process.pid,
				clientInfo: { name: 'Terminay', version: '1' },
				rootUri: pathToFileURL(this.projectRoot).href,
				rootPath: this.projectRoot,
				workspaceFolders: [
					{
						uri: pathToFileURL(this.projectRoot).href,
						name: 'workspace',
					},
				],
				capabilities: clientCapabilities(),
				...(launch.initializationOptions === undefined
					? {}
					: { initializationOptions: launch.initializationOptions }),
			},
			this.options.startTimeoutMs,
			signal,
		);
		this.notify('initialized', {});
	}

	openDocument(path: string, languageId: string, text: string, revision: number): void {
		if (this.documents.has(path)) {
			this.changeDocument(path, text, revision);
			return;
		}
		if (this.documents.size >= MAX_OPEN_DOCUMENTS)
			throw new LanguageServerUnavailableError(
				'language session open document limit reached',
			);
		this.documents.set(path, { languageId, revision, version: 1 });
		this.notify('textDocument/didOpen', {
			textDocument: {
				uri: this.uri(path),
				languageId,
				version: 1,
				text,
			},
		});
	}

	changeDocument(path: string, text: string, revision: number): void {
		const document = this.documents.get(path);
		if (document === undefined)
			throw new LanguageServerUnavailableError(
				'language document is not open in this session',
			);
		document.revision = revision;
		document.version += 1;
		this.notify('textDocument/didChange', {
			textDocument: { uri: this.uri(path), version: document.version },
			contentChanges: [{ text }],
		});
	}

	closeDocument(path: string): boolean {
		if (!this.documents.delete(path)) return false;
		this.notify('textDocument/didClose', {
			textDocument: { uri: this.uri(path) },
		});
		return true;
	}

	watchedFilesChanged(
		changes: readonly { readonly path: string; readonly kind: string }[],
	): void {
		if (changes.length === 0) return;
		this.notify('workspace/didChangeWatchedFiles', {
			changes: changes.map((change) => ({
				uri: this.uri(change.path),
				type:
					change.kind === 'created' ? 1 : change.kind === 'deleted' ? 3 : 2,
			})),
		});
	}

	get openDocumentCount(): number {
		return this.documents.size;
	}

	revisionOf(path: string): number | undefined {
		return this.documents.get(path)?.revision;
	}

	async completion(
		path: string,
		position: LanguagePosition,
		signal: AbortSignal,
	): Promise<{
		readonly items: readonly LanguageCompletionItemDto[];
		readonly isIncomplete: boolean;
		readonly isTruncated: boolean;
	}> {
		const result = await this.request(
			'textDocument/completion',
			{
				textDocument: { uri: this.uri(path) },
				position: { line: position.line, character: position.character },
			},
			this.options.requestTimeoutMs,
			signal,
		);
		const list = Array.isArray(result)
			? result
			: Array.isArray(record(result)?.items)
				? (record(result)?.items as unknown[])
				: [];
		const isIncomplete = record(result)?.isIncomplete === true;
		const items: LanguageCompletionItemDto[] = [];
		for (const entry of list.slice(0, MAX_COMPLETION_ITEMS)) {
			const item = translateCompletionItem(entry);
			if (item !== undefined) items.push(item);
		}
		const bounded = boundByBytes(items);
		return {
			items: bounded.items,
			isIncomplete,
			isTruncated: bounded.truncated || list.length > MAX_COMPLETION_ITEMS,
		};
	}

	async hover(
		path: string,
		position: LanguagePosition,
		signal: AbortSignal,
	): Promise<{
		readonly contents: string | null;
		readonly range?: LanguageRange;
		readonly isTruncated: boolean;
	}> {
		const result = record(
			await this.request(
				'textDocument/hover',
				{
					textDocument: { uri: this.uri(path) },
					position: { line: position.line, character: position.character },
				},
				this.options.requestTimeoutMs,
				signal,
			),
		);
		if (result === undefined) return { contents: null, isTruncated: false };
		const markdown = hoverMarkdown(result.contents);
		const range = translateRange(result.range);
		const truncated = markdown !== undefined && markdown.length > MAX_TEXT_FIELD;
		return {
			contents:
				markdown === undefined || markdown.length === 0
					? null
					: markdown.slice(0, MAX_TEXT_FIELD),
			...(range === undefined ? {} : { range }),
			isTruncated: truncated,
		};
	}

	async definition(
		path: string,
		position: LanguagePosition,
		signal: AbortSignal,
	): Promise<{
		readonly locations: readonly LanguageLocationDto[];
		readonly isTruncated: boolean;
	}> {
		const result = await this.request(
			'textDocument/definition',
			{
				textDocument: { uri: this.uri(path) },
				position: { line: position.line, character: position.character },
			},
			this.options.requestTimeoutMs,
			signal,
		);
		const entries = Array.isArray(result)
			? result
			: result === null || result === undefined
				? []
				: [result];
		const locations: LanguageLocationDto[] = [];
		for (const entry of entries) {
			if (locations.length >= MAX_DEFINITION_LOCATIONS) break;
			const location = this.translateLocation(entry);
			// A target outside the project is deliberately dropped rather than
			// exposed: the protocol names project-relative paths only.
			if (location !== undefined) locations.push(location);
		}
		return {
			locations,
			isTruncated: entries.length > MAX_DEFINITION_LOCATIONS,
		};
	}

	async stop(): Promise<void> {
		if (this.ended) return;
		this.stoppedDeliberately = true;
		const child = this.child;
		if (child === undefined) return;
		const exited = new Promise<void>((resolve) => {
			child.once('exit', () => resolve());
		});
		try {
			await Promise.race([
				(async () => {
					await this.request(
						'shutdown',
						null,
						this.options.shutdownTimeoutMs,
						undefined,
					);
					this.notify('exit', undefined);
					await exited;
				})(),
				new Promise<void>((resolve) =>
					setTimeout(resolve, this.options.shutdownTimeoutMs).unref?.(),
				),
			]);
		} catch {
			/* a language server that will not shut down politely is killed */
		}
		this.die('stopped', {});
		child.kill('SIGKILL');
	}

	private uri(path: string): string {
		return pathToFileURL(resolvePath(this.projectRoot, path)).href;
	}

	private translateLocation(value: unknown): LanguageLocationDto | undefined {
		const entry = record(value);
		if (entry === undefined) return undefined;
		const uri =
			typeof entry.uri === 'string'
				? entry.uri
				: typeof entry.targetUri === 'string'
					? entry.targetUri
					: undefined;
		const range = translateRange(entry.range ?? entry.targetSelectionRange ?? entry.targetRange);
		if (uri === undefined || range === undefined) return undefined;
		let absolute: string;
		try {
			absolute = fileURLToPath(uri);
		} catch {
			return undefined;
		}
		const relativePath = relative(this.projectRoot, absolute);
		if (
			relativePath.length === 0 ||
			relativePath.startsWith('..') ||
			isAbsolute(relativePath)
		)
			return undefined;
		return { path: relativePath.split(sep).join('/'), range };
	}

	private notify(method: string, params: unknown): void {
		this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
	}

	private request(
		method: string,
		params: unknown,
		timeoutMs: number,
		signal: AbortSignal | undefined,
	): Promise<unknown> {
		if (this.ended || this.child === undefined)
			return Promise.reject(
				new LanguageServerUnavailableError('language session is unavailable'),
			);
		if (signal?.aborted)
			return Promise.reject(new Error('language request cancelled'));
		const id = ++this.nextId;
		return new Promise<unknown>((resolve, reject) => {
			const settle = (error?: Error, value?: unknown): void => {
				const entry = this.pending.get(id);
				if (entry === undefined) return;
				this.pending.delete(id);
				clearTimeout(entry.timer);
				signal?.removeEventListener('abort', abort);
				error === undefined ? resolve(value) : reject(error);
			};
			const abort = (): void =>
				settle(new Error('language request cancelled'));
			const timer = setTimeout(
				() => settle(new Error('language request timed out')),
				timeoutMs,
			);
			timer.unref?.();
			this.pending.set(id, {
				resolve: (value) => settle(undefined, value),
				reject: (error) => settle(error),
				timer,
			});
			signal?.addEventListener('abort', abort, { once: true });
			this.write({ jsonrpc: '2.0', id, method, params: params ?? null });
		});
	}

	private write(message: unknown): void {
		const stdin = this.child?.stdin;
		if (stdin === undefined || stdin === null || this.ended) return;
		const body = Buffer.from(JSON.stringify(message), 'utf8');
		try {
			stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
			stdin.write(body);
		} catch {
			/* the exit handler owns the death this write discovered */
		}
	}

	private receive(chunk: Buffer): void {
		this.buffer =
			this.buffer.byteLength === 0
				? chunk
				: Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const headerEnd = headerTerminator(this.buffer, this.scanned);
			if (headerEnd < 0) {
				// Only the last three bytes can still begin a terminator, so the next
				// chunk resumes there instead of rescanning everything seen so far.
				this.scanned = Math.max(0, this.buffer.byteLength - 3);
				if (this.buffer.byteLength > MAX_STDOUT_BUFFER_BYTES) {
					this.buffer = Buffer.alloc(0);
					this.scanned = 0;
					// A stream this large with no frame header is not going to become
					// framed, and buffering it is a memory hazard.
					this.die('exited', {
						failure: 'language server stdout exceeded the framing limit',
					});
					// This death is the host's decision, not one it observed, so the
					// child it gave up on has to be reaped here.
					this.child?.kill('SIGKILL');
				}
				return;
			}
			this.scanned = 0;
			const header = this.buffer.subarray(0, headerEnd).toString('ascii');
			const match = /content-length:\s*(\d+)/i.exec(header);
			if (match === null) {
				// An unframed byte stream is not recoverable by guessing.
				this.buffer = Buffer.alloc(0);
				return;
			}
			const length = Number(match[1]);
			const start = headerEnd + 4;
			if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESULT_BYTES * 8) {
				this.buffer = Buffer.alloc(0);
				return;
			}
			if (this.buffer.byteLength < start + length) return;
			const body = this.buffer.subarray(start, start + length).toString('utf8');
			this.buffer = this.buffer.subarray(start + length);
			let message: unknown;
			try {
				message = JSON.parse(body);
			} catch {
				continue;
			}
			this.dispatch(message);
		}
	}

	private dispatch(message: unknown): void {
		const value = record(message);
		if (value === undefined) return;
		if (value.id !== undefined && value.method === undefined) {
			const pending = this.pending.get(Number(value.id));
			if (pending === undefined) return;
			const error = record(value.error);
			if (error === undefined) pending.resolve(value.result);
			else
				pending.reject(
					new Error(
						boundedText(String(error.message ?? 'language request failed'), 512) ??
							'language request failed',
					),
				);
			return;
		}
		if (typeof value.method !== 'string') return;
		if (value.method === 'textDocument/publishDiagnostics') {
			this.publishDiagnostics(record(value.params));
			return;
		}
		// A server-initiated request must be answered or the server stalls. The
		// surface is deliberately small: nothing here grants the language server
		// anything it did not already have as a child of this process.
		if (value.id !== undefined) {
			this.write({
				jsonrpc: '2.0',
				id: value.id,
				result:
					value.method === 'workspace/configuration'
						? (record(value.params)?.items as unknown[] | undefined)?.map(
								() => null,
							) ?? []
						: null,
			});
		}
	}

	private publishDiagnostics(params: Record<string, unknown> | undefined): void {
		if (params === undefined || typeof params.uri !== 'string') return;
		let absolute: string;
		try {
			absolute = fileURLToPath(params.uri);
		} catch {
			return;
		}
		const relativePath = relative(this.projectRoot, absolute);
		if (
			relativePath.length === 0 ||
			relativePath.startsWith('..') ||
			isAbsolute(relativePath)
		)
			return;
		const path = relativePath.split(sep).join('/');
		const entries = Array.isArray(params.diagnostics) ? params.diagnostics : [];
		const diagnostics: LanguageDiagnosticDto[] = [];
		for (const entry of entries.slice(0, MAX_DIAGNOSTICS)) {
			const diagnostic = translateDiagnostic(entry);
			if (diagnostic !== undefined) diagnostics.push(diagnostic);
		}
		const revision = this.documents.get(path)?.revision;
		this.options.onDiagnostics({
			sessionId: this.sessionId,
			path,
			...(revision === undefined ? {} : { revision }),
			diagnostics,
			isTruncated: entries.length > MAX_DIAGNOSTICS,
		});
	}

	/** One death, reported once, whatever discovers it. */
	private die(
		reason: ExtensionLanguageSessionExit['reason'],
		detail: { exitCode?: number; signal?: string; failure?: string },
	): void {
		if (this.ended) return;
		this.ended = true;
		// Reject through the pending entry so its own settle path runs: deleting
		// it here first would make every waiter hang until its deadline instead.
		for (const pending of [...this.pending.values()])
			pending.reject(
				new LanguageServerUnavailableError('language server exited'),
			);
		this.documents.clear();
		this.options.onSessionExit({
			sessionId: this.sessionId,
			languageServerId: this.languageServerId,
			reason:
				this.startFailure !== undefined
					? 'start-failed'
					: this.stoppedDeliberately
						? 'stopped'
						: reason,
			...detail,
			...(this.startFailure === undefined
				? {}
				: { failure: detail.failure ?? this.startFailure }),
		});
	}
}

/** The child-side owner of every language session this extension runs. */
export class LanguageSessionRuntime {
	private readonly registrations = new Map<string, LanguageServerProviderLike>();
	private readonly sessions = new Map<string, LanguageSession>();
	private readonly options: LanguageSessionRuntimeOptions;

	constructor(options: LanguageSessionRuntimeOptions) {
		this.options = options;
	}

	register(id: string, runtime: LanguageServerProviderLike): void {
		this.registrations.set(id, runtime);
	}

	unregister(id: string): void {
		this.registrations.delete(id);
	}

	has(id: string): boolean {
		return this.registrations.has(id);
	}

	async handle(
		method: ExtensionLanguageMethod,
		input: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<unknown> {
		switch (method) {
			case 'language.session.start':
				return this.startSession(input, signal);
			case 'language.session.stop': {
				const session = this.sessions.get(text(input.sessionId));
				this.sessions.delete(text(input.sessionId));
				await session?.stop();
				return { stopped: session !== undefined };
			}
			case 'language.document.open': {
				const session = this.session(input.sessionId);
				session.openDocument(
					languagePath(input.path),
					text(input.languageId),
					documentText(input.text),
					revision(input.revision),
				);
				return { open: true };
			}
			case 'language.document.change': {
				const session = this.session(input.sessionId);
				session.changeDocument(
					languagePath(input.path),
					documentText(input.text),
					revision(input.revision),
				);
				return { changed: true };
			}
			case 'language.document.close':
				return {
					closed: this.session(input.sessionId).closeDocument(
						languagePath(input.path),
					),
				};
			case 'language.completion':
				return this.session(input.sessionId).completion(
					languagePath(input.path),
					position(input.position),
					signal,
				);
			case 'language.hover':
				return this.session(input.sessionId).hover(
					languagePath(input.path),
					position(input.position),
					signal,
				);
			case 'language.definition':
				return this.session(input.sessionId).definition(
					languagePath(input.path),
					position(input.position),
					signal,
				);
			case 'language.watched-files.changed': {
				const session = this.sessions.get(text(input.sessionId));
				const changes = Array.isArray(input.changes) ? input.changes : [];
				session?.watchedFilesChanged(
					changes.slice(0, 256).flatMap((entry) => {
						const change = record(entry);
						return change === undefined || typeof change.path !== 'string'
							? []
							: [
									{
										path: languagePath(change.path),
										kind: String(change.kind ?? 'changed'),
									},
								];
					}),
				);
				return { notified: session !== undefined };
			}
		}
	}

	async stopAll(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.allSettled(sessions.map((session) => session.stop()));
	}

	private async startSession(
		input: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<unknown> {
		const sessionId = text(input.sessionId);
		const languageServerId = text(input.languageServerId);
		const projectRoot = input.projectRoot;
		if (
			typeof projectRoot !== 'string' ||
			!isAbsolute(projectRoot) ||
			projectRoot.includes('\0')
		)
			throw new TypeError('language session project root is invalid');
		const existing = this.sessions.get(sessionId);
		if (existing !== undefined)
			return {
				sessionId,
				state: 'ready',
				...(existing.description === undefined
					? {}
					: { description: existing.description }),
			};
		if (this.sessions.size >= MAX_SESSIONS)
			throw new LanguageServerUnavailableError(
				'extension language session limit reached',
			);
		const provider = this.registrations.get(languageServerId);
		if (provider === undefined)
			throw new Error('language server is not registered by this extension');
		const session = new LanguageSession(
			sessionId,
			languageServerId,
			projectRoot,
			{
				onDiagnostics: this.options.onDiagnostics,
				onSessionExit: (exit) => {
					this.sessions.delete(exit.sessionId);
					this.options.onSessionExit(exit);
				},
				spawnProcess: this.options.spawnProcess ?? spawn,
				environment: this.options.environment ?? process.env,
				startTimeoutMs: this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
				requestTimeoutMs:
					this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
				shutdownTimeoutMs:
					this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
			},
		);
		this.sessions.set(sessionId, session);
		try {
			const launch = await provider.launch(
				{ languageServerId, projectRoot },
				signal,
			);
			await session.start(launch, signal);
		} catch (error) {
			this.sessions.delete(sessionId);
			const failure =
				boundedText(
					error instanceof Error ? error.message : 'language server failed to start',
					512,
				) ?? 'language server failed to start';
			// Exactly one exit is reported for a failed start: the teardown below
			// would otherwise report `stopped` first, and a `stopped` clears the
			// manager's failure cooldown.
			session.markStartFailed(failure);
			await session.stop().catch(() => undefined);
			if (!session.exitReported)
				this.options.onSessionExit({
					sessionId,
					languageServerId,
					reason: 'start-failed',
					failure,
				});
			throw error;
		}
		return {
			sessionId,
			state: 'ready',
			...(session.description === undefined
				? {}
				: { description: session.description }),
		};
	}

	private session(value: unknown): LanguageSession {
		const session = this.sessions.get(text(value));
		if (session === undefined)
			throw new LanguageServerUnavailableError('language session is unavailable');
		return session;
	}
}

/** The environment a language server starts with: a minimal inherited set,
 * then exactly what the extension asked for. Nothing else of the server
 * account's environment reaches it. */
export function languageServerEnvironment(
	source: Readonly<Record<string, string | undefined>>,
	overlay: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const key of INHERITED_ENVIRONMENT) {
		const value = source[key];
		if (typeof value === 'string' && value.length > 0) environment[key] = value;
	}
	for (const [key, value] of Object.entries(overlay ?? {})) {
		if (
			/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) &&
			typeof value === 'string' &&
			!value.includes('\0')
		)
			environment[key] = value;
	}
	return environment;
}

function clientCapabilities(): Record<string, unknown> {
	return {
		workspace: {
			workspaceFolders: true,
			didChangeWatchedFiles: { dynamicRegistration: false },
			configuration: false,
		},
		textDocument: {
			synchronization: {
				dynamicRegistration: false,
				willSave: false,
				willSaveWaitUntil: false,
				didSave: false,
			},
			completion: {
				dynamicRegistration: false,
				contextSupport: false,
				completionItem: {
					snippetSupport: false,
					documentationFormat: ['markdown', 'plaintext'],
				},
			},
			hover: {
				dynamicRegistration: false,
				contentFormat: ['markdown', 'plaintext'],
			},
			definition: { dynamicRegistration: false, linkSupport: false },
			publishDiagnostics: { relatedInformation: false, versionSupport: false },
		},
	};
}

function translateCompletionItem(
	value: unknown,
): LanguageCompletionItemDto | undefined {
	const item = record(value);
	if (item === undefined || typeof item.label !== 'string' || item.label.length === 0)
		return undefined;
	const kind =
		typeof item.kind === 'number' ? COMPLETION_KINDS[item.kind - 1] : undefined;
	const insertText =
		typeof item.insertText === 'string'
			? item.insertText
			: typeof record(item.textEdit)?.newText === 'string'
				? (record(item.textEdit)?.newText as string)
				: undefined;
	return {
		label: item.label.slice(0, 512),
		...(kind === undefined ? {} : { kind }),
		...(typeof item.detail === 'string'
			? { detail: item.detail.slice(0, 1024) }
			: {}),
		...(insertText === undefined
			? {}
			: { insertText: insertText.slice(0, 1024) }),
		...(typeof item.sortText === 'string'
			? { sortText: item.sortText.slice(0, 512) }
			: {}),
		...(typeof item.filterText === 'string'
			? { filterText: item.filterText.slice(0, 512) }
			: {}),
		...(hoverMarkdown(item.documentation) === undefined
			? {}
			: {
					documentation: (hoverMarkdown(item.documentation) as string).slice(
						0,
						2048,
					),
				}),
	};
}

function translateDiagnostic(value: unknown): LanguageDiagnosticDto | undefined {
	const diagnostic = record(value);
	const range = translateRange(diagnostic?.range);
	if (
		diagnostic === undefined ||
		range === undefined ||
		typeof diagnostic.message !== 'string'
	)
		return undefined;
	const severity =
		typeof diagnostic.severity === 'number'
			? SEVERITIES[diagnostic.severity - 1]
			: undefined;
	const code =
		typeof diagnostic.code === 'string' || typeof diagnostic.code === 'number'
			? String(diagnostic.code).slice(0, 128)
			: undefined;
	return {
		range,
		severity: severity ?? 'error',
		message: diagnostic.message.slice(0, 4096),
		...(code === undefined ? {} : { code }),
		...(typeof diagnostic.source === 'string'
			? { source: diagnostic.source.slice(0, 128) }
			: {}),
	};
}

function translateRange(value: unknown): LanguageRange | undefined {
	const range = record(value);
	const start = parseExtensionLanguagePosition(range?.start);
	const end = parseExtensionLanguagePosition(range?.end);
	if (start === undefined || end === undefined) return undefined;
	if (end.line < start.line || (end.line === start.line && end.character < start.character))
		return { start, end: start };
	return { start, end };
}

function hoverMarkdown(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (Array.isArray(value))
		return value
			.map((entry) => hoverMarkdown(entry))
			.filter((entry): entry is string => typeof entry === 'string')
			.join('\n\n');
	const content = record(value);
	if (content === undefined) return undefined;
	if (typeof content.value === 'string')
		return typeof content.language === 'string'
			? `\`\`\`${content.language}\n${content.value}\n\`\`\``
			: content.value;
	return undefined;
}

function boundByBytes(items: readonly LanguageCompletionItemDto[]): {
	readonly items: readonly LanguageCompletionItemDto[];
	readonly truncated: boolean;
} {
	let current = [...items];
	let truncated = false;
	while (
		current.length > 0 &&
		Buffer.byteLength(JSON.stringify(current), 'utf8') > MAX_RESULT_BYTES
	) {
		current = current.slice(0, Math.floor(current.length / 2));
		truncated = true;
	}
	return { items: current, truncated };
}

/** Index of the CRLFCRLF that ends a frame's headers, or -1. Scanning resumes
 * at `from` so a stream that arrives in many chunks is read once, not once per
 * chunk. */
function headerTerminator(buffer: Buffer, from = 0): number {
	for (let index = Math.max(0, from); index + 3 < buffer.byteLength; index += 1) {
		if (
			buffer[index] === 13 &&
			buffer[index + 1] === 10 &&
			buffer[index + 2] === 13 &&
			buffer[index + 3] === 10
		)
			return index;
	}
	return -1;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function text(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 200)
		throw new TypeError('language request field is invalid');
	return value;
}
function languagePath(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 4096 ||
		value.startsWith('/') ||
		value.includes('\0') ||
		value.includes('\\') ||
		value.split('/').some((segment) => segment === '..' || segment === '')
	)
		throw new TypeError('language request path is invalid');
	return value;
}
function documentText(value: unknown): string {
	if (typeof value !== 'string')
		throw new TypeError('language document text is invalid');
	return value;
}
function revision(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new TypeError('language document revision is invalid');
	return value;
}
function position(value: unknown): LanguagePosition {
	const parsed = parseExtensionLanguagePosition(value);
	if (parsed === undefined)
		throw new TypeError('language request position is invalid');
	return parsed;
}
function boundedText(
	value: string | undefined,
	limit: number,
): string | undefined {
	return typeof value === 'string' && value.length > 0
		? value.replace(/[\r\n]/gu, ' ').slice(0, limit)
		: undefined;
}
