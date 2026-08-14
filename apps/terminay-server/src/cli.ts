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
	composeRemoteMcpTerminalLifecycle,
	createEnvironmentRoutedProjectServices,
	FileWorkspaceStateBackend,
	createNodePtyFactory,
	createNodeShellDiscoveryHost,
	createPuzedSshProductionExtensionManagement,
	createServerAiProviderAdapters,
	createServerCoreComposition,
	ExtensionProjectEnvironmentRuntime,
	FileCatalog,
	FileContentStreamService,
	type FileObservationHost,
	FileProjectEnvironmentStateBackend,
	GitService,
	MacroRepository,
	type NodePtyModuleLike,
	OpenAiDictationProvider,
	OrderedEventJournal,
	openCanonicalWorkspace,
	ParakeetRuntime,
	ProjectEnvironmentRegistry,
	ProjectEnvironmentRepository,
	ProjectEnvironmentRouter,
	RecordingService,
	RemoteMcpBridgeAuthority,
	RemoteMcpEnvironmentCoordinator,
	type RemoteReconnectGrantRecord,
	type ServerCoreComposition,
	ServerFileAdapter,
	ServerFileCatalogAdapter,
	ServerFileContentAdapter,
	ServerFileObservationAdapter,
	ServerGitAdapter,
	ServerParakeetDictationProvider,
	ServerRecordingAdapter,
	type ServerRuntimeServices,
	ServerSettingsRepository,
	ShellProfileCatalogueService,
	ShellProfileDiscoveryService,
	TerminalActivityService,
	TerminalReplayRegistry,
	VaultProviderCredentialResolver,
	type WorkspaceStore,
} from '@terminay/server-core';
import * as nodePty from 'node-pty';
import {
	allowedWebOrigins,
	formatServerHelp,
	parseServerCliOptions,
	type ServerCliOptions,
} from './cliOptions.js';
import { createStandaloneVaultComposition } from './headlessVault.js';
import {
	createLocalUiServer,
	createServerHealthServer,
	createServerRemoteExposure,
	createServerTerminalControlAdapter,
	createStandaloneServer,
	createTerminalControlAdapter,
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
	readonly platform: NodeJS.Platform;
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
		const serverComposition = await createServerComposition(options, () => {
			if (runtime === undefined)
				throw new Error('server runtime is not composed');
			return runtimeHealth(runtime, protocolReady);
		});
		const composition = serverComposition.core;
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
		runtime = createRuntime(options, remote, uiServer, {
			vault: serverComposition.vault.vault,
			extensionSecrets: serverComposition.vault.extensionSecrets,
			extensionHosts: serverComposition.extensions.hosts,
		});

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
				// Start journal observation before creating the default session.
				await composition.start();
				const health = await runtime!.start();
				if (serverComposition.workspaceWasCreated)
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
	serverServices: Pick<
		ServerRuntimeServices,
		'vault' | 'extensionSecrets' | 'extensionHosts'
	> = {},
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
			...serverServices,
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

async function createServerComposition(
	options: ServerCliOptions,
	health: () => JsonValue,
): Promise<
	Readonly<{
		core: ServerCoreComposition;
		workspaceWasCreated: boolean;
		vault: Awaited<ReturnType<typeof createStandaloneVaultComposition>>;
		extensions: ReturnType<typeof createPuzedSshProductionExtensionManagement>;
	}>
> {
	const eventJournal = new OrderedEventJournal();
	const activity = new TerminalActivityService({ serverId: options.serverId });
	const agents = new AgentStatusService({
		activity,
		enabled: options.agentIntegrationEnabled,
	});
	const workspaceRepository = await openCanonicalWorkspace({
		backend: new FileWorkspaceStateBackend(join(options.dataRoot, 'workspace.v3.json')),
		serverId: options.serverId,
		defaultProjectRoot: options.projectRoot,
	});
	const workspace = workspaceRepository.workspace;
	const projectEnvironments = new ProjectEnvironmentRepository(
		new FileProjectEnvironmentStateBackend(
			join(options.dataRoot, 'project-environments.v1.json'),
		),
		options.serverId,
	);
	await projectEnvironments.load();
	const projectEnvironmentRegistry = new ProjectEnvironmentRegistry();
	const projectEnvironmentRouter = new ProjectEnvironmentRouter({
		serverId: options.serverId,
		workspaceSnapshot: () => workspace.state,
		environmentSnapshot: () => projectEnvironments.state,
		registry: projectEnvironmentRegistry,
	});
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
	await settings.load();
	const shellProfiles = new ShellProfileCatalogueService({
		settings,
		discovery: new ShellProfileDiscoveryService(
			await createNodeShellDiscoveryHost(process.env),
		),
		projectReferences: (profileId) =>
			Object.values(workspace.state.projects)
				.filter((project) => project.defaultShellProfileId === profileId)
				.map((project) => project.id),
	});
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
	const vault = await createStandaloneVaultComposition({
		dataRoot: options.dataRoot,
		serverId: options.serverId,
		...(options.vaultUnlockFd === undefined
			? {}
			: { unlockFd: options.vaultUnlockFd }),
	});
	const extensions = createPuzedSshProductionExtensionManagement({
		dataRoot: options.dataRoot,
		authorityLabel: 'This server',
		vault,
		projectEnvironments,
		workspace,
	});
	projectEnvironmentRegistry.register(
		new ExtensionProjectEnvironmentRuntime(
			'com.terminay.ssh/connection',
			['terminal', 'filesystem', 'mcp-bridge'],
			extensions.hosts,
			() => projectEnvironments.state,
		),
	);
	const git = new ServerGitAdapter({
		serverId: options.serverId,
		git: gitService,
		resolveProjectRoot: (projectId) =>
			workspace.state.projects[projectId]?.root ?? null,
	});
	const parakeetRuntime = new ParakeetRuntime({
		rootDirectory: join(options.dataRoot, 'dictation', 'parakeet'),
	});
	const parakeetProvider = new ServerParakeetDictationProvider(
		parakeetRuntime,
		join(options.dataRoot, 'dictation', 'temporary'),
	);
	const openAiProvider = new OpenAiDictationProvider();
	const openAiSecretId = 'dictation-openai-api-key';
	let composition: ServerCoreComposition;
	const ai = new AiService({
		serverId: options.serverId,
		authority: {
			getTarget: (target) =>
				standaloneAiTarget(options.serverId, workspace, composition, target),
			authorize: (_clientId, target) =>
				standaloneAiTarget(options.serverId, workspace, composition, target)
					?.live === true,
			writeInput: (target, input) =>
				composition.terminal.input(target.sessionId, input),
		},
		replay: new TerminalReplayRegistry(),
		dictationProvider: {
			transcribe: (request) =>
				request.model === 'mlx-community/parakeet-tdt-0.6b-v3'
					? parakeetProvider.transcribe(request)
					: openAiProvider.transcribe(request),
		},
		dictationRuntime: parakeetProvider,
		credentialResolver: new VaultProviderCredentialResolver({
			vault: vault.vault,
			bindings: [{ provider: 'openai', secretId: openAiSecretId }],
		}),
		dictationCredential: {
			status: () => ({
				configured: vault
					.status()
					.entries.some((entry) => entry.id === openAiSecretId),
			}),
			set: async (value) => {
				const exists = vault
					.status()
					.entries.some((entry) => entry.id === openAiSecretId);
				await (exists
					? vault.vault.replace({
							id: openAiSecretId,
							label: 'OpenAI API key',
							value,
						})
					: vault.vault.put({
							id: openAiSecretId,
							label: 'OpenAI API key',
							value,
						}));
				return { configured: true };
			},
			clear: async () => ({
				configured: !(await vault.vault.remove(openAiSecretId)).deleted,
			}),
		},
		dictationSettings: () => standaloneDictationSettings(settings.settings),
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
	let remoteMcp: RemoteMcpEnvironmentCoordinator | undefined;
	composition = createServerCoreComposition({
		serverId: options.serverId,
		serverVersion: options.serverVersion,
		capabilities: [
			'terminal',
			'workspace',
			'files',
			'agents',
			'server.health',
			'ai.dictation',
		],
		eventJournal,
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'admin',
			permissions: [
				'environments:read',
				'environments:manage',
				'workspace:write',
				'extensions:read',
				'extensions:manage',
			],
		}),
		ptyFactory: createNodePtyFactory(nodePty as unknown as NodePtyModuleLike, {
			resolveCwd: resolveTerminalProcessCwd,
		}),
		activity,
		agents,
		workspace,
		projectEnvironmentRouter,
		projectEnvironments: {
			repository: projectEnvironments,
			thisServerRoot: () => options.projectRoot,
			...(extensions !== undefined && 'profiles' in extensions
				? { providers: extensions.profiles }
				: {}),
		},
		workspaceOperations: {
			prepareProjectRootUpdate: files.prepareProjectRootUpdate,
		},
		fileObservations: files.observations,
		settings,
		terminalProfiles: shellProfiles,
		shellProfiles,
		terminalLaunchEnvironment: {
			...process.env,
			COLORTERM: 'truecolor',
		},
		terminalEnvironmentCaseInsensitive: process.platform === 'win32',
		...(process.platform === 'darwin'
			? { terminalSystemDefaultStartupMode: 'login' as const }
			: {}),
		recordings,
		extensions,
		git,
		ai,
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
			sessionLifecycle: composeRemoteMcpTerminalLifecycle(() => remoteMcp),
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
	const control = createTerminalControlAdapter({
		adapter: createServerTerminalControlAdapter({
			terminal: composition.terminal,
			launchResolver: requireTerminalLaunchResolver(composition),
			activity,
		}),
	});
	const remoteMcpAuthority = new RemoteMcpBridgeAuthority({
		dispatch: async (scope, op, params, { signal }) => {
			const result = await control(
				{
					id: `${op}:${Date.now()}`,
					version: 1,
					op: op as never,
					params: params as Record<string, unknown>,
				},
				{
					terminalSessionId: scope.terminalSessionId,
					projectId: scope.projectId,
					scope: scope.scope,
					connectionId: `remote-mcp:${scope.terminalSessionId}`,
					requestId: `${op}:${Date.now()}`,
					signal,
				},
			);
			return JSON.parse(JSON.stringify(result)) as JsonValue;
		},
	});
	remoteMcp = new RemoteMcpEnvironmentCoordinator(
		createEnvironmentRoutedProjectServices(projectEnvironmentRouter).mcpBridge,
		remoteMcpAuthority,
	);
	const baseShutdown = composition.shutdown;
	composition = Object.freeze({
		...composition,
		shutdown: async () => {
			parakeetProvider.stop();
			await remoteMcp?.shutdown();
			await baseShutdown();
		},
	});
	return Object.freeze({ core: composition, vault, extensions, workspaceWasCreated: workspaceRepository.wasCreated });
}

function requireTerminalLaunchResolver(composition: ServerCoreComposition) {
	if (composition.terminalLaunchResolver === undefined)
		throw new Error(
			'Remote MCP requires the canonical terminal launch resolver.',
		);
	return composition.terminalLaunchResolver;
}

function standaloneDictationSettings(
	settings: Readonly<Record<string, JsonValue>>,
) {
	const value = settings.dictation;
	const dictation =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, JsonValue>)
			: {};
	return {
		enabled: dictation.enabled !== false,
		provider: dictation.provider === 'parakeet' ? 'parakeet' : 'disabled',
		model:
			typeof dictation.model === 'string' && dictation.model.length > 0
				? dictation.model
				: 'mlx-community/parakeet-tdt-0.6b-v3',
		language: typeof dictation.language === 'string' ? dictation.language : '',
		prompt: typeof dictation.prompt === 'string' ? dictation.prompt : '',
	};
}

function standaloneAiTarget(
	serverId: string,
	workspace: WorkspaceStore,
	composition: ServerCoreComposition,
	target: {
		readonly serverId: string;
		readonly projectId: string;
		readonly panelId: string;
		readonly sessionId: string;
	},
) {
	if (target.serverId !== serverId) return undefined;
	const panel = workspace.state.panels[target.panelId];
	const session = composition.terminal.getSession(target.sessionId);
	if (
		panel?.type !== 'terminal' ||
		panel.projectId !== target.projectId ||
		panel.sessionId !== target.sessionId ||
		session?.projectId !== target.projectId
	)
		return undefined;
	return {
		...target,
		live: session.status === 'running',
		metadataRevision: 0,
		title: panel.title ?? 'Terminal',
		note: '',
	};
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
		backup: async (source) => {
			const backupPath = `${path}.pre-migration.json`;
			await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
			try {
				await writeFile(backupPath, JSON.stringify(source), {
					encoding: 'utf8',
					mode: 0o600,
					flag: 'wx',
				});
			} catch (error) {
				if ((error as { code?: string }).code !== 'EEXIST') throw error;
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
		protocolAuthenticatedClientForCredential: (credential, clientId) => ({
			clientId: credentials.clientId(credential) ?? clientId,
			authScope: 'admin',
			permissions: [
				'environments:read',
				'environments:manage',
				'workspace:write',
				'extensions:read',
				'extensions:manage',
			],
		}),
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
				const authenticated = remote.verifyReconnectProof({
					attemptId,
					handle,
					origin: options.remoteOrigin,
					clientNonce,
					proof,
				});
				persistReconnectRecords(remote.reconnect.list());
				return credentials.issue(authenticated.deviceId);
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
	readonly clientId: (token: string) => string | undefined;
	readonly issue: (clientId: string) => {
		readonly ticket: string;
		readonly expiresAt: number;
	};
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
	const tickets = new Map<
		string,
		Readonly<{ expiresAt: number; clientId: string }>
	>();
	const prune = (now: number): void => {
		for (const [ticket, value] of tickets)
			if (value.expiresAt <= now) tickets.delete(ticket);
	};
	return {
		accept: (ticket) => {
			const now = Date.now();
			prune(now);
			const value = tickets.get(ticket);
			return value !== undefined && value.expiresAt > now;
		},
		clientId: (ticket) => tickets.get(ticket)?.clientId,
		issue: (clientId) => {
			const now = Date.now();
			prune(now);
			const ticket = randomBytes(32).toString('base64url');
			const expiresAt = now + lifetimeMs;
			tickets.set(ticket, { expiresAt, clientId });
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
	const resolver = composition.terminalLaunchResolver;
	if (resolver === undefined)
		throw new Error('canonical terminal launch resolver is unavailable');
	const launch = await resolver.resolve({
		identity: composition.terminal.allocateIdentity('default', 'default'),
		cols: 100,
		rows: 30,
	});
	await composition.terminal.createResolvedSession(launch);
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
