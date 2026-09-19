import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { EXTENSION_API_VERSION, EXTENSION_LIMITS } from './constants.js';
import type {
	AgentSessionPublisher,
	AgentSessionSnapshot,
	AgentSessionSourceDiagnostic,
	AgentSessionSourceRuntime,
	Disposable,
	ExtensionContext,
	JsonValue,
	LanguageServerLaunch,
	LanguageServerLaunchRequest,
	LanguageServerProviderRuntime,
	LanguageServerRegistration,
	McpInstallTargetActionResult,
	McpInstallTargetRequest,
	McpInstallTargetRuntime,
	McpInstallTargetStatus,
	McpServerCommand,
	ProviderVaultBinding,
	ProviderVaultBroker,
	TerminayExtension,
	TerminayExtensionManifest,
} from './types.js';
import {
	ExtensionSchemaError,
	type SchemaIssue,
	type ValidationResult,
	validateAgentSessionReset,
	validateAgentSessionSnapshot,
	validateAgentSessionSourceDiagnostic,
	validateMcpInstallTargetActionResult,
	validateMcpInstallTargetStatus,
	validateMcpServerCommand,
	validateProviderVaultPutRequest,
	validateProviderVaultRemoveRequest,
	validateProviderVaultWithSecretRequest,
} from './validation.js';

interface FixtureVaultEntry {
	binding: ProviderVaultBinding;
	bindingKey: string;
	purpose: string;
	value: Uint8Array;
	revision: number;
	state: 'active' | 'pending' | 'deleted';
	activeUses: number;
	putResults: Map<string, { binding: ProviderVaultBinding; revision: number }>;
	removeResults: Map<string, { state: 'deleted' | 'pending' }>;
}

/**
 * Creates a one-scope in-memory vault broker for extension tests. It validates
 * the public contract, models callback lifetime/zeroization and pending
 * removal, but deliberately does not pretend to enforce cross-extension or
 * installation security. Production hosts must enforce that boundary.
 */
export function createProviderVaultHarness(): ProviderVaultBroker {
	const entriesByKey = new Map<string, FixtureVaultEntry>();
	const entriesByBinding = new Map<string, FixtureVaultEntry>();
	const unavailable = (): never => {
		throw new Error('Vault binding unavailable');
	};
	const dispose = (entry: FixtureVaultEntry): void => {
		entry.value.fill(0);
		entry.state = 'deleted';
		entriesByKey.delete(entry.bindingKey);
	};
	const entryFor = (binding: ProviderVaultBinding): FixtureVaultEntry => {
		const entry = entriesByBinding.get(binding.bindingRef);
		if (entry?.state !== 'active') return unavailable();
		return entry;
	};

	return {
		async put(request) {
			assertValid(
				validateProviderVaultPutRequest(request),
				'Invalid provider vault put request',
			);
			const existing = entriesByKey.get(request.bindingKey);
			if (existing?.state === 'active') {
				const repeated = existing.putResults.get(request.idempotencyKey);
				if (repeated) return repeated;
				if (
					request.expectedRevision !== undefined &&
					request.expectedRevision !== existing.revision
				)
					throw new Error('Vault revision conflict');
				const received = request.value.slice();
				const stored = received.slice();
				received.fill(0);
				existing.value.fill(0);
				existing.value = stored;
				existing.purpose = request.purpose;
				existing.revision += 1;
				const result = {
					binding: existing.binding,
					revision: existing.revision,
				};
				existing.putResults.set(request.idempotencyKey, result);
				return result;
			}
			if (request.expectedRevision !== undefined)
				throw new Error('Vault revision conflict');
			const received = request.value.slice();
			const stored = received.slice();
			received.fill(0);
			const binding = Object.freeze({ bindingRef: fixtureBindingRef() });
			const entry: FixtureVaultEntry = {
				binding,
				bindingKey: request.bindingKey,
				purpose: request.purpose,
				value: stored,
				revision: 0,
				state: 'active',
				activeUses: 0,
				putResults: new Map(),
				removeResults: new Map(),
			};
			entriesByKey.set(entry.bindingKey, entry);
			entriesByBinding.set(binding.bindingRef, entry);
			const result = { binding, revision: entry.revision };
			entry.putResults.set(request.idempotencyKey, result);
			return result;
		},
		async withSecret(request, use) {
			assertValid(
				validateProviderVaultWithSecretRequest(request),
				'Invalid provider vault secret request',
			);
			if (typeof use !== 'function')
				throw new ExtensionSchemaError('Invalid provider vault callback', [
					{
						path: '$.use',
						code: 'invalid_type',
						message: 'Expected a local callback function',
					},
				]);
			const entry = entryFor(request.binding);
			if (entry.purpose !== request.purpose) return unavailable();
			entry.activeUses += 1;
			const parentCopy = entry.value.slice();
			const childCopy = parentCopy.slice();
			parentCopy.fill(0);
			try {
				return await use(childCopy);
			} finally {
				childCopy.fill(0);
				entry.activeUses -= 1;
				if (entry.state === 'pending' && entry.activeUses === 0) dispose(entry);
			}
		},
		async remove(request) {
			assertValid(
				validateProviderVaultRemoveRequest(request),
				'Invalid provider vault remove request',
			);
			const entry = entriesByBinding.get(request.binding.bindingRef);
			if (!entry || entry.state === 'deleted') return unavailable();
			const repeated = entry.removeResults.get(request.idempotencyKey);
			if (repeated) return repeated;
			if (
				request.expectedRevision !== undefined &&
				request.expectedRevision !== entry.revision
			)
				throw new Error('Vault revision conflict');
			const result = {
				state:
					entry.activeUses > 0 ? ('pending' as const) : ('deleted' as const),
			};
			entry.removeResults.set(request.idempotencyKey, result);
			if (result.state === 'pending') entry.state = 'pending';
			else dispose(entry);
			return result;
		},
	};
}

let fixtureBindingSequence = 0;
function fixtureBindingRef(): string {
	return `fixture_vault_ref_${(++fixtureBindingSequence).toString(36).padStart(16, '0')}`;
}

function assertValid<T>(
	result:
		| { ok: true; value: T }
		| {
				ok: false;
				issues: readonly { path: string; code: string; message: string }[];
		  },
	message: string,
): T {
	if (!result.ok) throw new ExtensionSchemaError(message, [...result.issues]);
	return result.value;
}

export type ExtensionReleaseReason =
	| 'disabled'
	| 'updated'
	| 'shutdown'
	| 'extension-host-failure';

/** One publisher call a session source made, in order. */
export type SessionPublication =
	| { kind: 'reset'; sourceId: string; sessions: AgentSessionSnapshot[] }
	| { kind: 'upsert'; sourceId: string; session: AgentSessionSnapshot }
	| { kind: 'remove'; sourceId: string; sessionId: string };

/** A contract breach the harness observed. The host would refuse the same call. */
export interface HarnessViolation {
	sourceId: string;
	call: 'reset' | 'upsert' | 'remove' | 'diagnostic';
	issues: SchemaIssue[];
}

export interface AgentExtensionHarnessOptions {
	/** When given, registration is checked against its declared contributions. */
	manifest?: TerminayExtensionManifest;
}

export interface SessionSourceStartOptions {
	/** Defaults to every declared harness, or to none checked without a manifest. */
	enabledHarnesses?: readonly string[];
}

export interface AgentExtensionHarness {
	/** Source ids the extension registered, in registration order. */
	registeredSourceIds(): readonly string[];
	/** MCP install target ids the extension registered, in registration order. */
	registeredTargetIds(): readonly string[];
	/** Starts one registered source (the first when omitted). */
	start(sourceId?: string, options?: SessionSourceStartOptions): Promise<void>;
	/** Delivers a harness switch change to a running source, as the host does. */
	setEnabledHarnesses(
		enabledHarnesses: readonly string[],
		sourceId?: string,
	): void;
	/** Aborts a running source's signal, as disabling agent status does. */
	stop(sourceId?: string): void;
	/** The live sessions the host would hold for a source, by id. */
	sessions(sourceId?: string): readonly AgentSessionSnapshot[];
	publications(): readonly SessionPublication[];
	diagnostics(): readonly AgentSessionSourceDiagnostic[];
	violations(): readonly HarnessViolation[];
	/** Throws when any publication breached the contract. */
	assertConformant(): void;
	/**
	 * Resolves once `predicate` holds for the published state, re-checked after
	 * every publication; rejects after `timeoutMs`.
	 */
	waitFor(
		predicate: (harness: AgentExtensionHarness) => boolean,
		timeoutMs?: number,
	): Promise<void>;
	mcpStatus(
		targetId: string,
		server?: McpServerCommand,
	): Promise<McpInstallTargetStatus>;
	mcpInstall(
		targetId: string,
		server?: McpServerCommand,
	): Promise<McpInstallTargetActionResult>;
	mcpUninstall(
		targetId: string,
		server?: McpServerCommand,
	): Promise<McpInstallTargetActionResult>;
	release(reason: ExtensionReleaseReason): Promise<void>;
	dispose(): Promise<void>;
}

/** A plausible host-supplied MCP server command for target tests. */
export const fixtureMcpServerCommand: McpServerCommand = Object.freeze({
	command: '/Applications/Terminay.app/Contents/MacOS/Terminay',
	args: ['/Applications/Terminay.app/Contents/Resources/serverMcpEntry.js'],
	env: { ELECTRON_RUN_AS_NODE: '1' },
});

interface RunningSource {
	controller: AbortController;
	enabled: Set<string>;
	listeners: Set<(enabled: readonly string[]) => void>;
	live: Map<string, AgentSessionSnapshot>;
}

/**
 * Activates an agent extension in memory and applies the host's rules to its
 * session sources and MCP install targets: manifest/registration agreement,
 * snapshot bounds, declared and enabled harnesses, reset/upsert/removal
 * validity, cancellation, and privacy exclusions (snapshots are closed
 * objects, so transcript or raw record fields are refused).
 */
export async function createAgentExtensionHarness(
	extension: TerminayExtension,
	options: AgentExtensionHarnessOptions = {},
): Promise<AgentExtensionHarness> {
	const manifest = options.manifest;
	const sourceDeclarations = new Map(
		(manifest?.contributes.agentSessionSources ?? []).map((source) => [
			source.id,
			source,
		]),
	);
	const targetDeclarations = new Set(
		(manifest?.contributes.mcpInstallTargets ?? []).map((target) => target.id),
	);
	const sources = new Map<string, AgentSessionSourceRuntime>();
	const targets = new Map<string, McpInstallTargetRuntime>();
	const running = new Map<string, RunningSource>();
	const subscriptions: Disposable[] = [];
	const publications: SessionPublication[] = [];
	const diagnostics: AgentSessionSourceDiagnostic[] = [];
	const violations: HarnessViolation[] = [];
	const waiters = new Set<() => void>();
	let released = false;

	const notify = (): void => {
		for (const waiter of [...waiters]) waiter();
	};
	const pickSource = (sourceId?: string): string => {
		const id = sourceId ?? sources.keys().next().value;
		if (id === undefined || !sources.has(id))
			throw new Error(`Unknown session source: ${String(sourceId)}`);
		return id;
	};

	const context: ExtensionContext = {
		extensionId: manifest?.id ?? 'test.extension',
		apiVersion: EXTENSION_API_VERSION,
		paths: {
			configuration: '/fixture/config',
			data: '/fixture/data',
			cache: '/fixture/cache',
		},
		agents: {
			registerSessionSource(sourceId, runtime) {
				if (released) throw new Error('extension is deactivated');
				if (manifest && !sourceDeclarations.has(sourceId))
					throw new Error('session source registration is undeclared');
				if (sources.has(sourceId))
					throw new Error(`Duplicate session source: ${sourceId}`);
				sources.set(sourceId, runtime);
				return {
					sourceId,
					dispose(): void {
						running.get(sourceId)?.controller.abort();
						running.delete(sourceId);
						sources.delete(sourceId);
					},
				};
			},
		},
		mcp: {
			registerInstallTarget(targetId, runtime) {
				if (released) throw new Error('extension is deactivated');
				if (manifest && !targetDeclarations.has(targetId))
					throw new Error('MCP install target registration is undeclared');
				if (targets.has(targetId))
					throw new Error(`Duplicate MCP install target: ${targetId}`);
				targets.set(targetId, runtime);
				return {
					targetId,
					dispose(): void {
						targets.delete(targetId);
					},
				};
			},
		},
		subscriptions: {
			add(subscription) {
				subscriptions.push(subscription);
				return subscription;
			},
		},
		registerLanguageServerProvider() {
			throw new Error(
				'this harness serves agent extensions; use createLanguageServerExtensionHarness',
			);
		},
	};
	await extension.activate(context);

	function publisherFor(
		sourceId: string,
		state: RunningSource,
	): AgentSessionPublisher {
		const violate = (
			call: HarnessViolation['call'],
			issues: SchemaIssue[],
		): void => {
			violations.push({ sourceId, call, issues });
			notify();
		};
		const active = (): boolean => !state.controller.signal.aborted;
		return {
			reset(sessions) {
				if (!active()) return;
				const result = validateAgentSessionReset(sessions, state.enabled);
				if (!result.ok) return violate('reset', result.issues);
				state.live.clear();
				for (const session of result.value)
					state.live.set(session.id, structuredClone(session));
				publications.push({
					kind: 'reset',
					sourceId,
					sessions: structuredClone(result.value),
				});
				notify();
			},
			upsert(session) {
				if (!active()) return;
				const result = validateAgentSessionSnapshot(session, state.enabled);
				if (!result.ok) return violate('upsert', result.issues);
				state.live.set(result.value.id, structuredClone(result.value));
				publications.push({
					kind: 'upsert',
					sourceId,
					session: structuredClone(result.value),
				});
				notify();
			},
			remove(sessionId) {
				if (!active()) return;
				if (typeof sessionId !== 'string' || !state.live.has(sessionId))
					return violate('remove', [
						{
							path: '$',
							code: 'unknown_session',
							message: 'Removed a session that is not live',
						},
					]);
				state.live.delete(sessionId);
				publications.push({ kind: 'remove', sourceId, sessionId });
				notify();
			},
			diagnostic(diagnostic) {
				if (!active()) return;
				const result = validateAgentSessionSourceDiagnostic(diagnostic);
				if (!result.ok) return violate('diagnostic', result.issues);
				diagnostics.push({ ...result.value });
				notify();
			},
		};
	}

	async function callTarget<T>(
		targetId: string,
		server: McpServerCommand,
		call: (
			runtime: McpInstallTargetRuntime,
			request: McpInstallTargetRequest,
		) => Promise<T>,
		validate: (value: unknown) => ValidationResult<T>,
	): Promise<T> {
		const runtime = targets.get(targetId);
		if (!runtime) throw new Error(`Unknown MCP install target: ${targetId}`);
		const command = assertValid(
			validateMcpServerCommand(server),
			'Invalid MCP server command',
		);
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(new Error('deadline exceeded')),
			EXTENSION_LIMITS.deadlineMs,
		);
		try {
			return assertValid(
				validate(
					await call(runtime, { server: command, signal: controller.signal }),
				),
				'Invalid MCP install target result',
			);
		} finally {
			clearTimeout(timer);
		}
	}

	async function release(reason: ExtensionReleaseReason): Promise<void> {
		void reason;
		released = true;
		for (const state of running.values()) state.controller.abort();
		running.clear();
		const owned = subscriptions.splice(0, subscriptions.length);
		for (const subscription of owned.reverse()) await subscription.dispose();
		sources.clear();
		targets.clear();
		await extension.deactivate?.();
	}

	const harness: AgentExtensionHarness = {
		registeredSourceIds() {
			return [...sources.keys()];
		},
		registeredTargetIds() {
			return [...targets.keys()];
		},
		async start(sourceId, startOptions = {}) {
			const id = pickSource(sourceId);
			if (running.has(id)) throw new Error(`Source already running: ${id}`);
			const declared = sourceDeclarations
				.get(id)
				?.harnesses.map((item) => item.id);
			const enabled = startOptions.enabledHarnesses ?? declared ?? [];
			if (declared)
				for (const harnessId of enabled)
					if (!declared.includes(harnessId))
						throw new Error(`Undeclared harness: ${harnessId}`);
			const state: RunningSource = {
				controller: new AbortController(),
				enabled: new Set(enabled),
				listeners: new Set(),
				live: new Map(),
			};
			running.set(id, state);
			await sources.get(id)?.start({
				enabledHarnesses: [...enabled],
				publisher: publisherFor(id, state),
				signal: state.controller.signal,
				onEnabledHarnessesChanged(listener) {
					state.listeners.add(listener);
					return {
						dispose(): void {
							state.listeners.delete(listener);
						},
					};
				},
			});
		},
		setEnabledHarnesses(enabledHarnesses, sourceId) {
			const id = pickSource(sourceId);
			const state = running.get(id);
			if (!state) throw new Error(`Source is not running: ${id}`);
			state.enabled = new Set(enabledHarnesses);
			// The host stops showing a harness the moment it is switched off.
			for (const [sessionId, session] of state.live)
				if (!state.enabled.has(session.harness)) state.live.delete(sessionId);
			for (const listener of [...state.listeners])
				listener([...enabledHarnesses]);
			notify();
		},
		stop(sourceId) {
			const id = pickSource(sourceId);
			running.get(id)?.controller.abort();
			running.delete(id);
			notify();
		},
		sessions(sourceId) {
			const id = pickSource(sourceId);
			return [...(running.get(id)?.live.values() ?? [])];
		},
		publications() {
			return publications;
		},
		diagnostics() {
			return diagnostics;
		},
		violations() {
			return violations;
		},
		assertConformant() {
			if (violations.length > 0)
				throw new ExtensionSchemaError(
					`Session source breached the contract: ${violations
						.map(
							(violation) =>
								`${violation.call} ${violation.issues.map((issue) => `${issue.path} ${issue.code}`).join(', ')}`,
						)
						.join('; ')}`,
					violations.flatMap((violation) => violation.issues),
				);
		},
		waitFor(predicate, timeoutMs = 5_000) {
			if (predicate(harness)) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const check = (): void => {
					if (!predicate(harness)) return;
					waiters.delete(check);
					clearTimeout(timer);
					resolve();
				};
				const timer = setTimeout(() => {
					waiters.delete(check);
					reject(new Error(`waitFor timed out after ${timeoutMs} ms`));
				}, timeoutMs);
				waiters.add(check);
			});
		},
		mcpStatus(targetId, server = fixtureMcpServerCommand) {
			return callTarget(
				targetId,
				server,
				(runtime, request) => runtime.status(request),
				validateMcpInstallTargetStatus,
			);
		},
		mcpInstall(targetId, server = fixtureMcpServerCommand) {
			return callTarget(
				targetId,
				server,
				(runtime, request) => runtime.install(request),
				validateMcpInstallTargetActionResult,
			);
		},
		mcpUninstall(targetId, server = fixtureMcpServerCommand) {
			return callTarget(
				targetId,
				server,
				(runtime, request) => runtime.uninstall(request),
				validateMcpInstallTargetActionResult,
			);
		},
		release,
		async dispose() {
			if (!released) await release('shutdown');
		},
	};
	return harness;
}

export interface LanguageServerExtensionHarness {
	/** Ids the extension actually registered, in registration order. */
	registeredIds(): readonly string[];
	launch(
		request: LanguageServerLaunchRequest,
		signal?: AbortSignal,
	): Promise<LanguageServerLaunch>;
	dispose(): Promise<void>;
}

export interface LanguageServerExtensionHarnessOptions {
	manifest?: TerminayExtensionManifest;
}

/**
 * Activates a language server extension in memory and applies the host's
 * registration rules: an id the manifest did not contribute, or a second
 * registration of the same id, is refused.
 */
export async function createLanguageServerExtensionHarness(
	extension: TerminayExtension,
	options: LanguageServerExtensionHarnessOptions = {},
): Promise<LanguageServerExtensionHarness> {
	const registrations = new Map<string, LanguageServerProviderRuntime>();
	const order: string[] = [];
	const subscriptions: Disposable[] = [];
	const declared = new Set(
		options.manifest?.contributes.languageServers?.map((server) => server.id) ??
			[],
	);
	const context: ExtensionContext = {
		extensionId: options.manifest?.id ?? 'test.extension',
		apiVersion: EXTENSION_API_VERSION,
		paths: {
			configuration: '/fixture/config',
			data: '/fixture/data',
			cache: '/fixture/cache',
		},
		agents: {
			registerSessionSource() {
				throw new Error(
					'this harness serves language servers; use createAgentExtensionHarness',
				);
			},
		},
		mcp: {
			registerInstallTarget() {
				throw new Error(
					'this harness serves language servers; use createAgentExtensionHarness',
				);
			},
		},
		subscriptions: {
			add(subscription) {
				subscriptions.push(subscription);
				return subscription;
			},
		},
		registerLanguageServerProvider(registration: LanguageServerRegistration) {
			if (options.manifest && !declared.has(registration.id))
				throw new Error(
					'language server registration is undeclared or invalid',
				);
			if (registrations.has(registration.id))
				throw new Error(`Duplicate language server: ${registration.id}`);
			registrations.set(registration.id, registration.runtime);
			order.push(registration.id);
		},
	};
	await extension.activate(context);
	return {
		registeredIds() {
			return [...order];
		},
		async launch(request, signal) {
			const runtime = registrations.get(request.languageServerId);
			if (!runtime)
				throw new Error(`Unknown language server: ${request.languageServerId}`);
			return runtime.launch(request, signal ?? new AbortController().signal);
		},
		async dispose() {
			const owned = subscriptions.splice(0, subscriptions.length);
			for (const subscription of owned.reverse()) await subscription.dispose();
			registrations.clear();
			order.length = 0;
		},
	};
}

export interface LanguageServerPosition {
	line: number;
	character: number;
}

export interface LanguageServerSessionOptions {
	/** The working directory the host would give the server. */
	projectRoot: string;
	/** Overlaid on the launch's own environment overlay. */
	env?: Record<string, string>;
	timeoutMs?: number;
}

export interface LanguageServerOpenDocument {
	/** Absolute path of the document on disk. */
	path: string;
	languageId: string;
	text: string;
	version?: number;
}

/**
 * A minimal LSP client over stdio, exactly as much protocol as a conformance
 * test needs. The host owns the real one; this exists so an extension package
 * can prove its launch actually starts a language server that answers.
 */
export interface LanguageServerSession {
	initialize(): Promise<JsonValue>;
	request(method: string, params: JsonValue): Promise<JsonValue>;
	notify(method: string, params: JsonValue): void;
	didOpen(document: LanguageServerOpenDocument): void;
	completion(
		path: string,
		position: LanguageServerPosition,
	): Promise<JsonValue>;
	hover(path: string, position: LanguageServerPosition): Promise<JsonValue>;
	definition(
		path: string,
		position: LanguageServerPosition,
	): Promise<JsonValue>;
	/** Resolves with the first published diagnostics for `path` that match. */
	waitForDiagnostics(
		path: string,
		predicate?: (diagnostics: JsonValue[]) => boolean,
		timeoutMs?: number,
	): Promise<JsonValue[]>;
	dispose(): Promise<void>;
}

interface PendingCall {
	resolve(value: JsonValue): void;
	reject(error: Error): void;
}

function documentUri(path: string): string {
	return pathToFileURL(path).href;
}

/** Starts the launch an extension returned and speaks LSP to it over stdio. */
export async function openLanguageServerSession(
	launch: LanguageServerLaunch,
	options: LanguageServerSessionOptions,
): Promise<LanguageServerSession> {
	const timeout = options.timeoutMs ?? 60_000;
	const child: ChildProcessWithoutNullStreams = spawn(
		launch.command,
		launch.args,
		{
			cwd: options.projectRoot,
			env: {
				PATH: process.env.PATH ?? '',
				HOME: process.env.HOME ?? options.projectRoot,
				...launch.env,
				...options.env,
			} as unknown as NodeJS.ProcessEnv,
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	);
	const pending = new Map<number, PendingCall>();
	const diagnostics = new Map<string, JsonValue[]>();
	const diagnosticWaiters: Array<{
		uri: string;
		predicate: (value: JsonValue[]) => boolean;
		resolve(value: JsonValue[]): void;
	}> = [];
	let nextId = 0;
	let buffer = Buffer.alloc(0);
	let exited: Error | undefined;

	function handle(message: Record<string, JsonValue>): void {
		if (typeof message.id === 'number' && !('method' in message)) {
			const call = pending.get(message.id);
			pending.delete(message.id);
			if (!call) return;
			if (message.error) call.reject(new Error(JSON.stringify(message.error)));
			else call.resolve((message.result ?? null) as JsonValue);
			return;
		}
		if (message.method !== 'textDocument/publishDiagnostics') return;
		const parameters = message.params as
			| { uri?: unknown; diagnostics?: unknown }
			| undefined;
		if (!parameters || typeof parameters.uri !== 'string') return;
		const published = Array.isArray(parameters.diagnostics)
			? (parameters.diagnostics as JsonValue[])
			: [];
		diagnostics.set(parameters.uri, published);
		for (let index = diagnosticWaiters.length - 1; index >= 0; index--) {
			const waiter = diagnosticWaiters[index];
			if (waiter.uri !== parameters.uri || !waiter.predicate(published))
				continue;
			diagnosticWaiters.splice(index, 1);
			waiter.resolve(published);
		}
	}

	child.stdout.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			const separator = buffer.indexOf('\r\n\r\n');
			if (separator < 0) return;
			const header = buffer.subarray(0, separator).toString('utf8');
			const match = /content-length:\s*(\d+)/i.exec(header);
			if (!match) {
				buffer = buffer.subarray(separator + 4);
				continue;
			}
			const length = Number(match[1]);
			if (buffer.length < separator + 4 + length) return;
			const body = buffer
				.subarray(separator + 4, separator + 4 + length)
				.toString('utf8');
			buffer = buffer.subarray(separator + 4 + length);
			try {
				handle(JSON.parse(body) as Record<string, JsonValue>);
			} catch {
				// A frame this client cannot parse is not this test's business.
			}
		}
	});
	child.stderr.resume();
	child.on('exit', (code, signal) => {
		exited = new Error(
			`language server exited (code ${String(code)}, signal ${String(signal)})`,
		);
		for (const call of pending.values()) call.reject(exited);
		pending.clear();
	});
	child.on('error', (error: Error) => {
		exited = error;
		for (const call of pending.values()) call.reject(error);
		pending.clear();
	});

	function send(payload: Record<string, JsonValue>): void {
		if (exited) throw exited;
		const body = Buffer.from(JSON.stringify(payload), 'utf8');
		child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
		child.stdin.write(body);
	}

	function request(method: string, parameters: JsonValue): Promise<JsonValue> {
		nextId += 1;
		const id = nextId;
		return new Promise<JsonValue>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`language server request timed out: ${method}`));
			}, timeout);
			pending.set(id, {
				resolve(value) {
					clearTimeout(timer);
					resolve(value);
				},
				reject(error) {
					clearTimeout(timer);
					reject(error);
				},
			});
			try {
				send({ jsonrpc: '2.0', id, method, params: parameters });
			} catch (error) {
				clearTimeout(timer);
				pending.delete(id);
				reject(error as Error);
			}
		});
	}

	function notify(method: string, parameters: JsonValue): void {
		send({ jsonrpc: '2.0', method, params: parameters });
	}

	const session: LanguageServerSession = {
		async initialize() {
			const result = await request('initialize', {
				processId: process.pid,
				rootUri: documentUri(options.projectRoot),
				workspaceFolders: [
					{
						uri: documentUri(options.projectRoot),
						name: 'fixture',
					},
				],
				capabilities: {
					textDocument: {
						synchronization: { dynamicRegistration: false },
						completion: { completionItem: { snippetSupport: false } },
						hover: { contentFormat: ['plaintext', 'markdown'] },
						definition: { linkSupport: false },
						publishDiagnostics: {},
					},
				},
				initializationOptions:
					launch.initializationOptions === undefined
						? null
						: launch.initializationOptions,
			});
			notify('initialized', {});
			return result;
		},
		request,
		notify,
		didOpen(document) {
			notify('textDocument/didOpen', {
				textDocument: {
					uri: documentUri(document.path),
					languageId: document.languageId,
					version: document.version ?? 1,
					text: document.text,
				},
			});
		},
		completion(path, position) {
			return request('textDocument/completion', {
				textDocument: { uri: documentUri(path) },
				position: { line: position.line, character: position.character },
			});
		},
		hover(path, position) {
			return request('textDocument/hover', {
				textDocument: { uri: documentUri(path) },
				position: { line: position.line, character: position.character },
			});
		},
		definition(path, position) {
			return request('textDocument/definition', {
				textDocument: { uri: documentUri(path) },
				position: { line: position.line, character: position.character },
			});
		},
		waitForDiagnostics(path, predicate, timeoutMs) {
			const uri = documentUri(path);
			const matches = predicate ?? ((value: JsonValue[]) => value.length > 0);
			const already = diagnostics.get(uri);
			if (already && matches(already)) return Promise.resolve(already);
			return new Promise<JsonValue[]>((resolve, reject) => {
				const waiter = {
					uri,
					predicate: matches,
					resolve(value: JsonValue[]) {
						clearTimeout(timer);
						resolve(value);
					},
				};
				const timer = setTimeout(() => {
					const index = diagnosticWaiters.indexOf(waiter);
					if (index >= 0) diagnosticWaiters.splice(index, 1);
					reject(new Error(`no matching diagnostics for ${path}`));
				}, timeoutMs ?? timeout);
				diagnosticWaiters.push(waiter);
			});
		},
		async dispose() {
			if (!exited) {
				try {
					await request('shutdown', null);
					notify('exit', null);
				} catch {
					// A server that is already gone needs no polite shutdown.
				}
			}
			await new Promise<void>((resolve) => {
				if (child.exitCode !== null || child.signalCode !== null) {
					resolve();
					return;
				}
				const timer = setTimeout(() => {
					child.kill('SIGKILL');
					resolve();
				}, 2_000);
				child.once('exit', () => {
					clearTimeout(timer);
					resolve();
				});
			});
		},
	};
	return session;
}
