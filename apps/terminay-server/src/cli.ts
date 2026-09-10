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
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@terminay/protocol';
import { managerOriginFromSessionOrigin } from '@terminay/protocol';
import {
	AgentStatusService,
	AiService,
	CanonicalProjectPathResolver,
	FileWorkspaceStateBackend,
	createNodePtyFactory,
	createNodeShellDiscoveryHost,
	createProductionExtensionManagement,
	createServerAiProviderAdapters,
	createServerCoreComposition,
	FileCatalog,
	DocumentationCatalog,
	MdxRuntime,
	FileContentStreamService,
	type FileObservationHost,
	GitService,
	MacroRepository,
	type NodePtyModuleLike,
	OpenAiDictationProvider,
	OrderedEventJournal,
	openCanonicalWorkspace,
	ParakeetRuntime,
	RecordingService,
	type RemoteRegisteredDevice,
	type ServerCoreComposition,
	ServerFileAdapter,
	ServerFileCatalogAdapter,
	ServerDocumentationCatalogAdapter,
	ServerMdxRuntimeAdapter,
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
	createStandaloneServer,
	FileDataRootLease,
	runServerMcpStdio,
	resolveStandaloneServerIdentity,
	type LocalUiServer,
	type ServerPairingHandoff,
	type ServerRemoteExposure,
} from './index.js';
import { resolveTerminalProcessCwd } from './processCwd.js';
import { parseHostedIceServers, startHostedPairingHost } from './remote/hostedPairingHost.js';
import { assertAdvertisedPortIsBindable } from './remote/advertisedIcePort.js';
import { createHostedDiagnosticLogger } from './remote/hostedDiagnosticLog.js';
import { loadHostedUiArchive } from './remote/hostedUiArchive.js';
import { loadOrCreateHostedHostKey, rotateHostedHostKey } from './remote/hostedHostKey.js';
import { loadOrCreateSessionOrigin } from './remote/sessionOrigin.js';
import {
	createDirectSignalingRelay,
	type DirectSignalingRelay,
} from './remote/directSignalingRelay.js';
import { loadOrCreateDirectTlsCertificate } from './remote/directTlsCertificate.js';
import { relaySessionId } from './remote/directSessionId.js';
import {
	approvalSocketPath,
	type PairingHandoffSummary,
	sendApprovalSocketRequest,
	startApprovalSocket,
} from './remote/approvalSocket.js';
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

let options = parseServerCliOptions(process.argv.slice(2), process.env);
if (options.command === 'help') process.stdout.write(formatServerHelp());
else if (options.command === 'version')
	process.stdout.write(`${options.serverVersion}\n`);
else if (options.command === 'mcp') {
	runServerMcpStdio({
		socketPath: process.env.TERMINAY_CONTROL_SOCKET ?? '',
		token: process.env.TERMINAY_CONTROL_TOKEN ?? '',
	}).catch((error: unknown) => {
		process.stderr.write(
			`terminay mcp failed: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
else {
	// The lease is acquired before resolving or opening any durable server
	// authority. It prevents two standalone processes from concurrently owning
	// one workspace, while identity resolution gives separate roots distinct
	// authorities without breaking a legacy workspace's canonical id.
	const standaloneLease = options.command === 'start' ? new FileDataRootLease() : undefined;
	if (standaloneLease !== undefined) {
		await standaloneLease.acquire(options.dataRoot);
		try {
			options = await resolveStandaloneServerIdentity(options);
		} catch (error) {
			await standaloneLease.release(options.dataRoot).catch(() => undefined);
			throw error;
		}
	}
	const devicePersistence = createRemoteDevicePersistence(
		options.dataRoot,
	);
	// `--expose hosted` is the administrator's standing decision for this data
	// root, so the server provisions its own hosted session origin exactly as
	// Desktop does for its embedded server, rather than advertising the
	// unroutable per-server placeholder.
	const exposeHosted = options.exposeModes.includes('hosted');
	// An advertised address exists because the addresses this server can observe
	// about itself do not reach clients. Starting anyway, with a candidate whose
	// port nothing is listening on, produces exactly the silent ICE failure the
	// option was added to remove — so an unbindable port stops the server here,
	// while the operator is still watching.
	if (options.advertiseAddress !== undefined && options.command === 'start') {
		await assertAdvertisedPortIsBindable(options.advertiseAddress);
	}
	const sessionOrigin =
		exposeHosted && !options.remoteOriginExplicit && options.command === 'start'
			? loadOrCreateSessionOrigin(options.dataRoot, options.hostedDomain)
			: options.remoteOrigin;
	// Both exposure modes hand a client the same compact fragment; they differ
	// only in the origin the client reaches the room through.
	const pairingUrlFormat =
		options.exposeModes.length > 0
			? 'hosted-compact'
			: pairingUrlFormatForOrigin(sessionOrigin, options.hostedDomain);
	const remote = createRemoteExposure(
		options.serverId,
		sessionOrigin,
		devicePersistence.load(),
		pairingUrlFormat,
	);
	let protocolReady = false;
	if (options.command === 'approve' || options.command === 'deny' || options.command === 'approvals') {
		await runApprovalCommand(options);
	} else if (options.command === 'reset-identity') {
		await runResetIdentityCommand(options, remote, devicePersistence);
	} else if (options.command === 'status') {
		const runtime = createRuntime(options, remote);
		process.stdout.write(`${JSON.stringify(runtime.diagnostics())}\n`);
	} else if (options.command === 'pairing') {
		await runPairingCommand(options);
	} else {
		try {
		// Pairing material is the sole local HTTP credential. It is delivered in
		// the URL fragment and never copied into a second readiness field.
		const handoff = remote.start();
		const credentials = createProtocolCredentials(remote);
		const serverComposition = await createServerComposition(options, () => {
			if (runtime === undefined)
				throw new Error('server runtime is not composed');
			return runtimeHealth(runtime, protocolReady);
		});
		const composition = serverComposition.core;
		let runtime: StandaloneRuntime | undefined;
		const pairingHosts: {
			close(): Promise<void>;
			mintPairing(): Promise<void>;
		}[] = [];
		let approvalSocket: { close(): Promise<void> } | undefined;
		// Every exposure mode advertises the same room, so exactly one of them
		// mints the replacement and the others re-register what it minted. The
		// generation counter is what keeps a second mode from rotating again on
		// its way to the room it was just told about.
		let sharedHandoff = handoff;
		let sharedGeneration = 0;
		const seenGeneration = new Map<string, number>();
		const rotateShared = (mode: string): ServerPairingHandoff => {
			if (seenGeneration.get(mode) === sharedGeneration) {
				sharedGeneration += 1;
				sharedHandoff = remote.rotate();
			}
			seenGeneration.set(mode, sharedGeneration);
			return sharedHandoff;
		};
		// The direct endpoint is served by this process on the origin it
		// advertises, so it must have a listener to live on and that listener must
		// answer on the advertised port. Fail before anything opens rather than
		// advertising a URL nothing answers.
		const direct = options.exposeModes.includes('direct')
			? await createDirectExposure(options)
			: undefined;
		// Pending devices are announced as metadata-only lines so a headless
		// operator can compare the match code and run `terminay-server approve`.
		const announceApproval = createHostedDiagnosticLogger(options.logSink);
		remote.onApprovalRequested((pending) => {
			announceApproval({
				type: 'approval-pending',
				approvalId: pending.approvalId,
				deviceName: pending.deviceName,
				matchCode: pending.matchCode,
				expiresAt: new Date(pending.expiresAt).toISOString(),
			});
		});
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
						devicePersistence.save,
						direct,
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
				await waitForProtocolEndpoint(uiServer);
				approvalSocket = await startApprovalSocket({
					socketPath: approvalSocketPath(options.dataRoot),
					authority: {
						listPendingApprovals: () => remote.listPendingApprovals(),
						approveEnrollment: (approvalId) => remote.approveEnrollment(approvalId),
						denyEnrollment: (approvalId) => remote.denyEnrollment(approvalId),
						exposureModes: () => options.exposeModes,
						pairingHandoffs: async (rotate) => {
							// Minting a replacement room registers it on every mode.
							// Live peers and reconnect registration are untouched.
							if (rotate) {
								for (const host of pairingHosts) await host.mintPairing();
							}
							return exposureHandoffs(options, sharedHandoff, direct);
						},
					},
				});
				const rendererDirectory = process.env.TERMINAY_UI_RENDERER_DIRECTORY;
				// A server nobody exposed may legitimately have no workspace UI: it
				// is a protocol-only deployment. An exposed one may not. Without
				// this, it pairs a device, connects every lane, and serves a
				// placeholder — which from the device is indistinguishable from a
				// broken network, and this process is the only party that knows
				// the difference.
				if (options.exposeModes.length > 0 && rendererDirectory === undefined) {
					throw new Error(
						'this server is exposed but has no workspace UI configured, so a paired device would receive an empty page. Set TERMINAY_UI_RENDERER_DIRECTORY to the ui directory shipped in this release.',
					);
				}
				// Hosted and direct exposure share one host key, one device
				// registry, and one approval queue: they are two ways for a client
				// to reach the same room on the same server, not two servers.
				const startPairingHost = (
					mode: 'hosted' | 'direct',
					modeHandoff: ServerPairingHandoff,
					signal: {
						connectHost?: string;
						insecureTls?: boolean;
						signalingOnlyConnectHost?: boolean;
					},
					relaySessionId?: string,
				) =>
					startHostedPairingHost({
						...(relaySessionId === undefined ? {} : { sessionId: relaySessionId }),
						rotateHandoff: () => handoffForMode(mode, rotateShared(mode), direct),
						acceptApplication: (transport, authenticatedClient) =>
							composition.core.accept(transport, { authenticatedClient }),
						handoff: modeHandoff,
						hostKey: loadOrCreateHostedHostKey(
							join(options.dataRoot, 'remote-host-key.v1.json'),
						),
						onDiagnostic: createHostedDiagnosticLogger(options.logSink),
						persistDevices: devicePersistence.save,
						remote,
						serverId: options.serverId,
						signal,
						iceServers: parseHostedIceServers(process.env.TERMINAY_WEBRTC_ICE_SERVERS),
						...(options.advertiseAddress === undefined
							? {}
							: { advertiseAddress: options.advertiseAddress }),
						webrtcRuntimeRoot: resolveWebRtcRuntimeRoot(process.cwd(), process.env),
						...(rendererDirectory
							? {
									getUiArchive: () =>
										loadHostedUiArchive(rendererDirectory),
								}
							: {}),
					});
				if (pairingUrlFormat === 'hosted-compact' && !directOnly(options)) {
					pairingHosts.push(
						await startPairingHost('hosted', handoff, hostedSignalOptions(process.env)),
					);
				}
				if (direct !== undefined) {
					// The direct host reaches its own relay over the loopback
					// interface and does not verify the certificate it just minted:
					// the transport transcript, not TLS, authenticates this endpoint.
					// That shortcut is for the signaling socket only — the media
					// candidates it offers must be the ones a remote client can
					// actually reach.
					pairingHosts.push(
						await startPairingHost(
							'direct',
							directHandoff(handoff, direct.directOrigin),
							{
								connectHost: '127.0.0.1',
								insecureTls: true,
								signalingOnlyConnectHost: true,
							},
							relaySessionId(direct.directOrigin),
						),
					);
				}
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
						exposure: options.exposeModes,
						handoffs: exposureHandoffs(options, sharedHandoff, direct),
					})}\n`,
				);
			} catch (error) {
				clearInterval(foregroundLease);
				for (const host of pairingHosts) await host.close().catch(() => undefined);
				await direct?.close().catch(() => undefined);
				await approvalSocket?.close().catch(() => undefined);
				await runtime!.stop().catch(() => undefined);
				await composition.shutdown().catch(() => undefined);
				await healthServer?.stop().catch(() => undefined);
				await standaloneLease?.release(options.dataRoot).catch(() => undefined);
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
				for (const host of pairingHosts) await host.close().catch(() => undefined);
				await direct?.close().catch(() => undefined);
				await approvalSocket?.close().catch(() => undefined);
				await runtime!.stop();
				await composition.shutdown();
				await healthServer?.stop();
				await standaloneLease?.release(options.dataRoot);
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
		} catch (error) {
			await standaloneLease?.release(options.dataRoot).catch(() => undefined);
			throw error;
		}
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
		exposureModes: options.exposeModes,
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
	initialDevices: readonly RemoteRegisteredDevice[],
	pairingUrlFormat: 'standalone' | 'hosted-compact',
): ServerRemoteExposure {
	const exposure = createServerRemoteExposure({
		serverId,
		sessionOrigin,
		pairingUrlFormat,
	});
	exposure.devices.restore(initialDevices);
	return exposure;
}

async function createServerComposition(
	options: ServerCliOptions,
	health: () => JsonValue,
): Promise<
	Readonly<{
		core: ServerCoreComposition;
		workspaceWasCreated: boolean;
		vault: Awaited<ReturnType<typeof createStandaloneVaultComposition>>;
		extensions: ReturnType<typeof createProductionExtensionManagement>;
	}>
> {
	const eventJournal = new OrderedEventJournal();
	const activity = new TerminalActivityService({ serverId: options.serverId });
	let extensionHosts:
		| { agentProviderContributions(): readonly { readonly id: string; readonly displayName: string }[] }
		| undefined
	const agents = new AgentStatusService({
		activity,
		enabled: options.agentIntegrationEnabled,
		providerDisplayName: (providerId) =>
			extensionHosts
				?.agentProviderContributions()
				.find((provider) => provider.id === providerId)?.displayName,
	});
	const workspaceRepository = await openCanonicalWorkspace({
		backend: new FileWorkspaceStateBackend(join(options.dataRoot, 'workspace.v3.json')),
		serverId: options.serverId,
		defaultProjectRoot: options.projectRoot,
	});
	const workspace = workspaceRepository.workspace;
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
	const extensions = createProductionExtensionManagement({
		dataRoot: options.dataRoot,
		authorityLabel: 'This server',
		builtInArtifactRoot: resolveBuiltInExtensionArtifactRoot(),
		vault,
	});
	extensionHosts = extensions.hosts;
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
		onConnectionClosed: (_connectionId, clientId) => {
			files.mdxRuntime.closeClient(clientId);
		},
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'admin',
			permissions: [
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
		workspaceOperations: {
			prepareProjectRootUpdate: files.prepareProjectRootUpdate,
		},
		// What a restored workspace contains is server policy; this supplies only
		// the act of making a session. Without it a restart republished the
		// previous process's terminal panels as tabs that could say nothing but
		// that they had exited.
		workspaceStartup: {
			firstRun: workspaceRepository.wasCreated,
			createTerminal: async (request) => {
				const resolver = composition.terminalLaunchResolver;
				if (resolver === undefined)
					throw new Error('canonical terminal launch resolver is unavailable');
				const launch = await resolver.resolve({
					identity: composition.terminal.allocateIdentity(
						request.projectId,
						request.sessionId,
					),
					cols: request.cols,
					rows: request.rows,
				});
				return composition.terminal.createResolvedSession(launch);
			},
		},
		fileObservations: files.observations,
		// Language intelligence exists only where both the project files and the
		// extensions live, which on this server is the same process.
		language: {
			extensions: extensions.hosts,
			projects: files.projects,
			watch: files.observations,
		},
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
		},
		operations: {
			queries: {
				...files.session.operations().queries,
				...files.content.operations().queries,
				...files.catalog.operations().queries,
				...files.documentation.operations().queries,
				...files.mdxRuntime.operations().queries,
				'server.health': () => health(),
			},
			commands: {
				...files.session.operations().commands,
				...files.catalog.operations().commands,
				...files.mdxRuntime.operations().commands,
			},
		},
	});
	return Object.freeze({ core: composition, vault, extensions, workspaceWasCreated: workspaceRepository.wasCreated });
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
	/** The canonical per-project resolvers, shared with language sessions. */
	readonly projects: ReadonlyMap<
		string,
		{
			readonly projectId: string;
			readonly resolver: CanonicalProjectPathResolver;
		}
	>;
	readonly session: ServerFileAdapter;
	readonly content: ServerFileContentAdapter;
	readonly catalog: ServerFileCatalogAdapter;
	readonly documentation: ServerDocumentationCatalogAdapter;
	readonly mdxRuntime: ServerMdxRuntimeAdapter;
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
	const documentationProjects = new Map([
		['default', { projectId: 'default', catalog: new DocumentationCatalog(resolver, storage) }],
	]);
	const mdxRuntimeProjects = new Map([
		['default', { projectId: 'default', runtime: new MdxRuntime({ projectId: 'default', resolver, storage }) }],
	]);
	const observationHost = createStandaloneFileObservationHost(
		sessionProjects,
		storage,
	);
	const mdxRuntime = new ServerMdxRuntimeAdapter({
		serverId,
		projects: mdxRuntimeProjects,
	});
	return {
		projects: sessionProjects,
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
		documentation: new ServerDocumentationCatalogAdapter({ serverId, projects: documentationProjects }),
		mdxRuntime,
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
			const nextDocumentationCatalog = new DocumentationCatalog(nextResolver, storage);
			const nextMdxRuntime = new MdxRuntime({ projectId, resolver: nextResolver, storage });
			return Object.freeze({
				canonicalRoot,
				commit: () => {
					mdxRuntime.disposeProject(projectId);
					sessionProjects.set(projectId, {
						projectId,
						resolver: nextResolver,
						storage,
					});
					contentProjects.set(projectId, { projectId, content: nextContent });
					catalogProjects.set(projectId, { projectId, catalog: nextCatalog });
					documentationProjects.set(projectId, { projectId, catalog: nextDocumentationCatalog });
					mdxRuntimeProjects.set(projectId, { projectId, runtime: nextMdxRuntime });
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
	persistDevices: (
		records: readonly RemoteRegisteredDevice[],
	) => void,
	direct?: DirectExposure,
): LocalUiServer {
	return createLocalUiServer({
		// The signaling endpoint is served beside the authenticated protocol on
		// this listener, and terminates TLS with the server's own certificate.
		...(direct === undefined
			? {}
			: { tls: direct.tls, signalingUpgrade: direct.signalingUpgrade }),
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
				'workspace:write',
				'extensions:read',
				'extensions:manage',
			],
		}),
		deviceAuthentication: {
			enroll: ({ pairingSessionId, pairingToken, pairingExpiresAt, deviceName, publicKeyPem }) => {
				// Loopback HTTP enrollment is same-machine: the one-time fragment is
				// the whole authority there, so no approval step applies.
				if (!validPairingExpiry(pairingExpiresAt))
					throw new Error('pairing authority is invalid');
				const device = remote.enrollDevice({
					pairingSessionId,
					pairingToken,
					deviceName,
					publicKeyPem,
				});
				persistDevices(remote.devices.list());
				return { deviceId: device.deviceId };
			},
			challenge: ({ deviceId }) => {
				const pending = remote.createDeviceChallenge(deviceId);
				return { ...pending.challenge, signingInput: pending.signingInput };
			},
			verify: ({ deviceId, challengeId, deviceSignature }) => {
				const ticket = remote.verifyDeviceSignature({
					deviceId,
					challengeId,
					deviceSignature,
				});
				return { ticket: ticket.ticket, expiresAt: ticket.expiresAt };
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
}

/** The device authority mints one-use application tickets. This small cache
 * only carries the authenticated device id across LocalUiServer's credential
 * callbacks; it never stores a credential or survives process shutdown. */
function createProtocolCredentials(
	remote: ServerRemoteExposure,
): ProtocolCredentials {
	const accepted = new Map<string, string>();
	return {
		accept: (ticket) => {
			try {
				const result = remote.consumeConnectionTicket(ticket);
				accepted.set(ticket, result.deviceId);
				return true;
			} catch {
				return false;
			}
		},
		clientId: (ticket) => accepted.get(ticket),
	};
}

interface RemoteDevicePersistence {
	readonly load: () => readonly RemoteRegisteredDevice[];
	readonly save: (records: readonly RemoteRegisteredDevice[]) => void;
}

/** Device public keys and non-secret metadata are the complete durable remote
 * credential record. Pairing fragments, signatures, and tickets are never
 * serialized. Unknown schemas start clean; this is intentionally a cutover. */
function createRemoteDevicePersistence(
	dataRoot: string,
): RemoteDevicePersistence {
	const file = join(dataRoot, 'remote-devices.v1.json');
	return {
		load: () => {
			try {
				const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
				if (!Array.isArray(parsed))
					return [];
				return parsed as readonly RemoteRegisteredDevice[];
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

function validPairingExpiry(value: string): boolean {
	const parsed = Date.parse(value);
	return Number.isSafeInteger(parsed) && parsed > Date.now() - 60_000;
}

async function runApprovalCommand(options: ServerCliOptions): Promise<void> {
	const socketPath = approvalSocketPath(options.dataRoot);
	const request =
		options.command === 'approvals'
			? ({ op: 'list' } as const)
			: ({ op: options.command === 'approve' ? 'approve' : 'deny', approvalId: options.approvalId! } as const);
	const response = await sendApprovalSocketRequest(socketPath, request);
	process.stdout.write(`${JSON.stringify(response)}\n`);
	if (!response.ok) process.exitCode = 1;
}

/**
 * Ask the running server for its live pairing handoff.
 *
 * The room a client must join is one the server has registered with a relay,
 * so only that process can name it. This command is a client of the owner-only
 * socket in the data root; it mints nothing of its own and fails with a clear
 * message when no server owns the root.
 */
async function runPairingCommand(options: ServerCliOptions): Promise<void> {
	let response: Awaited<ReturnType<typeof sendApprovalSocketRequest>>;
	try {
		response = await sendApprovalSocketRequest(approvalSocketPath(options.dataRoot), {
			op: 'pairing',
		});
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : 'no running server owns this data root'}\n`,
		);
		process.exitCode = 1;
		return;
	}
	if (!response.ok) {
		process.stderr.write(`${response.error}\n`);
		process.exitCode = 1;
		return;
	}
	if (!('handoffs' in response)) {
		process.stderr.write('the running server did not return a pairing handoff\n');
		process.exitCode = 1;
		return;
	}
	if (response.exposure === 'off' || response.handoffs.length === 0) {
		process.stdout.write(`${JSON.stringify({ serverId: options.serverId, exposure: 'off' })}\n`);
		return;
	}
	for (const handoff of response.handoffs) {
		process.stdout.write(`${JSON.stringify({ ...handoff, requiresApproval: true })}\n`);
	}
}

/** Rotate the host key and revoke every device. Requires a stopped server so
 * the live host cannot keep advertising the retired key. */
async function runResetIdentityCommand(
	options: ServerCliOptions,
	remote: ServerRemoteExposure,
	devicePersistence: RemoteDevicePersistence,
): Promise<void> {
	const revoked = await remote.revokeAllDevices();
	devicePersistence.save(remote.devices.list());
	const key = rotateHostedHostKey(join(options.dataRoot, 'remote-host-key.v1.json'));
	process.stdout.write(
		`${JSON.stringify({ serverId: options.serverId, identityReset: true, revokedDevices: revoked, hostPublicKey: key.publicKey })}\n`,
	);
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

/** The same room as this mode's client reaches it. */
function handoffForMode(
	mode: 'hosted' | 'direct',
	handoff: ServerPairingHandoff,
	direct: DirectExposure | undefined,
): ServerPairingHandoff {
	return mode === 'direct' && direct !== undefined
		? directHandoff(handoff, direct.directOrigin)
		: handoff;
}

/**
 * One live pairing handoff per enabled exposure mode. The hosted and direct
 * modes share one exposure, so they share a room and differ only in the origin
 * a client reaches it through. With no mode enabled this is empty: the server
 * is not remotely reachable, whatever local pairing URL readiness also carries.
 */
function exposureHandoffs(
	options: ServerCliOptions,
	handoff: ServerPairingHandoff,
	direct: DirectExposure | undefined,
): readonly PairingHandoffSummary[] {
	return Object.freeze(
		options.exposeModes.map((mode) =>
			Object.freeze({
				mode,
				pairingUrl: handoffForMode(mode, handoff, direct).pairingUrl,
				pairingExpiresAt: handoff.pairingExpiresAt,
				serverId: options.serverId,
			}),
		),
	);
}

interface DirectExposure {
	readonly directOrigin: string;
	readonly tls: { readonly cert: string; readonly key: string };
	readonly certificateFingerprint: string;
	readonly signalingUpgrade: {
		readonly path: string;
		readonly handle: DirectSignalingRelay['handleUpgrade'];
	};
	close(): Promise<void>;
}

/**
 * Compose the server's own data-blind signaling endpoint.
 *
 * The endpoint lives on the authenticated HTTP listener, so one port serves the
 * UI archive, health, and signaling. That listener must therefore exist and
 * must answer on exactly the port the direct origin advertises; anything else
 * would publish a pairing URL that nothing answers.
 */
async function createDirectExposure(
	options: ServerCliOptions,
): Promise<DirectExposure> {
	const directOrigin = options.directOrigin as string;
	if (options.endpoint === 'disabled') {
		throw new Error(
			'--expose direct needs the authenticated HTTP listener; --endpoint disabled turns it off',
		);
	}
	const advertised = new URL(directOrigin);
	const advertisedPort = advertised.port === '' ? 443 : Number(advertised.port);
	if (options.httpPort === undefined || options.httpPort !== advertisedPort) {
		throw new Error(
			`--expose direct requires --http-port ${advertisedPort} to match --direct-origin ${directOrigin}`,
		);
	}
	const certificate = await loadOrCreateDirectTlsCertificate(
		options.dataRoot,
		directOrigin,
	);
	// The manager origin is the public connection-manager host, which must never
	// be able to accept a signaling upgrade. It is always the hosted domain's
	// manager, never this listener.
	const managerOrigin = `https://app.${options.hostedDomain}`;
	if (managerOrigin === directOrigin) {
		throw new Error('--direct-origin must not be the hosted connection-manager origin');
	}
	const relay = createDirectSignalingRelay({
		sessionOrigin: directOrigin,
		managerOrigin,
	});
	return Object.freeze({
		directOrigin,
		tls: { cert: certificate.cert, key: certificate.key },
		certificateFingerprint: certificate.fingerprint,
		signalingUpgrade: {
			path: relay.signalingPath,
			handle: relay.handleUpgrade,
		},
		close: () => relay.close(),
	}) as DirectExposure;
}

/**
 * The same room, reached through the server's own origin. Hosted and direct
 * links carry the same fragment, so a device that paired one way reconnects the
 * other without pairing again.
 */
function directHandoff(
	handoff: ServerPairingHandoff,
	directOrigin: string,
): ServerPairingHandoff {
	return Object.freeze({
		...handoff,
		sessionOrigin: directOrigin,
		pairingUrl: directPairingUrl(handoff, directOrigin),
	});
}

/** True when the operator asked for direct exposure and nothing else. */
function directOnly(options: ServerCliOptions): boolean {
	return (
		options.exposeModes.includes('direct') && !options.exposeModes.includes('hosted')
	);
}

/**
 * A direct pairing link points at the server's own signaling listener. It keeps
 * the hosted `/v1/` grammar and the secret in the fragment, so a client parses
 * and pairs with it exactly as it does a hosted link, and no secret is ever put
 * where an HTTPS request line could carry it.
 */
function directPairingUrl(
	handoff: ServerPairingHandoff,
	directOrigin: string,
): string {
	const advertised = new URL(handoff.pairingUrl);
	const direct = new URL('/v1/', directOrigin);
	const hostName = advertised.searchParams.get('hostName');
	if (hostName !== null) direct.searchParams.set('hostName', hostName);
	direct.hash = advertised.hash;
	return direct.toString();
}

function pairingUrlForEndpoint(
	handoff: ServerPairingHandoff,
	protocolEndpoint: string,
): string {
	const advertised = new URL(handoff.pairingUrl);
	const endpoint = new URL(protocolEndpoint);
	advertised.protocol = endpoint.protocol;
	if (advertised.searchParams.has('s')) {
		advertised.host = new URL(managerOriginFromSessionOrigin(endpoint.origin)).host;
		return advertised.toString();
	}
	advertised.host = endpoint.host;
	return advertised.toString();
}

function pairingUrlFormatForOrigin(
	sessionOrigin: string,
	hostedDomain: string,
): 'standalone' | 'hosted-compact' {
	try {
		const url = new URL(sessionOrigin);
		const domain = hostedDomain.toLowerCase();
		const host = (domain.includes(':') ? url.host : url.hostname).toLowerCase();
		if (host.endsWith(`.${domain}`) && host !== `app.${domain}`) return 'hosted-compact';
	} catch {
		// Fall through to the standalone local-HTTP pairing fragment.
	}
	return 'standalone';
}

function resolveWebRtcRuntimeRoot(
	cwd: string,
	env: Readonly<Record<string, string | undefined>>,
): string {
	const configured = env.TERMINAY_WEBRTC_RUNTIME_ROOT?.trim();
	if (configured) return resolve(configured);
	return resolve(cwd, '../../build/webrtc-runtime');
}

/** The standalone npm package carries the same staged artifact bytes as the
 * Electron resource bundle. This lookup is module-relative, never cwd based. */
function resolveBuiltInExtensionArtifactRoot(): string {
	const configured = process.env.TERMINAY_BUILTIN_EXTENSIONS_ROOT?.trim();
	if (configured) return resolve(configured);
	return resolve(dirname(fileURLToPath(import.meta.url)), 'built-in-extensions');
}

function hostedSignalOptions(env: Readonly<Record<string, string | undefined>>): {
	connectHost?: string;
	insecureTls?: boolean;
} {
	const connectHost = env.TERMINAY_SIGNAL_CONNECT_HOST?.trim();
	return {
		...(connectHost ? { connectHost } : {}),
		...(env.TERMINAY_SIGNAL_INSECURE_TLS === '1' ? { insecureTls: true } : {}),
	};
}
