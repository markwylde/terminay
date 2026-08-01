import { appendFileSync, watch as watchFileSystem } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import {
	lstat,
	mkdir,
	open,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { AgentStatusService } from '../packages/server-core/src/activity/agentService';
import type { ActivitySessionIdentity } from '../packages/server-core/src/activity/service';
import { TerminalActivityService } from '../packages/server-core/src/activity/service';
import type { ServerCoreCompositionOptions } from '../packages/server-core/src/composition';
import {
	createServerCoreComposition,
	type ServerCoreComposition,
} from '../packages/server-core/src/composition';
import { OrderedEventJournal } from '../packages/server-core/src/events';
import {
	CanonicalProjectPathResolver,
	FileCatalog,
	type FileCatalogProjectContext,
	type FileCatalogStorage,
	type FileContentProjectContext,
	type FileProjectContext,
	type FileSessionStorage,
	FileContentStreamService,
	ServerFileAdapter,
	ServerFileCatalogAdapter,
	ServerFileContentAdapter,
} from '../packages/server-core/src/fileService/index';
import { ServerGitAdapter } from '../packages/server-core/src/gitService/adapter';
import { GitService } from '../packages/server-core/src/gitService/service';
import { ServerFileObservationAdapter } from '../packages/server-core/src/fileService/observationAdapter';
import type { ServerSettingsRepository } from '../packages/server-core/src/settings/repository';
import type {
	BinaryQueryHandlerResult,
	CommandRequest,
	QueryRequest,
} from '../packages/server-core/src/types';
import {
	createNodePtyFactory,
	DetachableTerminalConsumerRegistry,
	type TerminalAuthorization,
	type TerminalCreateOptions,
	type TerminalDimensions,
	type TerminalEvent,
	type TerminalService,
	type TerminalSubscription,
	type Unsubscribe,
} from '../packages/server-core/src/terminalService/index';
import {
	createInitialWorkspace,
	WorkspaceStore,
} from '../packages/server-core/src/workspace';
import {
	type ServerMessagePort,
	ServerPortTransport,
	ServerScopedMessagePort,
} from '../src/shared/serverPortTransport';
import {
	type AgentStatusIpcAuthority,
	createServerAgentStatusIpcAdapter,
} from './agentStatus/serverAdapter';
import { decodeFrame } from '@terminay/protocol';
import type { JsonValue } from '@terminay/protocol';
import type {
	AiTabMetadataGenerateRequest,
	AiTabMetadataGenerateResult,
	FileViewerSparseFileSaveRequest,
} from '../src/types/terminay';
import { resolveTerminalProcessCwd } from './processCwd';

const require = createRequire(import.meta.url);
type MainServerPortDiagnostics = {
	acceptedPorts: number;
	receivedFrames: number;
	sentFrames: number;
	lastReceivedType?: string;
	lastSentType?: string;
	lastOperation?: string;
	lastError?: string;
};
const MAIN_PORT_DIAGNOSTIC_LOG_LIMIT = 32;
const MAIN_PORT_FILE_DIAGNOSTIC_LOG_LIMIT = 256;
const MAIN_PORT_PER_TURN_LIMIT = 256;
const MAIN_PORT_IDENTICAL_FRAME_LIMIT = 64;
const mainServerPortDiagnostics: MainServerPortDiagnostics = {
	acceptedPorts: 0,
	receivedFrames: 0,
	sentFrames: 0,
};
(globalThis as typeof globalThis & {
	__terminayMainServerPortDiagnostics?: MainServerPortDiagnostics;
}).__terminayMainServerPortDiagnostics = mainServerPortDiagnostics;
writePortDiagnostic({ phase: 'authority-module-initialized' });

export function writePortDiagnostic(value: Readonly<Record<string, unknown>>): void {
	if (process.env.TERMINAY_TEST !== '1') return;
	const file = process.env.TERMINAY_PORT_DIAGNOSTIC_FILE?.trim();
	if (!file) return;
	try {
		appendFileSync(
			file,
			`${JSON.stringify({ timestamp: Date.now(), ...value })}\n`,
			{ encoding: 'utf8', mode: 0o600 },
		);
	} catch {
		// Diagnostics must never change production or test control flow.
	}
}
type NodePtyModule = {
	spawn: Parameters<typeof createNodePtyFactory>[0]['spawn'];
};

export interface ServerTerminalAuthoritySession {
	readonly id: string;
	readonly serverId: string;
	readonly projectId: string;
	readonly cwd: string;
	/** Shell selected when this session was created. Never derive recording
	 * metadata from a later, mutable Desktop setting. */
	readonly shellPath: string | null;
	readonly pid: number | undefined;
	readonly status: 'running' | 'exited' | 'interrupted';
}

export interface ServerTerminalRendererEvent {
	readonly type: 'output' | 'exit' | 'resync_required';
	readonly id: string;
	readonly data?: string;
	readonly exitCode?: number;
	readonly signal?: number | null;
	readonly fromPosition?: number;
	readonly replayFrom?: number;
	readonly outputPosition?: number;
}

/**
 * Host bookkeeping emitted only after server-core has accepted PTY input.
 * This is intentionally not a protocol event: recording and remote host
 * integrations observe committed writes without becoming terminal authority.
 */
export interface ServerTerminalAcceptedWrite {
	readonly serverId: string;
	readonly projectId: string;
	readonly sessionId: string;
	readonly data: string | Uint8Array;
}

/**
 * Host bookkeeping emitted only after server-core has accepted a resize.
 * Dimensions are normalized by TerminalService before this callback runs.
 */
export interface ServerTerminalAcceptedResize {
	readonly serverId: string;
	readonly projectId: string;
	readonly sessionId: string;
	readonly cols: number;
	readonly rows: number;
}

type ServerTerminalHostObserver<TEvent> = (
	event: TEvent,
) => void | Promise<void>;

export interface ServerTerminalAuthorityOptions {
	readonly serverId: string;
	/** Test/host injection; production uses the embedded node-pty factory. */
	readonly terminalService?: TerminalService;
	readonly maxReplayBytes?: number;
	readonly onEvent?: (event: TerminalEvent) => void;
	/** Host-only observer for input that server-core has already accepted. */
	readonly onAcceptedWrite?: ServerTerminalHostObserver<ServerTerminalAcceptedWrite>;
	/** Host-only observer for resize that server-core has already accepted. */
	readonly onAcceptedResize?: ServerTerminalHostObserver<ServerTerminalAcceptedResize>;
	/** Optional server-owned macro protocol services supplied by the host. */
	readonly macros?: ServerCoreCompositionOptions['macros'];
	/** Optional server-owned recording protocol authority supplied by Desktop. */
	readonly recordings?: ServerCoreCompositionOptions['recordings'];
	/** Durable server settings shared by Desktop and browser renderers. */
	readonly settings?: ServerSettingsRepository;
	/** Desktop provider adapter retained behind the server protocol while the
	 * canonical AI target registry is wired to workspace presentation state. */
	readonly aiMetadata?: {
		readonly generate: (
			request: AiTabMetadataGenerateRequest,
		) => Promise<AiTabMetadataGenerateResult>;
	};
	/** Privileged sparse writer. The authority verifies its project binding
	 * before delegating the bounded atomic replacement implementation. */
	readonly saveSparseFile?: (
		request: FileViewerSparseFileSaveRequest,
	) => Promise<unknown>;
}

interface AuthoritySession {
	readonly id: string;
	readonly projectId: string;
	readonly shellPath: string | null;
}

/**
 * Privileged bridge for the embedded Local server's terminal service.
 *
 * This class intentionally has no BrowserWindow/webContents ownership model.
 * Renderer ids are only keys for detachable event subscriptions, so closing a
 * window cannot kill a PTY. The compatibility event shape is kept here while
 * the UI finishes moving to TerminayClient's framed terminal protocol.
 */
export class ServerTerminalAuthority {
	readonly service: TerminalService;
	readonly composition: ServerCoreComposition;
	/** Canonical Local activity authority exposed through the same protocol as
	 * terminal streams; legacy renderer IPC is not its source of truth. */
	readonly activity: TerminalActivityService;
	/** The only hook/status authority for server-owned terminals. */
	readonly agents: AgentStatusService;
	/** Canonical workspace authority used by the server project operations. */
	readonly workspace: WorkspaceStore;
	/** Server-owned Git authority shared by embedded Desktop and remote hosts. */
	readonly git: GitService;

	private readonly options: ServerTerminalAuthorityOptions;
	private readonly sessions = new Map<string, AuthoritySession>();
	private readonly consumers: DetachableTerminalConsumerRegistry;
	private readonly buffers = new Map<string, Uint8Array>();
	private readonly listeners = new Set<(event: TerminalEvent) => void>();
	private readonly maxReplayBytes: number;
	private readonly fileCatalogProjects = new Map<
		string,
		FileCatalogProjectContext
	>();
	private readonly fileContentProjects = new Map<
		string,
		FileContentProjectContext
	>();
	private readonly fileSessionProjects = new Map<string, FileProjectContext>();
	private readonly fileProjectRoots = new Map<string, string>();
	private serviceEventsUnsubscribe: Unsubscribe | undefined;
	private shuttingDown = false;
	private shutdownPromise: Promise<void> | undefined;

	constructor(options: ServerTerminalAuthorityOptions) {
		if (
			!options ||
			typeof options.serverId !== 'string' ||
			options.serverId.length === 0
		) {
			throw new TypeError('serverId is required');
		}
		this.options = options;
		this.workspace = new WorkspaceStore(
			createInitialWorkspace(options.serverId),
		);
		this.activity = new TerminalActivityService({ serverId: options.serverId });
		this.agents = new AgentStatusService({ activity: this.activity });
		this.git = new GitService({
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
		const gitAdapter = new ServerGitAdapter({
			serverId: options.serverId,
			git: this.git,
			resolveProjectRoot: (projectId) =>
				this.workspace.state.projects[projectId]?.root ?? null,
		});
		const fileCatalogAdapter = new ServerFileCatalogAdapter({
			serverId: options.serverId,
			projects: this.fileCatalogProjects,
		});
		const fileContentAdapter = new ServerFileContentAdapter({
			serverId: options.serverId,
			projects: this.fileContentProjects,
		});
		const fileSessionAdapter = new ServerFileAdapter({
			serverId: options.serverId,
			projects: this.fileSessionProjects,
		});
		const eventJournal = new OrderedEventJournal();
		const fileObservations = new ServerFileObservationAdapter({
			serverId: options.serverId,
			eventJournal,
			host: {
				watch: async ({ projectId, resource, signal, publish }) => {
					const root = this.fileProjectRoots.get(projectId);
					if (root === undefined)
						throw new Error('file observation project is unavailable');
					const target = resolve(root, resource);
					const targetStats = await stat(target);
					const watchedDirectory = targetStats.isDirectory()
						? target
						: dirname(target);
					const watchedName = targetStats.isDirectory()
						? null
						: basename(target);
					const watcher = watchFileSystem(
						watchedDirectory,
						{ persistent: false },
						(eventType, entryName) => {
							if (
								watchedName !== null &&
								entryName !== null &&
								String(entryName) !== watchedName
							)
								return;
							publish({
								resource,
								kind: eventType === 'rename' ? 'renamed' : 'changed',
								...(entryName === null
									? {}
									: { relatedResource: String(entryName) }),
							});
						},
					);
					let unavailablePublished = false;
					const publishUnavailable = () => {
						if (signal.aborted || unavailablePublished) return;
						unavailablePublished = true;
						publish({ resource, kind: 'unavailable' });
					};
					watcher.once('error', publishUnavailable);
					watcher.once('close', publishUnavailable);
					signal.addEventListener('abort', () => watcher.close(), {
						once: true,
					});
				},
				calculateFolderSize: async ({
					projectId,
					resource,
					signal,
					progress,
				}) => {
					const root = this.fileProjectRoots.get(projectId);
					if (root === undefined)
						throw new Error('folder-size project is unavailable');
					let bytes = 0;
					let files = 0;
					let directories = 0;
					const visit = async (directory: string): Promise<void> => {
						if (signal.aborted) throw signal.reason;
						directories += 1;
						for (const entry of await readdir(directory, {
							withFileTypes: true,
						})) {
							if (signal.aborted) throw signal.reason;
							const path = resolve(directory, entry.name);
							if (entry.isDirectory()) await visit(path);
							else if (entry.isFile()) {
								files += 1;
								bytes += (await stat(path)).size;
							}
							progress({ bytes, files, directories });
						}
					};
					await visit(resolve(root, resource));
					return { bytes, files, directories };
				},
			},
		});
		const fileCatalogOperations = fileCatalogAdapter.operations();
		const fileContentOperations = fileContentAdapter.operations();
		const fileSessionOperations = fileSessionAdapter.operations();
		this.maxReplayBytes = options.maxReplayBytes ?? 1024 * 1024;
		if (
			!Number.isSafeInteger(this.maxReplayBytes) ||
			this.maxReplayBytes <= 0
		) {
			throw new RangeError('maxReplayBytes must be a positive safe integer');
		}
		this.composition = createServerCoreComposition({
			serverId: options.serverId,
			serverVersion: 'desktop-local',
			capabilities: ['terminal', 'workspace', 'files', 'agents', 'git'],
			authenticate: ({ hello }) => ({
				clientId: hello.clientId,
				authScope: 'admin',
			}),
			workspace: this.workspace,
			workspaceOperations: {
				prepareProjectRootUpdate: (projectId, root) =>
					this.prepareProjectRootUpdate(projectId, root),
			},
			activity: this.activity,
			agents: this.agents,
			git: gitAdapter,
			eventJournal,
			fileObservations,
			...(options.recordings === undefined
				? {}
				: { recordings: options.recordings }),
			...(options.settings === undefined ? {} : { settings: options.settings }),
			operations: {
				queries: {
					...fileSessionOperations.queries,
					...fileCatalogOperations.queries,
					...fileContentOperations.queries,
					'file.get-git-diff': (request: QueryRequest) =>
						this.getFileDiff(request),
					'file.mutation-revision': (request: QueryRequest) =>
						this.getFileMutationRevision(request),
				},
				commands: {
					...fileSessionOperations.commands,
					...fileCatalogOperations.commands,
					...fileContentOperations.commands,
					...(options.aiMetadata === undefined
						? {}
						: {
								'ai.metadata.generate': (request: CommandRequest) =>
									this.generateAiMetadata(request),
							}),
					...(options.saveSparseFile === undefined
						? {}
						: {
								'file.save-sparse': (request: CommandRequest) =>
									this.saveSparseFile(request),
							}),
				},
			},
			...(options.terminalService === undefined
				? {
						// Do not load the native module for an injected service. Apart
						// from making the boundary testable, this prevents an unused
						// native dependency from becoming part of host-only compositions.
						ptyFactory: createNodePtyFactory(
							require('node-pty') as NodePtyModule,
							{ resolveCwd: resolveTerminalProcessCwd },
						),
						terminalOptions: {
							maxReplayBytes: this.maxReplayBytes,
						},
						...(options.macros === undefined ? {} : { macros: options.macros }),
					}
				: { terminalService: options.terminalService }),
		});
		this.service = this.composition.terminal;
		// Observe the final composed service in both production and injected-test
		// modes. Host recording/remote cleanup must not depend on who constructed
		// the service.
		this.serviceEventsUnsubscribe = this.service.onEvent((event) =>
			this.handleEvent(event),
		);
		this.consumers = new DetachableTerminalConsumerRegistry(this.service);
	}

	private async getFileDiff(
		request: QueryRequest,
	): Promise<BinaryQueryHandlerResult> {
		const payload = protocolPayload(request.envelope.payload);
		const requestedPath = protocolString(payload.path, 'file path');
		const projectId = protocolString(payload.projectId, 'project id');
		const context = this.fileSessionProjects.get(projectId);
		const root = this.fileProjectRoots.get(projectId);
		if (context === undefined || root === undefined)
			throw new Error('file diff project is unavailable');
		const canonicalPath = isAbsolute(requestedPath)
			? await realpath(requestedPath)
			: await context.resolver.resolve(requestedPath, { requireFile: true });
		const project = this.projectForPath(canonicalPath);
		if (project.projectId !== projectId)
			throw new Error('file diff target is outside the connected project');
		const relativePath = relative(project.root, canonicalPath);
		const result = await this.git.diff(
			{ projectId: project.projectId, path: relativePath },
			request.context.signal,
		);
		writePortDiagnostic({
			phase: 'file-diff-result',
			path: relativePath,
			state: result.state,
			bounded: result.bounded,
			hunks: result.hunks.length,
		});
		const value = {
			compareTarget: 'HEAD',
			gitAvailable: result.state !== 'git-unavailable',
			hasDiff: result.patch.trim().length > 0,
			hunks: result.hunks,
			isBinary: result.binary,
			// A bounded diff is still evidence that Git discovered and tracked the
			// target. Keep Diff available so the client can render its explicit
			// too-large state instead of presenting the file as untracked.
			isTracked:
				result.state === 'ready' || result.state === 'command-error',
			path: canonicalPath,
			relativePath,
			repoRoot: project.root,
			tooLarge: result.bounded,
		} as unknown as JsonValue;
		return {
			result: { encoding: 'json' },
			body: new TextEncoder().encode(JSON.stringify(value)),
		};
	}

	private async getFileMutationRevision(
		request: QueryRequest,
	): Promise<JsonValue> {
		const payload = protocolPayload(request.envelope.payload);
		const projectId = protocolString(payload.projectId, 'project id');
		const path = protocolString(payload.path, 'file path');
		const context = this.fileSessionProjects.get(projectId);
		if (context === undefined)
			throw new Error('file mutation project is unavailable');
		const canonicalPath = await context.resolver.resolve(path, {
			requireFile: true,
		});
		const value = await stat(canonicalPath);
		return { ino: value.ino, mtimeMs: value.mtimeMs, size: value.size };
	}

	private async generateAiMetadata(
		request: CommandRequest,
	): Promise<JsonValue> {
		const service = this.options.aiMetadata;
		if (service === undefined)
			throw new Error('AI metadata provider is unavailable');
		const payload = protocolPayload(request.envelope.payload);
		const target = protocolPayload(payload.target);
		const serverId = protocolString(target.serverId, 'target server id');
		const projectId = protocolString(target.projectId, 'target project id');
		const panelId = protocolString(target.panelId, 'target panel id');
		const sessionId = protocolString(target.sessionId, 'target session id');
		if (serverId !== this.options.serverId)
			throw new Error('AI target belongs to another server');
		const project = this.workspace.state.projects[projectId];
		const panel = this.workspace.state.panels[panelId];
		if (
			project === undefined ||
			panel?.type !== 'terminal' ||
			panel.projectId !== projectId ||
			panel.sessionId !== sessionId
		)
			throw new Error('AI terminal target is unavailable');
		const targetType = payload.targetType;
		if (targetType !== 'title' && targetType !== 'note')
			throw new TypeError('AI metadata target type is invalid');
		const provider = payload.provider;
		if (provider !== 'codex' && provider !== 'claude-code')
			throw new TypeError('AI metadata provider is invalid');
		const model = protocolString(payload.model, 'AI model');
		const recentOutput = new TextDecoder().decode(
			this.buffers.get(sessionId) ?? new Uint8Array(),
		);
		const result = await service.generate({
			context: {
				currentTitle: panel.title ?? 'Terminal',
				existingNote: '',
				projectRoot: project.root,
				projectTitle: project.name,
				recentOutput,
				sessionId,
			},
			model,
			provider: provider === 'claude-code' ? 'claudeCode' : 'codex',
			target: targetType,
		});
		return { text: result.text };
	}

	private async saveSparseFile(request: CommandRequest): Promise<JsonValue> {
		const save = this.options.saveSparseFile;
		if (save === undefined) throw new Error('sparse file saving is unavailable');
		const payload = protocolPayload(request.envelope.payload);
		const path = protocolString(payload.path, 'file path');
		const projectRoot = protocolString(payload.projectRoot, 'project root');
		const canonicalRoot = await realpath(projectRoot);
		const project = this.projectForPath(await realpath(path));
		if (project.root !== canonicalRoot)
			throw new Error('sparse file target is outside the connected project');
		await save(payload as unknown as FileViewerSparseFileSaveRequest);
		return null;
	}

	private projectForPath(path: string): { projectId: string; root: string } {
		for (const [projectId, root] of this.fileProjectRoots) {
			if (path === root || path.startsWith(`${root}${sep}`))
				return { projectId, root };
		}
		throw new Error('file path is outside the connected workspace');
	}

	/** Register a workspace project's root with the server-owned catalog before
	 * the first PTY for that project becomes visible.  This is host-to-server
	 * composition, not a renderer capability: the renderer may request file
	 * operations only after the authenticated server has established the
	 * project/root binding. */
	private async registerProjectRoot(
		projectId: string,
		root: string,
	): Promise<void> {
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId))
			throw new TypeError('project id is invalid');
		if (
			typeof root !== 'string' ||
			root.length === 0 ||
			root.length > 4096 ||
			root.includes('\0')
		)
			throw new TypeError('project root is invalid');
		const resolver = new CanonicalProjectPathResolver(
			root,
			nodeFileCatalogStorage,
		);
		await resolver.root();
		this.fileCatalogProjects.set(projectId, {
			projectId,
			catalog: new FileCatalog(resolver, nodeFileCatalogStorage),
		});
		this.fileSessionProjects.set(projectId, {
			projectId,
			resolver,
			storage: nodeFileCatalogStorage,
		});
		this.fileProjectRoots.set(projectId, await resolver.root());
		this.fileContentProjects.set(projectId, {
			projectId,
			content: new FileContentStreamService(resolver, nodeFileCatalogStorage),
		});
		await this.git.bindProject(projectId, root);
	}

	private async prepareProjectRootUpdate(projectId: string, root: string) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId))
			throw new TypeError('project id is invalid');
		if (
			typeof root !== 'string' ||
			root.length === 0 ||
			root.length > 4096 ||
			root.includes('\0')
		)
			throw new TypeError('project root is invalid');
		const resolver = new CanonicalProjectPathResolver(
			root,
			nodeFileCatalogStorage,
		);
		const canonicalRoot = await resolver.root();
		const context = {
			projectId,
			catalog: new FileCatalog(resolver, nodeFileCatalogStorage),
		};
		const contentContext = {
			projectId,
			content: new FileContentStreamService(resolver, nodeFileCatalogStorage),
		};
		const sessionContext = {
			projectId,
			resolver,
			storage: nodeFileCatalogStorage,
		};
		return Object.freeze({
			canonicalRoot,
			commit: async () => {
				this.fileProjectRoots.set(projectId, canonicalRoot);
				this.fileCatalogProjects.set(projectId, context);
				this.fileContentProjects.set(projectId, contentContext);
				this.fileSessionProjects.set(projectId, sessionContext);
				await this.git.bindProject(projectId, canonicalRoot);
			},
		});
	}

	onEvent(listener: (event: TerminalEvent) => void): Unsubscribe {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Bind one private, fixed-server MessagePort to the server protocol. */
	acceptRendererPort(port: ServerMessagePort): void {
		mainServerPortDiagnostics.acceptedPorts += 1;
		writePortDiagnostic({
			phase: 'renderer-port-accepted',
			acceptedPorts: mainServerPortDiagnostics.acceptedPorts,
			serverId: this.service.serverId,
		});
		const scopedPort = new ServerScopedMessagePort(
			adaptElectronMessagePort(port),
			this.service.serverId,
		);
		const transport = new ServerPortTransport(scopedPort);
		const connection = this.composition.core.accept(transport);
		void connection.start().catch((error) => {
			mainServerPortDiagnostics.lastError =
				error instanceof Error ? error.message : String(error);
			if (
				this.shuttingDown ||
				(error instanceof Error && error.message === 'server port closed')
			)
				return;
			console.error('[server] renderer connection failed', error);
		});
	}

	async create(
		options: Omit<TerminalCreateOptions, 'serverId'> & {
			readonly projectId: string;
		},
	): Promise<ServerTerminalAuthoritySession> {
		await this.composition.start();
		this.ensureWorkspaceProject(options.projectId, options.cwd);
		const project = this.workspace.state.projects[options.projectId];
		if (project === undefined)
			throw new Error('workspace project was not created');
		await this.registerProjectRoot(options.projectId, project.root);
		const requestedId = options.sessionId;
		if (requestedId !== undefined)
			this.buffers.set(requestedId, new Uint8Array());
		const handle = await this.service.createSession(options);
		const session: AuthoritySession = {
			id: handle.sessionId,
			projectId: handle.projectId,
			shellPath: options.shellPath ?? null,
		};
		this.sessions.set(handle.sessionId, session);
		if (!this.buffers.has(handle.sessionId))
			this.buffers.set(handle.sessionId, new Uint8Array());
		if (this.workspace.state.terminalSessions[handle.sessionId] === undefined) {
			const registered = this.composition.workspaceOperations?.applyHostCommand(
				`authority:terminal:${handle.sessionId}`.slice(0, 128),
				{
					type: 'terminal.createPanel',
					sessionId: handle.sessionId,
					projectId: handle.projectId,
					panelId: `p:${handle.sessionId}`.slice(0, 128),
					title: this.nextTerminalPanelTitle(handle.projectId),
					cwd: handle.snapshot().cwd,
					createdAt: handle.snapshot().createdAt,
				},
				this.workspace.state.revision,
			);
			if (registered === undefined)
				throw new Error('workspace operation registry is unavailable');
			if (!registered.ok) {
				await this.service.kill(handle.snapshot()).catch(() => undefined);
				this.sessions.delete(handle.sessionId);
				this.buffers.delete(handle.sessionId);
				throw new Error(registered.conflict.message);
			}
		}
		const snapshot = this.snapshot(handle.sessionId);
		if (snapshot === undefined)
			throw new Error(
				`Terminal session disappeared during creation: ${handle.sessionId}`,
		);
		return snapshot;
	}

	private nextTerminalPanelTitle(projectId: string): string {
		const count = Object.values(this.workspace.state.panels).filter(
			(panel) => panel.projectId === projectId && panel.type === 'terminal',
		).length;
		return `Terminal ${count + 1}`;
	}

	get(id: string): ServerTerminalAuthoritySession | undefined {
		return this.snapshot(id);
	}

	async currentCwd(id: string) {
		const session = this.knownSession(id);
		if (session === undefined) return null;
		return this.service.currentCwd({
			serverId: this.service.serverId,
			projectId: session.projectId,
			sessionId: id,
		});
	}

	/** Exact server identity for host compatibility adapters. Callers may use
	 * this only to route a bounded action back into the server-owned service. */
	agentIdentity(id: string): ActivitySessionIdentity | undefined {
		const session = this.knownSession(id);
		return session === undefined
			? undefined
			: Object.freeze({
					serverId: this.service.serverId,
					projectId: session.projectId,
					sessionId: session.id,
				});
	}

	/** Narrow compatibility adapter for preload IPC. It delegates every read
	 * and acknowledgement to the composed server authority; it owns no state. */
	agentStatusIpcAdapter(): AgentStatusIpcAuthority {
		return createServerAgentStatusIpcAdapter({
			agents: this.agents,
			agentIdentity: (id) => this.agentIdentity(id),
		});
	}

	getBuffer(id: string): string | null {
		const bytes = this.buffers.get(id);
		return bytes === undefined ? null : new TextDecoder().decode(bytes);
	}

	getCwd(id: string): string | null {
		return this.knownSession(id) === undefined
			? null
			: (this.service.getSession(id)?.cwd ?? null);
	}

	list(): readonly ServerTerminalAuthoritySession[] {
		return this.service.listSessions().flatMap(({ sessionId }) => {
			this.knownSession(sessionId);
			const value = this.snapshot(sessionId);
			return value === undefined ? [] : [value];
		});
	}

	async write(
		id: string,
		data: string | Uint8Array,
		authorization?: TerminalAuthorization,
	): Promise<void> {
		const session = this.requireSession(id);
		await this.service.input(id, data, authorization);
		this.notifyAcceptedWrite({
			serverId: this.service.serverId,
			projectId: session.projectId,
			sessionId: session.id,
			data: typeof data === 'string' ? data : new Uint8Array(data),
		});
	}

	async resize(
		id: string,
		dimensions: TerminalDimensions,
		authorization?: TerminalAuthorization,
	): Promise<void> {
		const session = this.requireSession(id);
		await this.service.resize(id, dimensions, authorization);
		const accepted = this.service.getSession(id)?.dimensions;
		if (accepted === undefined) return;
		this.notifyAcceptedResize({
			serverId: this.service.serverId,
			projectId: session.projectId,
			sessionId: session.id,
			cols: accepted.cols,
			rows: accepted.rows,
		});
	}

	/** Wait on the authoritative PTY output boundary. This is deliberately not
	 * a renderer timer: output resets the quiet window and terminal exit wakes
	 * every waiter through TerminalService. */
	async waitForInactivity(
		id: string,
		durationMs: number,
		authorization?: TerminalAuthorization,
	): Promise<void> {
		this.requireSession(id);
		await this.service.waitForInactivity(id, durationMs, { authorization });
	}

	async kill(id: string, authorization?: TerminalAuthorization): Promise<void> {
		await this.service.kill(id, authorization);
	}

	/** Attach one detachable client subscription. Re-attaching replaces only
	 * that consumer's old stream and never changes PTY ownership. */
	attachConsumer(
		id: string,
		consumerId: string,
		listener: (event: ServerTerminalRendererEvent) => void,
		fromPosition = 0,
	): Unsubscribe {
		const session = this.requireSession(id);
		const identity = {
			serverId: this.service.serverId,
			projectId: session.projectId,
			sessionId: id,
		};
		let subscription: TerminalSubscription;
		try {
			subscription = this.consumers.attach(identity, consumerId, {
				fromPosition,
				onEvent: (event) => listener(toRendererEvent(event)),
			});
		} catch (error) {
			// A stale cursor is recoverable: attach from the earliest retained
			// position rather than making a reload destroy an otherwise healthy PTY.
			const snapshot = this.service.getSession(id);
			if (snapshot === undefined || fromPosition <= snapshot.replayFrom)
				throw error;
			subscription = this.consumers.attach(identity, consumerId, {
				fromPosition: snapshot.replayFrom,
				onEvent: (event) => listener(toRendererEvent(event)),
			});
		}
		return () => {
			this.consumers.detach(identity, consumerId, subscription);
		};
	}

	detachConsumer(id: string, consumerId: string): void {
		const session = this.knownSession(id);
		if (session === undefined) return;
		this.consumers.detach(
			{
				serverId: this.service.serverId,
				projectId: session.projectId,
				sessionId: id,
			},
			consumerId,
		);
	}

	isConsumerAttached(id: string, consumerId: string): boolean {
		const session = this.knownSession(id);
		return (
			session !== undefined &&
			this.consumers.isAttached(
				{
					serverId: this.service.serverId,
					projectId: session.projectId,
					sessionId: id,
				},
				consumerId,
			)
		);
	}

	detachConsumers(consumerId: string): void {
		this.consumers.detachConsumer(consumerId);
	}

	/** Temporary compatibility aliases for the legacy IPC caller. The numeric
	 * value is only encoded as a subscription token; it is never PTY authority. */
	attachRenderer(
		id: string,
		rendererId: number,
		listener: (event: ServerTerminalRendererEvent) => void,
		fromPosition = 0,
	): Unsubscribe {
		return this.attachConsumer(
			id,
			legacyConsumerId(rendererId),
			listener,
			fromPosition,
		);
	}

	detachRenderer(id: string, rendererId: number): void {
		this.detachConsumer(id, legacyConsumerId(rendererId));
	}

	/**
	 * Move the legacy renderer stream for an already-attached terminal without
	 * changing terminal ownership. This is intentionally a single authority
	 * operation: a popout/merge must not detach the previous renderer until the
	 * destination stream has been created successfully.
	 *
	 * The destination receives a replay from the requested cursor, so a newly
	 * mounted terminal can reconstruct output that arrived while its UI loaded.
	 */
	handoffRenderer(
		id: string,
		fromRendererId: number,
		toRendererId: number,
		listener: (event: ServerTerminalRendererEvent) => void,
		fromPosition = 0,
	): Unsubscribe {
		this.requireSession(id);
		if (!this.isRendererAttached(id, fromRendererId)) {
			throw new Error('source renderer is not attached to this terminal');
		}
		if (fromRendererId === toRendererId) {
			throw new TypeError('renderer handoff requires a different destination');
		}
		// Attach first. If replay/cursor validation fails, the source remains
		// attached and can continue to render the still-running server PTY.
		const detachDestination = this.attachRenderer(
			id,
			toRendererId,
			listener,
			fromPosition,
		);
		this.detachRenderer(id, fromRendererId);
		return detachDestination;
	}

	isRendererAttached(id: string, rendererId: number): boolean {
		return this.isConsumerAttached(id, legacyConsumerId(rendererId));
	}

	detachRendererAll(rendererId: number): void {
		this.detachConsumers(legacyConsumerId(rendererId));
	}

	async shutdown(): Promise<void> {
		if (this.shutdownPromise !== undefined) return this.shutdownPromise;
		this.shuttingDown = true;
		this.consumers.clear();
		this.shutdownPromise = this.composition.shutdown().finally(() => {
			this.serviceEventsUnsubscribe?.();
			this.serviceEventsUnsubscribe = undefined;
		});
		return this.shutdownPromise;
	}

	private handleEvent(event: TerminalEvent): void {
		if (event.type === 'output') {
			const previous = this.buffers.get(event.sessionId) ?? new Uint8Array();
			const next = new Uint8Array(previous.byteLength + event.bytes.byteLength);
			next.set(previous);
			next.set(event.bytes, previous.byteLength);
			this.buffers.set(
				event.sessionId,
				next.byteLength > this.maxReplayBytes
					? next.slice(next.byteLength - this.maxReplayBytes)
					: next,
			);
		}
		if (event.type === 'exit') {
			// Keep the bounded buffer and session snapshot available for clients
			// reopening a project after the shell has exited.
		}
		this.options.onEvent?.(event);
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				/* observers cannot affect PTY supervision */
			}
		}
	}

	private notifyAcceptedWrite(event: ServerTerminalAcceptedWrite): void {
		try {
			void Promise.resolve(this.options.onAcceptedWrite?.(event)).catch(
				() => {},
			);
		} catch {
			/* host bookkeeping cannot turn an accepted server write into a failure */
		}
	}

	private notifyAcceptedResize(event: ServerTerminalAcceptedResize): void {
		try {
			void Promise.resolve(this.options.onAcceptedResize?.(event)).catch(
				() => {},
			);
		} catch {
			/* host bookkeeping cannot turn an accepted server resize into a failure */
		}
	}

	private snapshot(id: string): ServerTerminalAuthoritySession | undefined {
		const session = this.knownSession(id);
		if (session === undefined) return undefined;
		const snapshot = this.service.getSession(id);
		if (snapshot === undefined) return undefined;
		return Object.freeze({
			id,
			serverId: snapshot.serverId,
			projectId: session.projectId,
			cwd: snapshot.cwd,
			shellPath: session.shellPath,
			pid: snapshot.pid,
			status: snapshot.status,
		});
	}

	private requireSession(id: string): AuthoritySession {
		const session = this.knownSession(id);
		if (session === undefined)
			throw new Error(`Unknown terminal session: ${id}`);
		return session;
	}

	/** Sessions opened through the authenticated server MessagePort bypass the
	 * Desktop compatibility creator. Adopt their immutable server identity on
	 * first host lookup so test/MCP/recording integrations never assume a
	 * renderer-created session is absent. PTY ownership remains in
	 * TerminalService; this map only holds host metadata. */
	private knownSession(id: string): AuthoritySession | undefined {
		const existing = this.sessions.get(id);
		if (existing !== undefined) return existing;
		const snapshot = this.service.getSession(id);
		if (snapshot === undefined) return undefined;
		const adopted: AuthoritySession = {
			id: snapshot.sessionId,
			projectId: snapshot.projectId,
			shellPath: null,
		};
		this.sessions.set(id, adopted);
		return adopted;
	}

	private ensureWorkspaceProject(
		projectId: string,
		cwd: string | undefined,
	): void {
		if (this.workspace.state.projects[projectId] !== undefined) return;
		const viewId = this.workspace.state.viewOrder[0];
		if (viewId === undefined) throw new Error('workspace has no default view');
		const result = this.workspace.apply({
			commandId: `authority:project:${projectId}`.slice(0, 128),
			expectedRevision: this.workspace.state.revision,
			command: {
				type: 'project.create',
				projectId,
				viewId,
				root: cwd ?? '.',
				name: projectId === 'default' ? 'Project' : projectId,
			},
		});
		if (!result.ok) throw new Error(result.conflict.message);
	}
}

/** Electron's main-process MessagePortMain is EventEmitter-based, unlike the
 * DOM MessagePort available in preload/renderer. Normalize it at the one
 * privileged boundary before sharing the transport implementation. */
function adaptElectronMessagePort(port: ServerMessagePort): ServerMessagePort {
	const candidate = port as ServerMessagePort & {
		on?: (
			event: 'message' | 'messageerror' | 'close',
			listener: (event: { readonly data: unknown }) => void,
		) => void;
	};
	if (typeof candidate.on !== 'function') return port;
	let onmessage: ((event: { readonly data: unknown }) => void) | null = null;
	let onmessageerror: (() => void) | null = null;
	let onclose: (() => void) | null = null;
	let receivedThisTurn = 0;
	let resetScheduled = false;
	let lastFrameHash: string | undefined;
	let identicalFrames = 0;
	candidate.on('message', (event) => {
		receivedThisTurn += 1;
		if (!resetScheduled) {
			resetScheduled = true;
			setImmediate(() => {
				receivedThisTurn = 0;
				resetScheduled = false;
			});
		}
		const hash = diagnosticFrameHash(event.data);
		identicalFrames = hash !== undefined && hash === lastFrameHash
			? identicalFrames + 1
			: 1;
		lastFrameHash = hash;
		if (
			receivedThisTurn > MAIN_PORT_PER_TURN_LIMIT ||
			identicalFrames > MAIN_PORT_IDENTICAL_FRAME_LIMIT
		) {
			const reason =
				receivedThisTurn > MAIN_PORT_PER_TURN_LIMIT
					? 'per-turn frame budget exceeded'
					: 'repeated identical frame budget exceeded';
			mainServerPortDiagnostics.lastError = reason;
			writePortDiagnostic({
				phase: 'connection-closed',
				reason,
				receivedThisTurn,
				identicalFrames,
			});
			candidate.close?.();
			onmessageerror?.();
			return;
		}
		mainServerPortDiagnostics.receivedFrames += 1;
		recordDiagnosticEnvelope(event.data, 'received');
		onmessage?.(event);
	});
	candidate.on('messageerror', () => {
		mainServerPortDiagnostics.lastError = 'MessagePortMain messageerror';
		onmessageerror?.();
	});
	candidate.on('close', () => onclose?.());
	return {
		get onmessage() {
			return onmessage;
		},
		set onmessage(listener) {
			onmessage = listener;
		},
		get onmessageerror() {
			return onmessageerror;
		},
		set onmessageerror(listener) {
			onmessageerror = listener;
		},
		get onclose() {
			return onclose;
		},
		set onclose(listener) {
			onclose = listener;
		},
		postMessage: (message) => {
			mainServerPortDiagnostics.sentFrames += 1;
			recordDiagnosticEnvelope(message, 'sent');
			candidate.postMessage(message);
		},
		start: () => candidate.start?.(),
		close: () => candidate.close?.(),
	};
}

function recordDiagnosticEnvelope(
	packet: unknown,
	direction: 'received' | 'sent',
): void {
	try {
		if (typeof packet !== 'object' || packet === null) return;
		const frame = (packet as { frame?: unknown }).frame;
		if (!(frame instanceof Uint8Array)) return;
		const envelope = decodeFrame(frame).envelope;
		if (direction === 'received')
			mainServerPortDiagnostics.lastReceivedType = envelope.type;
		else mainServerPortDiagnostics.lastSentType = envelope.type;
		if (
			(envelope.type === 'command' || envelope.type === 'query') &&
			typeof envelope.operation === 'string'
		)
			mainServerPortDiagnostics.lastOperation = envelope.operation;
		const count =
			direction === 'received'
				? mainServerPortDiagnostics.receivedFrames
				: mainServerPortDiagnostics.sentFrames;
		const operation =
			(envelope.type === 'command' || envelope.type === 'query') &&
			typeof envelope.operation === 'string'
				? envelope.operation
				: undefined;
		if (process.env.TERMINAY_TEST === '1' && count <= MAIN_PORT_DIAGNOSTIC_LOG_LIMIT) {
			console.error(
				`[terminay-port-diagnostic] ${JSON.stringify({
					direction,
					count,
					type: envelope.type,
					...(operation === undefined ? {} : { operation }),
				})}`,
			);
		}
		if (count <= MAIN_PORT_FILE_DIAGNOSTIC_LOG_LIMIT) {
			writePortDiagnostic({
				phase: 'frame',
				direction,
				count,
				type: envelope.type,
				...(operation === undefined ? {} : { operation }),
				...('correlationId' in envelope &&
				typeof envelope.correlationId === 'string'
					? { correlationId: envelope.correlationId }
					: {}),
			});
		}
	} catch (error) {
		mainServerPortDiagnostics.lastError =
			error instanceof Error ? error.message : String(error);
	}
}

function diagnosticFrameHash(packet: unknown): string | undefined {
	if (typeof packet !== 'object' || packet === null) return undefined;
	const frame = (packet as { frame?: unknown }).frame;
	if (!(frame instanceof Uint8Array)) return undefined;
	return createHash('sha256').update(frame).digest('hex');
}

function protocolPayload(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('protocol payload must be an object');
	return value as Record<string, unknown>;
}

function protocolString(value: unknown, label: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 4096 ||
		value.includes('\0')
	)
		throw new TypeError(`${label} is invalid`);
	return value;
}

const nodeFileCatalogStorage: FileCatalogStorage & FileSessionStorage = {
	realpath: (path) => realpath(path),
	stat: async (path) => toPathStat(await stat(path)),
	lstat: async (path) => toPathStat(await lstat(path)),
	readDirectory: async (path) =>
		(await readdir(path, { withFileTypes: true })).map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
			isFile: entry.isFile(),
			isSymbolicLink: entry.isSymbolicLink(),
		})),
	readRange: async (path, offset, length) => {
		const handle = await open(path, 'r');
		try {
			const bytes = new Uint8Array(length);
			const { bytesRead } = await handle.read(bytes, 0, length, offset);
			return bytes.slice(0, bytesRead);
		} finally {
			await handle.close();
		}
	},
	makeDirectory: async (path, signal) => {
		signal?.throwIfAborted();
		await mkdir(path);
		signal?.throwIfAborted();
	},
	rename: async (from, to, signal) => {
		signal?.throwIfAborted();
		await rename(from, to);
		signal?.throwIfAborted();
	},
	remove: async (path, options, signal) => {
		signal?.throwIfAborted();
		await rm(path, { recursive: options?.recursive === true });
		signal?.throwIfAborted();
	},
	atomicWrite: async (path, bytes, signal) => {
		signal?.throwIfAborted();
		const temporary = `${path}.terminay-${randomBytes(12).toString('hex')}`;
		try {
			await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
			signal?.throwIfAborted();
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true }).catch(() => undefined);
		}
		signal?.throwIfAborted();
	},
};

function toPathStat(value: {
	isDirectory(): boolean;
	isFile(): boolean;
	isSymbolicLink(): boolean;
	size: number;
	mtimeMs: number;
	mode: number;
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

function toRendererEvent(event: TerminalEvent): ServerTerminalRendererEvent {
	if (event.type === 'output') {
		return {
			type: 'output',
			id: event.sessionId,
			data: new TextDecoder().decode(event.bytes),
		};
	}
	if (event.type === 'exit') {
		return {
			type: 'exit',
			id: event.sessionId,
			exitCode: event.exitCode,
			signal: event.signal,
		};
	}
	return {
		type: 'resync_required',
		id: event.sessionId,
		fromPosition: event.fromPosition,
		replayFrom: event.replayFrom,
		outputPosition: event.outputPosition,
	};
}

function legacyConsumerId(rendererId: number): string {
	if (!Number.isSafeInteger(rendererId) || rendererId < 0)
		throw new TypeError('renderer id is invalid');
	return `legacy-renderer:${rendererId}`;
}
