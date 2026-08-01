import { randomBytes } from 'node:crypto';
import {
	mkdirSync,
	readFileSync,
	renameSync,
	watch as watchFileSystem,
	writeFileSync,
} from 'node:fs';
import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { createConnection } from 'node:net';
import { basename, dirname, join } from 'node:path';
import type { JsonValue } from '@terminay/protocol';
import {
	AgentStatusService,
	AiService,
	CanonicalProjectPathResolver,
	createInitialWorkspace,
	createNodePtyFactory,
	createServerAiProviderAdapters,
	createServerCoreComposition,
	ExactTerminalTargetRegistry,
	FileCatalog,
	FileContentStreamService,
	type FileObservationHost,
	GitService,
	MacroRepository,
	type NodePtyModuleLike,
	OrderedEventJournal,
	RecordingService,
	type RemoteReconnectGrantRecord,
	type ServerCoreComposition,
	ServerFileAdapter,
	ServerFileCatalogAdapter,
	ServerFileContentAdapter,
	ServerFileObservationAdapter,
	ServerGitAdapter,
	ServerRecordingAdapter,
	ServerSettingsRepository,
	TerminalActivityService,
	TerminalReplayRegistry,
	WorkspaceStore,
} from '@terminay/server-core';
import * as nodePty from 'node-pty';
import {
	allowedWebOrigins,
	formatServerHelp,
	parseServerCliOptions,
	type ServerCliOptions,
} from './cliOptions.js';
import {
	createLocalUiServer,
	createServerHealthServer,
	createServerRemoteExposure,
	createStandaloneServer,
	type LocalUiServer,
	runServerMcpStdio,
	type ServerPairingHandoff,
	type ServerRemoteExposure,
} from './index.js';
import { resolveTerminalProcessCwd } from './processCwd.js';
import { assertStandaloneReleaseIntegrity } from './releaseIntegrity.js';

declare const process: {
	readonly argv: readonly string[];
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly stdout: { write(value: string): void };
	readonly stderr: { write(value: string): void };
	cwd(): string;
	on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
	exit(code?: number): never;
	exitCode?: number;
};

type StandaloneRuntime = ReturnType<typeof createStandaloneServer>;
const MAX_STANDALONE_FOLDER_SIZE_ENTRIES = 50_000;

await assertStandaloneReleaseIntegrity();

const options = parseServerCliOptions(process.argv.slice(2), process.env);
if (options.command === 'help') process.stdout.write(formatServerHelp());
else if (options.command === 'version')
	process.stdout.write(`${options.serverVersion}\n`);
else if (options.command === 'mcp') {
	const socketPath = process.env.TERMINAY_CONTROL_SOCKET;
	const token = process.env.TERMINAY_CONTROL_TOKEN ?? '';
	if (socketPath === undefined || socketPath.length === 0) {
		process.stderr.write('terminay mcp requires TERMINAY_CONTROL_SOCKET\n');
		process.exitCode = 1;
	} else {
		runServerMcpStdio({ socketPath, token }).catch((error: unknown) => {
			process.stderr.write(
				`${error instanceof Error ? error.message : 'MCP adapter failed'}\n`,
			);
			process.exitCode = 1;
		});
	}
} else {
	const reconnectPersistence = createReconnectGrantPersistence(
		options.dataRoot,
	);
	const remote = createRemoteExposure(
		options.serverId,
		options.remoteOrigin,
		reconnectPersistence.load(),
	);
	let protocolReady = false;
	if (options.command === 'status') {
		const runtime = createRuntime(options, remote);
		process.stdout.write(`${JSON.stringify(runtime.diagnostics())}\n`);
	} else if (options.command === 'pairing') {
		const handoff = remote.start(Date.now() + 60_000);
		process.stdout.write(
			`${JSON.stringify({ serverId: options.serverId, endpoint: options.endpoint, roomId: handoff.roomId, pairingSessionId: handoff.pairingSessionId, pairingUrl: handoff.pairingUrl, expiresAt: handoff.pairingExpiresAt, expiresInSeconds: Math.max(1, Math.ceil((handoff.expiresAt - Date.now()) / 1000)), requiresApproval: true })}\n`,
		);
	} else {
		// Pairing material is the sole local HTTP credential. It is delivered in
		// the URL fragment and never copied into a second readiness field.
		const handoff = remote.start();
		const credentials = createProtocolCredentials(
			handoff.pairingToken,
			handoff.expiresAt,
		);
		const composition = createServerComposition(options, () => {
			if (runtime === undefined)
				throw new Error('server runtime is not composed');
			return runtimeHealth(runtime, protocolReady);
		});
		let runtime: StandaloneRuntime | undefined;
		const uiServer =
			options.endpoint === 'disabled'
				? undefined
				: createProtocolServer(
						options,
						handoff.pairingToken,
						handoff.expiresAt,
						composition,
						remote,
						credentials,
						reconnectPersistence.save,
					);
		runtime = createRuntime(options, remote, uiServer);

		// A runtime without a listener has no event-loop handle of its own. Keep
		// the CLI in the foreground until SIGINT/SIGTERM so local launches and
		// container entrypoints have one stable lifecycle.
		const foregroundLease = setInterval(() => undefined, 60_000);
		const healthServer =
			options.healthPort === undefined
				? undefined
				: createServerHealthServer({
						port: options.healthPort,
						health: () => runtime!.health(),
						...(options.healthHost === undefined
							? {}
							: { host: options.healthHost }),
					});
		const start = async (): Promise<void> => {
			try {
				const healthAddress = await healthServer?.start();
				// Terminal creation injects the server-owned hook endpoint and lease.
				// Start it before creating the default session, never in a renderer.
				await composition.start();
				await applyStandaloneAgentIntegrationPolicy(composition);
				const health = await runtime!.start();
				await ensureDefaultTerminalSession(composition);
				await waitForProtocolEndpoint(uiServer);
				protocolReady = true;
				process.stdout.write(
					`${JSON.stringify({
						ready: health.ready && protocolReady,
						serverId: health.serverId,
						version: health.version,
						endpoint: runtime!.config.localEndpoint ?? null,
						protocolEndpoint: uiServer?.address?.origin ?? null,
						dataRoot: runtime!.config.dataRoot,
						logSink: runtime!.config.logSink ?? null,
						healthEndpoint: healthAddress?.origin ?? null,
						pairing: publicPairing(
							handoff,
							options.publicOrigin ?? uiServer?.address?.origin,
						),
					})}\n`,
				);
			} catch (error) {
				clearInterval(foregroundLease);
				await runtime!.stop().catch(() => undefined);
				await composition.shutdown().catch(() => undefined);
				await healthServer?.stop().catch(() => undefined);
				process.stderr.write(
					`${error instanceof Error ? error.message : 'server failed'}\n`,
				);
				process.exitCode = 1;
			}
		};
		void start();
		let shutdownStarted = false;
		const shutdown = () => {
			if (shutdownStarted) return;
			shutdownStarted = true;
			clearInterval(foregroundLease);
			protocolReady = false;
			void (async () => {
				// Runtime owns the listeners/remote exposure; composition owns the
				// terminal and hook authority. They must be stopped in this order,
				// never concurrently, to avoid double-stopping a PTY or hook server.
				await runtime!.stop();
				await composition.shutdown();
				await healthServer?.stop();
			})()
				.then(() => process.exit(0))
				.catch((error: unknown) => {
					process.stderr.write(
						`${error instanceof Error ? error.message : 'server shutdown failed'}\n`,
					);
					process.exit(1);
				});
		};
		process.on('SIGINT', shutdown);
		process.on('SIGTERM', shutdown);
	}
}

function createRuntime(
	options: ServerCliOptions,
	remote: ServerRemoteExposure,
	uiServer?: LocalUiServer,
): StandaloneRuntime {
	return createStandaloneServer({
		serverId: options.serverId,
		serverVersion: options.serverVersion,
		dataRoot: options.dataRoot,
		localEndpoint: options.endpoint,
		...(options.logSink === undefined ? {} : { logSink: options.logSink }),
		...(options.uiBundle === undefined ? {} : { uiBundle: options.uiBundle }),
		services: {
			remoteExposure: remote,
		},
		...(uiServer === undefined ? {} : { uiServer }),
	});
}

function createRemoteExposure(
	serverId: string,
	sessionOrigin: string,
	initialReconnectRecords: readonly RemoteReconnectGrantRecord[],
): ServerRemoteExposure {
	return createServerRemoteExposure({
		serverId,
		sessionOrigin,
		reconnect: { initialRecords: initialReconnectRecords },
	});
}

function createServerComposition(
	options: ServerCliOptions,
	health: () => JsonValue,
): ServerCoreComposition {
	const eventJournal = new OrderedEventJournal();
	const activity = new TerminalActivityService({ serverId: options.serverId });
	const agents = new AgentStatusService({
		activity,
		enabled: options.agentIntegrationEnabled,
	});
	const workspace = createDefaultWorkspace(
		options.serverId,
		options.projectRoot,
	);
	const gitService = new GitService({
		limits: {
			maxOutputBytes: 512 * 1024,
			maxDiffBytes: 512 * 1024,
			maxDiffHunks: 2_000,
			maxDiffLines: 20_000,
			maxDiffLineBytes: 16 * 1024,
			maxStatusEntries: 128,
			maxWorktrees: 128,
			maxPathBytes: 4 * 1024,
		},
	});
	const files = createDefaultProjectFileServices(
		options.serverId,
		options.projectRoot,
		eventJournal,
		gitService,
	);
	const settings = createStandaloneSettingsRepository(options.dataRoot);
	const macros = createStandaloneMacroRepository(options.dataRoot);
	const recordings = new ServerRecordingAdapter(
		new RecordingService({
			serverId: options.serverId,
			recordingRoot: join(options.dataRoot, 'recordings'),
			homeDirectory: options.dataRoot,
			libraryIndexPath: join(options.dataRoot, 'recording-roots.v1.json'),
		}),
		{ serverId: options.serverId },
	);
	const git = new ServerGitAdapter({
		serverId: options.serverId,
		git: gitService,
		resolveProjectRoot: (projectId) =>
			workspace.state.projects[projectId]?.root ?? null,
	});
	const ai =
		options.aiProviders.length === 0
			? undefined
			: new AiService({
					serverId: options.serverId,
					authority: new ExactTerminalTargetRegistry(options.serverId),
					replay: new TerminalReplayRegistry(),
					providers: selectAiProviders(
						options.aiProviders,
						createServerAiProviderAdapters({
							cwd: options.projectRoot,
							// Authentication belongs to provider-owned login/keychain state. Never
							// copy API keys or arbitrary server environment into the child.
							environment: safeAiProviderEnvironment(process.env),
						}),
					),
				});
	let composition: ServerCoreComposition;
	composition = createServerCoreComposition({
		serverId: options.serverId,
		serverVersion: options.serverVersion,
		capabilities: ['terminal', 'workspace', 'files', 'agents', 'server.health'],
		eventJournal,
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'admin',
		}),
		ptyFactory: createNodePtyFactory(nodePty as unknown as NodePtyModuleLike, {
			resolveCwd: resolveTerminalProcessCwd,
		}),
		activity,
		agents,
		workspace,
		workspaceOperations: {
			prepareProjectRootUpdate: files.prepareProjectRootUpdate,
		},
		fileObservations: files.observations,
		settings,
		recordings,
		git,
		...(ai === undefined ? {} : { ai }),
		serviceLifecycle: {
			start: async () => {
				await gitService.bindProject('default', options.projectRoot);
			},
		},
		macros: {
			repository: macros,
			environmentFor: (request, target) => {
				const authorization = {
					...target,
					clientId: request.context.clientId,
					scope:
						request.context.authScope === 'admin'
							? ('admin' as const)
							: ('write' as const),
				};
				return {
					target,
					write: (_candidate, bytes) =>
						composition.terminal.input(target, bytes, authorization),
					key: (_candidate, key) =>
						composition.terminal.input(
							target,
							macroKeyBytes(key),
							authorization,
						),
					waitForInactivity: (_candidate, milliseconds, signal) =>
						composition.terminal.waitForInactivity(target, milliseconds, {
							authorization,
							signal,
						}),
				};
			},
		},
		terminalOptions: {
			defaultEnvironment: process.env,
			maxReplayBytes: 4 * 1024 * 1024,
			maxQueuedOutputBytes: 512 * 1024,
		},
		operations: {
			queries: {
				...files.session.operations().queries,
				...files.content.operations().queries,
				...files.catalog.operations().queries,
				'server.health': () => health(),
			},
			commands: {
				...files.session.operations().commands,
				...files.catalog.operations().commands,
			},
		},
	});
	return composition;
}

function selectAiProviders(
	enabled: readonly ('codex' | 'claude-code')[],
	available: ReturnType<typeof createServerAiProviderAdapters>,
): ReturnType<typeof createServerAiProviderAdapters> {
	return Object.fromEntries(
		enabled.flatMap((provider) => {
			const adapter = available[provider];
			return adapter === undefined ? [] : [[provider, adapter]];
		}),
	) as ReturnType<typeof createServerAiProviderAdapters>;
}

function safeAiProviderEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
	const allowed = [
		'PATH',
		'HOME',
		'USER',
		'LOGNAME',
		'SHELL',
		'TMPDIR',
		'TEMP',
		'TMP',
		'TERMINAY_CODEX_COMMAND',
		'TERMINAY_CLAUDE_CODE_COMMAND',
		'TERMINAY_CODEX_MODELS_JSON',
		'TERMINAY_CLAUDE_CODE_MODELS_JSON',
	] as const;
	return Object.fromEntries(
		allowed.flatMap((key) => {
			const value = environment[key];
			return value === undefined ? [] : [[key, value]];
		}),
	);
}

function createStandaloneSettingsRepository(
	dataRoot: string,
): ServerSettingsRepository {
	const path = join(dataRoot, 'settings.v1.json');
	return new ServerSettingsRepository({
		load: async () => {
			try {
				return JSON.parse(await readFile(path, 'utf8')) as unknown;
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return undefined;
				throw error;
			}
		},
		commit: async (state) => {
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
			await writeFile(temporary, JSON.stringify(state), {
				encoding: 'utf8',
				mode: 0o600,
				flag: 'wx',
			});
			await rename(temporary, path);
		},
	});
}

function createStandaloneMacroRepository(dataRoot: string): MacroRepository {
	const path = join(dataRoot, 'macros.v1.json');
	return new MacroRepository({
		load: async () => {
			try {
				return JSON.parse(await readFile(path, 'utf8')) as unknown;
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return undefined;
				throw error;
			}
		},
		commit: async (state) => {
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
			await writeFile(temporary, JSON.stringify(state), {
				encoding: 'utf8',
				mode: 0o600,
				flag: 'wx',
			});
			await rename(temporary, path);
		},
	});
}

function macroKeyBytes(key: string): Uint8Array {
	const value = (
		{
			Enter: '\r',
			Tab: '\t',
			Escape: '\u001b',
			Backspace: '\u007f',
			ArrowUp: '\u001b[A',
			ArrowDown: '\u001b[B',
			ArrowRight: '\u001b[C',
			ArrowLeft: '\u001b[D',
		} as Readonly<Record<string, string>>
	)[key];
	if (value === undefined)
		throw new Error('macro key is unavailable at the standalone PTY boundary');
	return new TextEncoder().encode(value);
}

function createDefaultProjectFileServices(
	serverId: string,
	projectRoot: string,
	eventJournal: InstanceType<typeof OrderedEventJournal>,
	gitService: GitService,
): {
	readonly session: ServerFileAdapter;
	readonly content: ServerFileContentAdapter;
	readonly catalog: ServerFileCatalogAdapter;
	readonly observations: ServerFileObservationAdapter;
	readonly prepareProjectRootUpdate: (
		projectId: string,
		root: string,
	) => Promise<{
		readonly canonicalRoot: string;
		readonly commit: () => void;
	}>;
} {
	const storage = {
		realpath: (path: string) => realpath(path),
		stat: async (path: string) => toPathStat(await stat(path)),
		lstat: async (path: string) => toPathStat(await lstat(path)),
		readRange: async (
			path: string,
			offset: number,
			length: number,
			signal?: AbortSignal,
		): Promise<Uint8Array> => {
			throwIfAborted(signal);
			const handle = await open(path, 'r');
			try {
				const bytes = Buffer.allocUnsafe(length);
				const result = await handle.read(bytes, 0, length, offset);
				throwIfAborted(signal);
				return new Uint8Array(bytes.subarray(0, result.bytesRead));
			} finally {
				await handle.close();
			}
		},
		readDirectory: async (path: string, signal?: AbortSignal) => {
			throwIfAborted(signal);
			const entries = await readdir(path, { withFileTypes: true });
			throwIfAborted(signal);
			return entries.map((entry) => ({
				name: entry.name,
				isDirectory: entry.isDirectory(),
				isFile: entry.isFile(),
				isSymbolicLink: entry.isSymbolicLink(),
			}));
		},
		makeDirectory: async (
			path: string,
			signal?: AbortSignal,
		): Promise<void> => {
			throwIfAborted(signal);
			await mkdir(path);
			throwIfAborted(signal);
		},
		rename: async (
			from: string,
			to: string,
			signal?: AbortSignal,
		): Promise<void> => {
			throwIfAborted(signal);
			await rename(from, to);
			throwIfAborted(signal);
		},
		remove: async (
			path: string,
			options?: { readonly recursive?: boolean },
			signal?: AbortSignal,
		): Promise<void> => {
			throwIfAborted(signal);
			await rm(path, { recursive: options?.recursive === true });
			throwIfAborted(signal);
		},
		atomicWrite: async (
			path: string,
			bytes: Uint8Array,
			signal?: AbortSignal,
		): Promise<void> => {
			throwIfAborted(signal);
			const temporary = `${path}.terminay-${randomBytes(12).toString('hex')}`;
			try {
				await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
				throwIfAborted(signal);
				await rename(temporary, path);
			} finally {
				await rm(temporary, { force: true }).catch(() => undefined);
			}
			throwIfAborted(signal);
		},
	};
	const resolver = new CanonicalProjectPathResolver(projectRoot, storage);
	const content = new FileContentStreamService(resolver, storage);
	const catalog = new FileCatalog(resolver, storage);
	const sessionProjects = new Map([
		['default', { projectId: 'default', resolver, storage }],
	]);
	const contentProjects = new Map([
		['default', { projectId: 'default', content }],
	]);
	const catalogProjects = new Map([
		['default', { projectId: 'default', catalog }],
	]);
	const observationHost = createStandaloneFileObservationHost(
		sessionProjects,
		storage,
	);
	return {
		session: new ServerFileAdapter({
			serverId,
			projects: sessionProjects,
		}),
		content: new ServerFileContentAdapter({
			serverId,
			projects: contentProjects,
		}),
		catalog: new ServerFileCatalogAdapter({
			serverId,
			projects: catalogProjects,
		}),
		observations: new ServerFileObservationAdapter({
			serverId,
			host: observationHost,
			eventJournal,
		}),
		prepareProjectRootUpdate: async (projectId, root) => {
			const nextResolver = new CanonicalProjectPathResolver(root, storage);
			const canonicalRoot = await nextResolver.root();
			await gitService.bindProject(projectId, canonicalRoot);
			const nextContent = new FileContentStreamService(nextResolver, storage);
			const nextCatalog = new FileCatalog(nextResolver, storage);
			return Object.freeze({
				canonicalRoot,
				commit: () => {
					sessionProjects.set(projectId, {
						projectId,
						resolver: nextResolver,
						storage,
					});
					contentProjects.set(projectId, { projectId, content: nextContent });
					catalogProjects.set(projectId, { projectId, catalog: nextCatalog });
				},
			});
		},
	};
}

function createStandaloneFileObservationHost(
	projects: ReadonlyMap<
		string,
		{ readonly resolver: CanonicalProjectPathResolver }
	>,
	storage: {
		readonly lstat: (path: string) => Promise<{
			readonly isDirectory: boolean;
			readonly isFile: boolean;
			readonly isSymbolicLink: boolean;
			readonly size: number;
		}>;
		readonly readDirectory: (
			path: string,
			signal?: AbortSignal,
		) => Promise<
			readonly { readonly name: string; readonly isDirectory: boolean }[]
		>;
	},
): FileObservationHost {
	const project = (
		projectId: string,
	): { readonly resolver: CanonicalProjectPathResolver } => {
		const value = projects.get(projectId);
		if (value === undefined)
			throw new Error('file observation project is unavailable');
		return value;
	};
	const resolveResource = (
		projectId: string,
		resource: string,
	): Promise<string> =>
		resource === ''
			? project(projectId).resolver.root()
			: project(projectId).resolver.resolve(resource);
	return {
		async watch({ projectId, resource, signal, publish }) {
			const canonical = await resolveResource(projectId, resource);
			const canonicalStat = await storage.lstat(canonical);
			throwIfAborted(signal);
			const watchRoot = canonicalStat.isDirectory
				? canonical
				: dirname(canonical);
			const watchedFileName = canonicalStat.isDirectory
				? undefined
				: basename(canonical);
			const watcher = watchFileSystem(
				watchRoot,
				{ persistent: false },
				(_event, fileName) => {
					if (signal.aborted) return;
					const leaf = String(fileName ?? '');
					if (
						watchedFileName !== undefined &&
						leaf !== '' &&
						leaf !== watchedFileName
					)
						return;
					publish({
						resource:
							watchedFileName === undefined && leaf.length > 0
								? joinResource(resource, leaf)
								: resource,
						kind: 'changed',
					});
				},
			);
			const close = (): void => watcher.close();
			signal.addEventListener('abort', close, { once: true });
			watcher.once('close', () => signal.removeEventListener('abort', close));
			watcher.once('error', () => {
				signal.removeEventListener('abort', close);
			});
		},
		async calculateFolderSize({ projectId, resource, signal, progress }) {
			const root = await resolveResource(projectId, resource);
			const rootStat = await storage.lstat(root);
			if (rootStat.isFile) {
				const result = { bytes: rootStat.size, files: 1, directories: 0 };
				progress(result);
				return result;
			}
			if (!rootStat.isDirectory)
				throw new Error('folder-size target is not a directory');
			const stack = [root];
			let bytes = 0;
			let files = 0;
			let directories = 0;
			let visited = 0;
			while (stack.length > 0) {
				throwIfAborted(signal);
				if (++visited > MAX_STANDALONE_FOLDER_SIZE_ENTRIES) {
					throw new Error('folder-size entry limit reached');
				}
				const current = stack.pop()!;
				const entries = await storage.readDirectory(current, signal);
				directories += 1;
				for (const entry of entries) {
					throwIfAborted(signal);
					const child = join(current, entry.name);
					const childStat = await storage.lstat(child);
					if (childStat.isSymbolicLink) continue;
					if (childStat.isDirectory) stack.push(child);
					else if (childStat.isFile) {
						files += 1;
						bytes += childStat.size;
					}
				}
				progress({ bytes, files, directories });
			}
			return { bytes, files, directories };
		},
	};
}

function joinResource(parent: string, child: string): string {
	const normalizedChild = child
		.replace(/\\/g, '/')
		.split('/')
		.filter(Boolean)
		.join('/');
	return parent.length === 0 ? normalizedChild : `${parent}/${normalizedChild}`;
}

function toPathStat(value: {
	readonly isDirectory: () => boolean;
	readonly isFile: () => boolean;
	readonly isSymbolicLink: () => boolean;
	readonly size: number;
	readonly mtimeMs: number;
	readonly mode: number;
}) {
	return {
		isDirectory: value.isDirectory(),
		isFile: value.isFile(),
		isSymbolicLink: value.isSymbolicLink(),
		size: value.size,
		mtimeMs: value.mtimeMs,
		mode: value.mode,
	};
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted === true)
		throw signal.reason instanceof Error
			? signal.reason
			: new DOMException('The operation was aborted', 'AbortError');
}

/**
 * The standalone server must publish the same canonical workspace that owns
 * its default terminal.  This is deliberately seeded before protocol
 * readiness: browser clients receive a real `workspace.snapshot`, never a
 * local UI fallback invented by a client host.
 */
function createDefaultWorkspace(
	serverId: string,
	projectRoot: string,
): WorkspaceStore {
	const workspace = new WorkspaceStore(createInitialWorkspace(serverId));
	const viewId = workspace.state.viewOrder[0]!;
	const apply = (
		commandId: string,
		command: Parameters<WorkspaceStore['apply']>[0]['command'],
	): void => {
		const result = workspace.apply({ commandId, command });
		if (!result.ok)
			throw new Error(
				`Unable to seed standalone workspace: ${result.conflict.message}`,
			);
	};
	apply('system:default-project', {
		type: 'project.create',
		projectId: 'default',
		viewId,
		root: projectRoot,
		name: 'Project',
	});
	apply('system:default-terminal', {
		type: 'terminal.create',
		sessionId: 'default',
		projectId: 'default',
	});
	apply('system:default-terminal-panel', {
		type: 'panel.create',
		panel: {
			id: 'default:terminal',
			projectId: 'default',
			type: 'terminal',
			sessionId: 'default',
			title: 'Terminal 1',
			cwd: projectRoot,
			createdAt: Date.now(),
		},
	});
	return workspace;
}

function createProtocolServer(
	options: ServerCliOptions,
	authToken: string,
	handoffExpiresAt: number,
	composition: ServerCoreComposition,
	remote: ServerRemoteExposure,
	credentials: ProtocolCredentials,
	persistReconnectRecords: (
		records: readonly RemoteReconnectGrantRecord[],
	) => void,
): LocalUiServer {
	return createLocalUiServer({
		...(options.uiBundle === undefined
			? {}
			: { rootDirectory: options.uiBundle }),
		serverId: options.serverId,
		serverVersion: options.serverVersion,
		authToken,
		authTokenExpiresAt: handoffExpiresAt,
		acceptCredential: credentials.accept,
		reconnect: {
			enroll: ({ clientId }) => {
				const issued = remote.issueReconnectGrant({
					deviceId: clientId,
					lifetime: 'until-revoked',
				});
				persistReconnectRecords(remote.reconnect.list());
				return {
					handle: issued.handle,
					grant: issued.grant,
					signingOrigin: issued.sessionOrigin,
				};
			},
			challenge: ({ handle, clientNonce }) => {
				const pending = remote.createReconnectChallenge({
					handle,
					origin: options.remoteOrigin,
					clientNonce,
				});
				return {
					attemptId: pending.challenge.attemptId,
					handle: pending.challenge.handle,
					clientNonce: pending.challenge.clientNonce,
					signingInput: pending.signingInput,
				};
			},
			complete: ({ attemptId, handle, clientNonce, proof }) => {
				remote.verifyReconnectProof({
					attemptId,
					handle,
					origin: options.remoteOrigin,
					clientNonce,
					proof,
				});
				persistReconnectRecords(remote.reconnect.list());
				return credentials.issue();
			},
		},
		...(options.httpHost === undefined ? {} : { host: options.httpHost }),
		...(options.httpPort === undefined ? {} : { port: options.httpPort }),
		allowedWebOrigins: allowedWebOrigins(options.webOrigin),
		protocolCore: composition.core,
		capabilities: composition.coreOptions.capabilities,
		...(composition.coreOptions.limits === undefined
			? {}
			: { limits: composition.coreOptions.limits }),
		});
	}

interface ProtocolCredentials {
	readonly accept: (token: string) => boolean;
	readonly issue: () => { readonly ticket: string; readonly expiresAt: number };
}

/** Short-lived application tickets are intentionally separate from the
 * one-time pairing credential and the durable reconnect grant. The map is
 * process-local: a server restart requires the normal reconnect authority to
 * mint a fresh ticket, never reuse an old bearer. */
function createProtocolCredentials(
	_bootstrapToken: string,
	_bootstrapExpiresAt: number,
): ProtocolCredentials {
	const lifetimeMs = 15 * 60 * 1000;
	const tickets = new Map<string, number>();
	const prune = (now: number): void => {
		for (const [ticket, expiresAt] of tickets)
			if (expiresAt <= now) tickets.delete(ticket);
	};
	return {
		accept: (ticket) => {
			const now = Date.now();
			prune(now);
			const expiresAt = tickets.get(ticket);
			return expiresAt !== undefined && expiresAt > now;
		},
		issue: () => {
			const now = Date.now();
			prune(now);
			const ticket = randomBytes(32).toString('base64url');
			const expiresAt = now + lifetimeMs;
			tickets.set(ticket, expiresAt);
			return { ticket, expiresAt };
		},
	};
}

interface ReconnectGrantPersistence {
	readonly load: () => readonly RemoteReconnectGrantRecord[];
	readonly save: (records: readonly RemoteReconnectGrantRecord[]) => void;
}

/** Only grant hashes and proof verifiers are persisted. A pairing URL,
 * reconnect grant, or short-lived HTTP ticket is never serialized here. */
function createReconnectGrantPersistence(
	dataRoot: string,
): ReconnectGrantPersistence {
	const file = join(dataRoot, 'reconnect-grants.v1.json');
	return {
		load: () => {
			try {
				const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
				if (!Array.isArray(parsed))
					throw new TypeError('reconnect grant state is invalid');
				return parsed as readonly RemoteReconnectGrantRecord[];
			} catch (error) {
				if (isMissingFile(error)) return [];
				throw error;
			}
		},
		save: (records) => {
			mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
			const temporary = `${file}.tmp`;
			writeFileSync(temporary, JSON.stringify(records), {
				encoding: 'utf8',
				mode: 0o600,
			});
			renameSync(temporary, file);
		},
	};
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { code?: unknown }).code === 'ENOENT'
	);
}

async function ensureDefaultTerminalSession(
	composition: ServerCoreComposition,
): Promise<void> {
	if (
		composition.terminal
			.listSessions()
			.some(
				(session) =>
					session.projectId === 'default' && session.sessionId === 'default',
			)
	)
		return;
	await composition.terminal.createSession({
		projectId: 'default',
		sessionId: 'default',
		cwd: composition.workspace?.state.projects.default?.root ?? process.cwd(),
		cols: 100,
		rows: 30,
		env: process.env,
	});
}

/**
 * The standalone process owns the same integration decision and provider
 * reconciliation lifecycle as the embedded authority. Managed hook files only
 * contain a static script path; per-terminal endpoint and token material stays
 * in the child process environment.
 */
async function applyStandaloneAgentIntegrationPolicy(
	composition: ServerCoreComposition,
): Promise<void> {
	const agents = composition.agents;
	if (agents === undefined) return;

	const enabled = agents.integrationEnabled;
	agents.setIntegrationEnabled(enabled);
	const result = await agents.drivers.reconcileHooks({
		action: enabled ? 'install' : 'uninstall',
	});
	if (!result.ok) {
		process.stderr.write(
			`[agent-status] one or more provider hooks could not be ${enabled ? 'installed' : 'removed'}\n`,
		);
	}
}

function runtimeHealth(
	runtime: StandaloneRuntime,
	protocolReady = true,
): JsonValue {
	const health = runtime.health();
	return {
		phase: health.phase,
		serverId: health.serverId,
		version: health.version,
		ready: health.ready && protocolReady,
		uptimeMs: health.uptimeMs,
	};
}

async function waitForProtocolEndpoint(
	uiServer: LocalUiServer | undefined,
): Promise<void> {
	if (uiServer === undefined) return;
	const address = uiServer.address;
	if (address === undefined) throw new Error('protocol endpoint is not bound');
	const host =
		address.host === '0.0.0.0' || address.host === '::'
			? '127.0.0.1'
			: address.host;
	const deadline = Date.now() + 5_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			await new Promise<void>((resolve, reject) => {
				const socket = createConnection({ host, port: address.port });
				socket.once('connect', () => {
					socket.end();
					resolve();
				});
				socket.once('error', reject);
				socket.setTimeout(500, () => {
					socket.destroy(new Error('protocol endpoint probe timed out'));
				});
			});
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	throw new Error(
		`protocol endpoint did not accept connections${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
	);
}

function publicPairing(
	handoff: ServerPairingHandoff,
	protocolEndpoint?: string,
): Record<string, unknown> {
	const pairingUrl =
		protocolEndpoint === undefined
			? handoff.pairingUrl
			: pairingUrlForEndpoint(handoff, protocolEndpoint);
	return {
		pairingExpiresAt: handoff.pairingExpiresAt,
		pairingSessionId: handoff.pairingSessionId,
		pairingUrl,
		expiresInSeconds: Math.max(
			1,
			Math.ceil((handoff.expiresAt - Date.now()) / 1000),
		),
		requiresApproval: true,
	};
}

function pairingUrlForEndpoint(
	handoff: ServerPairingHandoff,
	protocolEndpoint: string,
): string {
	const endpoint = new URL(protocolEndpoint);
	endpoint.hash = new URL(handoff.pairingUrl).hash;
	return endpoint.toString();
}
