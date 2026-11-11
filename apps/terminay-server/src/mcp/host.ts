/**
 * The Terminay MCP host (ADR-0108): the control endpoint, the capability store
 * and its saved digests, socket placement, every tool adapter, the permission
 * gate, and the connected-server gateway. Every server host composes this one
 * module, Desktop's embedded server and the standalone server alike; a host
 * supplies only host facts (its data root, where its socket may go, the
 * command that starts its MCP stdio entry, and how a terminal is opened).
 *
 * Two phases. Before the Server Core composition exists, the host hands out
 * what the composition needs (`terminalLaunchEnvironmentFor`, `agentChatMcp`,
 * `botTerminayMcp`, the install `serverCommand`, and the terminal exit and
 * re-home hooks). `bind(server)` then attaches the composed server, restores
 * saved capabilities, binds settings and the gateway, and starts the endpoint.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type JsonValue, protocolError } from '@terminay/protocol';
import {
	type AgentStatusService,
	AUTOMATION_SPACE_PROJECT_ID,
	type AutomationSubject,
	commandPasteInput,
	describeChatMcpCall,
	isAutomationSpace,
	loadSecretStateSync,
	mcpPrincipalCommandRequest,
	mcpPrincipalQueryRequest,
	nodeTerminalLaunchPathAuthority,
	RootFolderBrowser,
	SETTINGS_OPERATIONS,
	type ServerCoreComposition,
	SUBMIT_INPUT,
	TERMINAL_KEYS,
	type TerminalActivityService,
	type TerminalAuthorization,
	type TerminalService,
	type TerminalSessionRehome,
	terminalInputKey,
	type WorkspaceStore,
	writeFileDurablySync,
	writeSeparatedInput,
} from '@terminay/server-core';
import { createAppControlAdapter } from './appControlAdapter.js';
import { type AppControlAdapter } from './appControlTools.js';
import { createAppWindowControlAdapter } from './appWindowAdapter.js';
import { type AppWindowControlAdapter } from './appWindowTools.js';
import {
	type AutomationControlAdapter,
	automationControlError,
} from './automationTools.js';
import { createBotTerminayMcpHost } from './botTerminayMcp.js';
import { ConnectedServerGateway } from './connectedServers.js';
import {
	CONTROL_SOCKET_ENV,
	CONTROL_TOKEN_ENV,
	CONTROL_TOOL_OPERATIONS,
	ControlCapabilityStore,
	ControlEndpointError,
	type ControlOperation,
	type ControlRequestContext,
	createControlEndpoint,
	type LocalControlEndpoint,
} from './controlEndpoint.js';
import {
	type ControlSocketPlacement,
	type ControlSocketPlacementOptions,
	placeControlSocket,
	resolveControlSocketPlacement,
} from './controlSocketPlacement.js';
import {
	CONTROL_PERMISSION_GROUPS,
	type ControlPermissionGate,
	createTerminalControlAdapter,
	type TerminalControlAdapter,
} from './dispatcher.js';
import { createMacroControlAdapter } from './macroAdapter.js';
import { type MacroControlAdapter } from './macroTools.js';
import {
	createNotificationControlAdapter,
	describeNotificationRequest,
} from './notificationAdapter.js';
import { type NotificationControlAdapter } from './notificationTools.js';
import {
	createMcpPermissionGate,
	type McpApprovalDescription,
} from './permissionGate.js';
import {
	createSettingsControlAdapter,
	describeSettingsUpdate,
	planSettingsUpdate,
	settingsState,
} from './settingsAdapter.js';
import { type SettingsControlAdapter } from './settingsTools.js';
import { createTerminalMetadataAdapter } from './terminalMetadataAdapter.js';
import { createWorkflowControlAdapter } from './workflowAdapter.js';
import { type WorkflowControlAdapter } from './workflowTools.js';
import {
	assertAutomationSpaceCapacity,
	ProjectHandleCodec,
	reachOf,
	resolveOpenTerminalProject,
	WindowHandleCodec,
	workspaceProjectFields,
} from './workspaceReach.js';
import { createWorkspaceViewAdapter } from './workspaceViewAdapter.js';
import { type WorkspaceViewControlAdapter } from './workspaceViewTools.js';

/** The host-supplied command that starts the Terminay MCP stdio entry, the
 * same shape an install target writes into its client's configuration. */
export interface McpServerCommand {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

/** The file that keeps capability digests across a restart (ADR-0088). */
/**
 * The environment a server's terminals start from, without a control socket
 * or token the server process itself inherited. Those belong to whatever
 * started the server (a Terminay terminal, say), never to this server's
 * terminals: a terminal gets this server's capability or none.
 */
export function withoutInheritedControlEnvironment<
	T extends Record<string, string | undefined>,
>(env: T): T {
	const copy = { ...env };
	delete copy[CONTROL_SOCKET_ENV];
	delete copy[CONTROL_TOKEN_ENV];
	return copy;
}

export const MCP_CAPABILITY_FILE = 'mcp-capabilities.v1.json';

/** Capability digests saved for terminals kept across a restart. A corrupt
 * file is a credential store: it restores none. */
export function loadMcpCapabilityDigests(file: string): unknown[] | undefined {
	return loadSecretStateSync(file, 'mcp-capabilities', {
		validate: (value: unknown) => (Array.isArray(value) ? value : undefined),
	});
}

/** Digests only: nothing in this file can be presented to the endpoint. */
export function saveMcpCapabilityDigests(file: string, digests: unknown): void {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileDurablySync(file, JSON.stringify(digests), { mode: 0o600 });
}

/** One terminal as the MCP host sees it. */
export interface McpHostTerminal {
	readonly id: string;
	readonly serverId: string;
	readonly projectId: string;
	readonly cwd: string;
	readonly pid: number | undefined;
	readonly status: 'running' | 'exited' | 'interrupted';
}

/** What a host binds: the composed server and the services it composed it
 * from. */
export interface McpHostServer {
	readonly composition: ServerCoreComposition;
	readonly workspace: WorkspaceStore;
	readonly activity: TerminalActivityService;
	readonly agents: AgentStatusService;
	/** Whether terminals outlive this process (a session holder), so their
	 * capabilities are saved and restored. */
	readonly keepsTerminalsAcrossRestart: boolean;
	/** Write to a terminal as MCP does. Absent, input goes through the
	 * composition's terminal input sources. A host with its own bookkeeping
	 * for accepted writes supplies this. */
	readonly write?: (
		id: string,
		data: string | Uint8Array,
		authorization?: TerminalAuthorization,
	) => Promise<void>;
	/** End a terminal as MCP does. Absent, the terminal service kills it. */
	readonly kill?: (
		id: string,
		authorization?: TerminalAuthorization,
	) => Promise<void>;
}

/** The bound server, with the terminal service and listing the adapters read. */
interface McpBoundServer extends McpHostServer {
	readonly service: TerminalService;
	list(): readonly McpHostTerminal[];
	write(
		id: string,
		data: string | Uint8Array,
		authorization?: TerminalAuthorization,
	): Promise<void>;
	kill(id: string, authorization?: TerminalAuthorization): Promise<void>;
}

/** A terminal the MCP host asks its host to open, as `open_terminal`,
 * `split_terminal`, and `create_project` do. */
export type McpOpenTerminal = (
	projectId: string,
	cwd?: string,
	projectRootOrigin?: 'explicit' | 'server-default',
	activePanelId?: string,
	folderId?: string,
	profileId?: string,
) => Promise<McpHostTerminal>;

export interface McpHostOptions {
	/** The server's id, which handles are minted for. */
	readonly serverId: string;
	/** The server's data root: saved capabilities live here. */
	readonly dataRoot: string;
	/** Where the control socket may go (ADR-0054). */
	readonly placement: ControlSocketPlacementOptions;
	/** The command that starts this server's MCP stdio entry. */
	readonly serverCommand: () => McpServerCommand;
	/** This server's version, reported to connected MCP servers. */
	readonly clientVersion: string;
	/** The home directory the automation space starts in. */
	readonly homeDirectory: string;
	/** The server settings as stored when the host is made. MCP enablement is
	 * applied from them before anything can be minted. */
	readonly initialSettings: Record<string, unknown> | undefined;
	/** Subscribe to server settings changes. */
	readonly onSettingsChange: (
		listener: (settings: Record<string, unknown>) => void,
	) => () => void;
	/** Open a terminal the way this host opens one. */
	readonly openTerminal: McpOpenTerminal;
	/** How saved digests are read and written. Absent, the server's own state
	 * files are used. A host that reports state recovery itself (Desktop
	 * tells the user once about a reset credential store) supplies its own. */
	readonly capabilityDigests?: {
		readonly load: (file: string) => unknown[] | undefined;
		readonly save: (file: string, digests: unknown) => void;
	};
}

export interface McpHost {
	/** The capability store; Desktop's own terminal hooks read it. */
	readonly capabilities: ControlCapabilityStore;
	/** The gateway to the user's connected MCP servers. */
	readonly gateway: ConnectedServerGateway;
	/** What a terminal launch adds to its environment: the socket and a fresh
	 * capability, or nothing while MCP is disabled. */
	terminalLaunchEnvironmentFor(
		intent: {
			readonly identity: {
				readonly sessionId: string;
				readonly projectId: string;
			};
		},
		placement: Parameters<ControlCapabilityStore['mint']>[3],
	): Record<string, string> | undefined;
	/** The socket and token for a capability already minted. */
	terminalControlEnv(capability?: {
		readonly token: string;
	}): Record<string, string>;
	/** A chat's capability, minted where the socket lives (ADR-0068). */
	readonly agentChatMcp: {
		mint: ControlCapabilityStore['mintChat'];
		revoke: (chatId: string) => void;
		serverEntry: (token: string) => {
			command: string;
			args: string[];
			env: Record<string, string>;
		};
		notesCalls: true;
	};
	/** A bot execution's capability (ADR-0100). */
	readonly botTerminayMcp: ReturnType<typeof createBotTerminayMcpHost>;
	/** The command providers register to start this server's MCP. */
	serverCommand(): McpServerCommand;
	/** A terminal ended: its capability ends with it. */
	onTerminalExit(sessionId: string): void;
	/** A terminal failed to start: revoke what was minted for it. */
	revokeTerminal(sessionId: string): void;
	/** A terminal moved project (ADR-0074). */
	onTerminalRehomed(move: TerminalSessionRehome): void;
	/** Attach the composed server and start the endpoint. Rejects when the
	 * socket cannot be placed. */
	bind(server: McpHostServer): Promise<void>;
	/** Stop following saved digests, without revoking. A host that keeps its
	 * terminals calls this first on shutdown. */
	stopPersisting(): void;
	/** Remove the saved digests: the terminals they were for are ending. */
	forgetSaved(): void;
	/** Stop the endpoint and gateway, and revoke every capability. */
	stop(): Promise<void>;
}

const MCP_CAPABILITY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function createMcpHost(options: McpHostOptions): McpHost {
	const mcpCapabilities = new ControlCapabilityStore();
	const capabilityDigests = options.capabilityDigests ?? {
		load: loadMcpCapabilityDigests,
		save: saveMcpCapabilityDigests,
	};
	let boundServer: McpBoundServer | null = null;
	let mcpControlEndpoint: LocalControlEndpoint | null = null;
	let removeMcpSettingsObserver: (() => void) | undefined;
	let removeMcpApprovalRevocation: (() => void) | undefined;
	let removeMcpCapabilityPersistence: (() => void) | undefined;
	let removeMcpGatewayBindings: (() => void) | undefined;
	let removeTerminalExitObserver: (() => void) | undefined;
	let mcpCapabilityPruneTimer: ReturnType<typeof setInterval> | undefined;
	/** Terminay's client side of the user's connected MCP servers (ADR-0037). */
	const mcpGateway = new ConnectedServerGateway({
		projectRoot: (projectId) =>
			boundServer?.workspace.state.projects[projectId]?.root,
		clientVersion: options.clientVersion,
	});

	function definedEnv(
		env: Record<string, string | undefined>,
	): Record<string, string> {
		return Object.fromEntries(
			Object.entries(env).filter(
				(entry): entry is [string, string] => entry[1] !== undefined,
			),
		);
	}

	function getTerminalControlEnv(capability?: {
		readonly token: string;
	}): Record<string, string | undefined> {
		if (capability === undefined) return {};
		// A terminal can be launched before the endpoint is listening, so the
		// address is worked out here the same way the endpoint works it out. With
		// nowhere for the socket to go there is no address to give; startup reports
		// that when it reaches the endpoint.
		let placement: ControlSocketPlacement;
		try {
			placement = resolveMcpControlSocketPlacement();
		} catch {
			return {};
		}
		return {
			[CONTROL_SOCKET_ENV]: placement.path,
			[CONTROL_TOKEN_ENV]: capability.token,
		};
	}

	let mcpControlSocketPlacement: ControlSocketPlacement | null = null;

	/**
	 * Where the control socket is (ADR-0054): in the data directory when its path
	 * fits a Unix socket, and otherwise in a runtime directory named for the data
	 * directory, so the address is the same after a relaunch. Deciding it reads
	 * nothing from disk; whether a runtime directory may be used is checked when
	 * the endpoint starts.
	 */
	function resolveMcpControlSocketPlacement(): ControlSocketPlacement {
		mcpControlSocketPlacement ??= resolveControlSocketPlacement(
			options.placement,
		);
		return mcpControlSocketPlacement;
	}

	function getMcpCapabilityFilePath(): string {
		return join(options.dataRoot, MCP_CAPABILITY_FILE);
	}

	/** Digests only: nothing in this file can be presented to the endpoint. */
	function saveMcpCapabilities(): void {
		try {
			capabilityDigests.save(
				getMcpCapabilityFilePath(),
				mcpCapabilities.snapshot(),
			);
		} catch (error) {
			console.error('[mcp] saving terminal capabilities failed', error);
		}
	}

	function runningTerminalSessionIds(authority: McpBoundServer): Set<string> {
		return new Set(
			authority.service
				.listSessions()
				.filter((session) => session.status === 'running')
				.map((session) => session.sessionId),
		);
	}

	function restoreSavedMcpCapabilities(authority: McpBoundServer): void {
		// Digests are a credential store: a corrupt file restores none, and every
		// running terminal must be granted again (ADR-0088).
		let saved: unknown[] | undefined;
		try {
			saved = capabilityDigests.load(getMcpCapabilityFilePath());
		} catch {
			return;
		}
		if (saved === undefined) return;
		mcpCapabilities.restore(saved, runningTerminalSessionIds(authority));
	}

	function pruneMcpCapabilities(authority: McpBoundServer): void {
		try {
			mcpCapabilities.prune(runningTerminalSessionIds(authority));
		} catch (error) {
			console.error('[mcp] pruning terminal capabilities failed', error);
		}
	}

	function applyMcpSetting(settings: Record<string, unknown>): void {
		const candidate = settings.terminayMcp;
		const enabled =
			typeof candidate === 'object' &&
			candidate !== null &&
			typeof (candidate as { enabled?: unknown }).enabled === 'boolean'
				? (candidate as { enabled: boolean }).enabled
				: true;
		mcpCapabilities.setEnabled(enabled);
		// With MCP off no agent can reach a window it opened, and a window must not
		// go on calling the servers that were connected for agents.
		if (!enabled) {
			boundServer?.composition.appWindows?.endAll();
			mcpGateway.closeAll();
		}
	}

	async function startMcpControlEndpoint(): Promise<void> {
		if (mcpControlEndpoint !== null) return;
		// Throws when the socket has nowhere to go, or when the runtime directory
		// it would go in is not the user's own; startup then says so.
		const placement = await placeControlSocket(options.placement);
		const endpoint = createControlEndpoint({
			socketPath: placement.path,
			tightenParentDirectory: placement.location !== 'runtime-directory',
			capabilities: mcpCapabilities,
			dispatch: createTerminalControlAdapter({
				adapter: createMcpTerminalAdapter(),
				automations: createMcpAutomationAdapter(),
				appWindows: createMcpAppWindowAdapter(),
				notifications: createMcpNotificationAdapter(),
				workspaceView: createMcpWorkspaceViewAdapter(),
				appControl: createMcpAppControlAdapter(),
				settings: createMcpSettingsAdapter(),
				macros: createMcpMacroAdapter(),
				workflows: createMcpWorkflowAdapter(),
				takeModelContext: (context, maxBytes) =>
					boundServer?.composition.appWindows?.takeModelContext(
						context.terminalSessionId,
						maxBytes,
					) ?? [],
				permissions: createHostPermissionGate(),
			}),
			onError: (error) => console.error('[mcp] control endpoint failed', error),
		});
		mcpControlEndpoint = endpoint;
		try {
			await endpoint.start();
		} catch (error) {
			if (mcpControlEndpoint === endpoint) mcpControlEndpoint = null;
			throw error;
		}
	}

	async function stopMcpControlEndpoint(): Promise<void> {
		removeMcpSettingsObserver?.();
		removeMcpSettingsObserver = undefined;
		const endpoint = mcpControlEndpoint;
		mcpControlEndpoint = null;
		// With MCP off, or the server stopping, connected servers stop too.
		mcpGateway.closeAll();
		if (endpoint !== null) await endpoint.stop();
		else mcpCapabilities.revokeAll();
	}

	/**
	 * Keep the gateway's entries equal to the registry's, report its status back
	 * for Settings, and route an MCP App view's own requests to the server that
	 * supplied the view, behind the Connected Server Tools policy.
	 */
	function bindMcpGateway(authority: McpBoundServer): void {
		removeMcpGatewayBindings?.();
		const { connectedServers, appWindows, mcpApprovals } =
			authority.composition;
		if (connectedServers === undefined) return;
		// Resolving reads the vault, so two saves in quick succession can finish out
		// of order. Only the latest one is applied.
		let syncs = 0;
		const sync = (): void => {
			syncs += 1;
			const current = syncs;
			void connectedServers
				.resolved()
				.then((entries) => {
					if (current === syncs) mcpGateway.setEntries(entries);
				})
				.catch((error) =>
					console.error('[mcp] connected servers failed', error),
				);
		};
		connectedServers.bindStatus(() => mcpGateway.status());
		const stopRegistry = connectedServers.onChanged(sync);
		const stopGateway = mcpGateway.onChanged(() =>
			connectedServers.notifyStatusChanged(),
		);
		// A project that closes takes its local servers with it.
		const stopWorkspace = authority.workspace.subscribe((_event, record) => {
			for (const projectId of record.removed.projects ?? [])
				mcpGateway.closeProject(projectId);
		});
		appWindows?.bindViewRequests(async (window, method, params, signal) => {
			if (window.source.kind !== 'mcp-app')
				throw protocolError('forbidden', 'This window has no server.');
			const outcome = await mcpApprovals?.authorize({
				terminalSessionId: window.terminalSessionId,
				projectId: window.projectId,
				operation: 'call_connected_tool',
				group: 'connectedServerTools',
				agent: `The window "${window.title}"`,
				terminalTitle:
					mcpTerminalTitle(window.terminalSessionId, window.projectId) ??
					'this terminal',
				summary: `use ${window.source.server}'s tool ${String(params.name ?? params.uri ?? '')}`,
				details: [],
				signal,
			});
			// A view sees a refusal as a refusal, with the reason, never as a fault.
			if (outcome !== undefined && !outcome.ok)
				throw protocolError('forbidden', outcome.error.message);
			try {
				return await mcpGateway.callFromView(
					window.projectId,
					window.source.server,
					method,
					params,
					signal,
				);
			} catch (error) {
				const code = (error as { code?: unknown } | null)?.code;
				throw protocolError(
					code === 'not_found'
						? 'not_found'
						: code === 'forbidden'
							? 'forbidden'
							: 'unavailable',
					error instanceof Error
						? error.message.slice(0, 500)
						: 'The request failed.',
				);
			}
		});
		removeMcpGatewayBindings = () => {
			stopRegistry();
			stopGateway();
			stopWorkspace();
		};
		sync();
	}

	/** The window tools, bound to whichever authority is composed when called. */
	function createMcpAppWindowAdapter(): AppWindowControlAdapter {
		const bound = (): AppWindowControlAdapter => {
			const windows = boundServer?.composition.appWindows;
			if (windows === undefined)
				throw new ControlEndpointError(
					'unsupported_op',
					'App windows are unavailable on this server.',
				);
			return createAppWindowControlAdapter({ windows, gateway: mcpGateway });
		};
		return {
			showWindow: (params, context, signal) =>
				bound().showWindow(params, context, signal),
			closeWindow: (params, context, signal) =>
				bound().closeWindow(params, context, signal),
			listWindows: (context, signal) => bound().listWindows(context, signal),
			listConnectedTools: (context, signal, after) =>
				bound().listConnectedTools(context, signal, after),
			callConnectedTool: (params, context, signal, mayShowWindow) =>
				bound().callConnectedTool(params, context, signal, mayShowWindow),
		};
	}

	// Opaque project handles for workspace reach (ADR-0030); project reach never
	// names a project. One codec, so a handle from list_terminals is the same
	// handle get_layout gives and every view tool accepts.
	const mcpProjectHandles = new ProjectHandleCodec(options.serverId);

	/** The view tools, bound to whichever authority is composed when called
	 * (ADR-0070). */
	function createMcpWorkspaceViewAdapter(): WorkspaceViewControlAdapter {
		const bound = (): WorkspaceViewControlAdapter => {
			const authority = requireMcpServer();
			const { workspaceView } = authority.composition;
			if (workspaceView === undefined)
				throw new ControlEndpointError(
					'unsupported_op',
					'Reading and changing the window layout is unavailable on this server.',
				);
			return createWorkspaceViewAdapter({
				relay: workspaceView.relay,
				targetFor: workspaceView.targetFor,
				state: () => authority.workspace.state,
				apply: (command, context) => applyMcpWorkspaceCommand(context, command),
				projectHandles: mcpProjectHandles,
			});
		};
		return {
			getLayout: (p, c, s) => bound().getLayout(p, c, s),
			focusTab: (p, c, s) => bound().focusTab(p, c, s),
			moveTab: (p, c, s) => bound().moveTab(p, c, s),
			resizePane: (p, c, s) => bound().resizePane(p, c, s),
			arrangeTabs: (p, c, s) => bound().arrangeTabs(p, c, s),
			focusProject: (p, c, s) => bound().focusProject(p, c, s),
			selectFolder: (p, c, s) => bound().selectFolder(p, c, s),
			createFolder: (p, c, s) => bound().createFolder(p, c, s),
			renameFolder: (p, c, s) => bound().renameFolder(p, c, s),
			deleteFolder: (p, c, s) => bound().deleteFolder(p, c, s),
			reorderFolders: (p, c, s) => bound().reorderFolders(p, c, s),
			focusHome: (p, c, s) => bound().focusHome(p, c, s),
			moveTabToFolder: (p, c, s) => bound().moveTabToFolder(p, c, s),
			openFile: (p, c, s) => bound().openFile(p, c, s),
			closeTab: (p, c, s) => bound().closeTab(p, c, s),
			anchorFor: (r, c, s) => bound().anchorFor(r, c, s),
			placeTerminal: (p, c, s) => bound().placeTerminal(p, c, s),
		};
	}

	// Opaque workspace window handles (ADR-0072), one codec like the project
	// handles, so list_projects and list_workspace_windows agree.
	const mcpWindowHandles = new WindowHandleCodec(options.serverId);
	// The start chooser's folder validation, from the same verified home the
	// composition's chooser and terminals use. It canonicalises; it lists nothing.
	const mcpRootFolders = new RootFolderBrowser({
		homeDirectory: nodeTerminalLaunchPathAuthority.homeDirectory,
	});

	/** The project and window tools, bound to whichever authority is composed
	 * when called (ADR-0072). Every change runs the server's own workspace
	 * operation as the MCP principal. */
	function createMcpAppControlAdapter(): AppControlAdapter {
		const bound = (): AppControlAdapter => {
			const authority = requireMcpServer();
			const operations = authority.composition.workspaceOperations?.operations;
			if (operations === undefined)
				throw new ControlEndpointError(
					'unsupported_op',
					'Projects and windows are unavailable on this server.',
				);
			const { workspaceView } = authority.composition;
			return createAppControlAdapter({
				state: () => authority.workspace.state,
				command: async (operation, payload, signal) => {
					const handler = (
						operations.commands as Record<
							string,
							((request: unknown) => unknown) | undefined
						>
					)?.[operation];
					if (handler === undefined)
						throw new ControlEndpointError(
							'unsupported_op',
							`${operation} is unavailable on this server.`,
						);
					const outcome = await handler(
						mcpPrincipalCommandRequest(operation, payload, signal),
					);
					return typeof outcome === 'object' &&
						outcome !== null &&
						'result' in outcome
						? (outcome as { result: unknown }).result
						: outcome;
				},
				projectHandles: mcpProjectHandles,
				windowHandles: mcpWindowHandles,
				canonicalFolder: (root) => mcpRootFolders.canonicalDirectory(root),
				openFirstTerminal: async (projectId) =>
					(await options.openTerminal(projectId)).id,
				busyTerminals: async (projectId, signal) =>
					// A terminal whose program cannot be observed counts as busy.
					(
						await authority.service.observeProjectForegroundProcesses(
							projectId,
							undefined,
							undefined,
							signal,
						)
					).filter(
						(observation) =>
							observation.foregroundBusy ||
							observation.observation === 'limited',
					).length,
				liveTerminals: (projectId) =>
					authority
						.list()
						.filter(
							(entry) =>
								entry.projectId === projectId && entry.status === 'running',
						).length,
				...(workspaceView === undefined
					? {}
					: {
							view: {
								relay: workspaceView.relay,
								targetFor: workspaceView.targetFor,
							},
						}),
			});
		};
		return {
			listProjects: (p, c, s) => bound().listProjects(p, c, s),
			listRecentFolders: (p, c, s) => bound().listRecentFolders(p, c, s),
			createProject: (p, c, s) => bound().createProject(p, c, s),
			updateProject: (p, c, s) => bound().updateProject(p, c, s),
			moveProject: (p, c, s) => bound().moveProject(p, c, s),
			closeProject: (p, c, s) => bound().closeProject(p, c, s),
			listWorkspaceWindows: (p, c, s) => bound().listWorkspaceWindows(p, c, s),
			openWorkspaceWindow: (p, c, s) => bound().openWorkspaceWindow(p, c, s),
			renameWorkspaceWindow: (p, c, s) =>
				bound().renameWorkspaceWindow(p, c, s),
			closeWorkspaceWindow: (p, c, s) => bound().closeWorkspaceWindow(p, c, s),
		};
	}

	/** One composed part of the MCP authority, or `unsupported_op` without it. */
	function requireMcpComposition<
		K extends
			| 'settingsOperations'
			| 'shellProfileOperations'
			| 'macroOperations'
			| 'workflowOperations',
	>(key: K): NonNullable<McpBoundServer['composition'][K]> {
		const part = requireMcpServer().composition[key];
		if (part === undefined)
			throw new ControlEndpointError(
				'unsupported_op',
				'That is unavailable on this server.',
			);
		return part as NonNullable<McpBoundServer['composition'][K]>;
	}

	type McpOperationRegistries = NonNullable<
		McpBoundServer['composition']['settingsOperations']
	>['operations'];

	function registryHandler(
		handlers:
			| ReadonlyMap<string, unknown>
			| Readonly<Record<string, unknown>>
			| undefined,
		operation: string,
	): ((request: unknown) => unknown) | undefined {
		const handler =
			handlers instanceof Map
				? handlers.get(operation)
				: (handlers as Readonly<Record<string, unknown>> | undefined)?.[
						operation
					];
		return typeof handler === 'function'
			? (handler as (request: unknown) => unknown)
			: undefined;
	}

	/** Run one server query as the MCP principal (ADR-0072). */
	async function runMcpRegistryQuery(
		registries: McpOperationRegistries,
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	): Promise<unknown> {
		const handler = registryHandler(registries.queries, operation);
		if (handler === undefined)
			throw new ControlEndpointError(
				'unsupported_op',
				`${operation} is unavailable on this server.`,
			);
		const outcome = await handler(
			mcpPrincipalQueryRequest(operation, payload, signal),
		);
		return typeof outcome === 'object' &&
			outcome !== null &&
			'result' in outcome &&
			!(outcome as { body?: unknown }).body
			? (outcome as { result: unknown }).result
			: outcome;
	}

	/** Run one server command as the MCP principal (ADR-0072). */
	async function runMcpRegistryCommand(
		registries: McpOperationRegistries,
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
		expectedRevision?: number,
	): Promise<unknown> {
		const handler = registryHandler(registries.commands, operation);
		if (handler === undefined)
			throw new ControlEndpointError(
				'unsupported_op',
				`${operation} is unavailable on this server.`,
			);
		const outcome = await handler(
			mcpPrincipalCommandRequest(operation, payload, signal, expectedRevision),
		);
		return typeof outcome === 'object' &&
			outcome !== null &&
			'result' in outcome
			? (outcome as { result: unknown }).result
			: outcome;
	}

	/** The settings and shell profile tools, bound to whichever authority is
	 * composed when called (ADR-0072). */
	function createMcpSettingsAdapter(): SettingsControlAdapter {
		const bound = (): SettingsControlAdapter =>
			createSettingsControlAdapter({
				query: (operation, payload, signal) =>
					runMcpRegistryQuery(
						operation.startsWith('settings.')
							? requireMcpComposition('settingsOperations').operations
							: requireMcpComposition('shellProfileOperations').operations,
						operation,
						payload,
						signal,
					),
				command: (operation, payload, signal, expectedRevision) =>
					runMcpRegistryCommand(
						operation.startsWith('settings.')
							? requireMcpComposition('settingsOperations').operations
							: requireMcpComposition('shellProfileOperations').operations,
						operation,
						payload,
						signal,
						expectedRevision,
					),
				state: () => requireMcpServer().workspace.state,
				projectHandles: mcpProjectHandles,
			});
		return {
			getSettings: (p, c, s) => bound().getSettings(p, c, s),
			updateSettings: (p, c, s) => bound().updateSettings(p, c, s),
			listShellProfiles: (p, c, s) => bound().listShellProfiles(p, c, s),
			saveShellProfile: (p, c, s) => bound().saveShellProfile(p, c, s),
			deleteShellProfile: (p, c, s) => bound().deleteShellProfile(p, c, s),
			reorderShellProfiles: (p, c, s) => bound().reorderShellProfiles(p, c, s),
			setDefaultShellProfile: (p, c, s) =>
				bound().setDefaultShellProfile(p, c, s),
			getConnectionMetrics: (p, c, s) => bound().getConnectionMetrics(p, c, s),
		};
	}

	/** The macro tools, bound to whichever authority is composed when called
	 * (ADR-0072). */
	function createMcpMacroAdapter(): MacroControlAdapter {
		const bound = (): MacroControlAdapter =>
			createMacroControlAdapter({
				query: (operation, payload, signal) =>
					runMcpRegistryQuery(
						requireMcpComposition('macroOperations').operations,
						operation,
						payload,
						signal,
					),
				command: (operation, payload, signal) =>
					runMcpRegistryCommand(
						requireMcpComposition('macroOperations').operations,
						operation,
						payload,
						signal,
					),
				resolveTerminal: (context, reference) => {
					const target = resolveMcpTerminal(context, reference);
					return {
						serverId: requireMcpServer().service.serverId,
						projectId: target.projectId,
						sessionId: target.id,
					};
				},
			});
		return {
			listMacros: (p, c, s) => bound().listMacros(p, c, s),
			runMacro: (p, c, s) => bound().runMacro(p, c, s),
			cancelMacro: (p, c, s) => bound().cancelMacro(p, c, s),
		};
	}

	/** The workflow tools, bound to whichever authority is composed when called
	 * (ADR-0097). */
	function createMcpWorkflowAdapter(): WorkflowControlAdapter {
		const bound = (): WorkflowControlAdapter =>
			createWorkflowControlAdapter({
				query: (operation, payload, signal) =>
					runMcpRegistryQuery(
						requireMcpComposition('workflowOperations').operations,
						operation,
						payload,
						signal,
					),
				command: (operation, payload, signal, expectedRevision) =>
					runMcpRegistryCommand(
						requireMcpComposition('workflowOperations').operations,
						operation,
						payload,
						signal,
						expectedRevision,
					),
				resolveTerminal: (context, reference) => {
					const target = resolveMcpTerminal(context, reference);
					return {
						serverId: requireMcpServer().service.serverId,
						projectId: target.projectId,
						sessionId: target.id,
					};
				},
			});
		return {
			getWorkflow: (p, c, s) => bound().getWorkflow(p, c, s),
			createWorkflow: (p, c, s) => bound().createWorkflow(p, c, s),
			updateWorkflowStep: (p, c, s) => bound().updateWorkflowStep(p, c, s),
			listWorkflowTemplates: (p, c, s) =>
				bound().listWorkflowTemplates(p, c, s),
			getWorkflowTemplate: (p, c, s) => bound().getWorkflowTemplate(p, c, s),
			createWorkflowTemplate: (p, c, s) =>
				bound().createWorkflowTemplate(p, c, s),
			updateWorkflowTemplate: (p, c, s) =>
				bound().updateWorkflowTemplate(p, c, s),
			deleteWorkflowTemplate: (p, c, s) =>
				bound().deleteWorkflowTemplate(p, c, s),
		};
	}

	function createMcpTerminalAdapter(): TerminalControlAdapter {
		const terminal = (context: ControlRequestContext, reference: string) =>
			resolveMcpTerminal(context, reference);
		const projectHandles = mcpProjectHandles;
		const liveTerminalsIn = (projectId: string) =>
			requireMcpServer()
				.list()
				.filter(
					(entry) =>
						entry.projectId === projectId && entry.status === 'running',
				).length;
		return {
			getMcpCapabilities: (context) => ({
				tools: mcpToolAvailability(context),
			}),
			listTerminals: (context) => {
				const authority = requireMcpServer();
				const activityBySession = authority.activity.snapshot().sessions;
				const workspaceReach = reachOf(context) === 'workspace';
				return {
					terminals: authority
						.list()
						.filter((entry) => mcpReaches(context, entry.projectId))
						.map((entry) => {
							const panel = mcpPanelFor(entry.id, entry.projectId);
							const activity = activityBySession[entry.id];
							const snapshot = authority.service.getSession(entry.id);
							return {
								terminal: entry.id,
								...(workspaceReach
									? workspaceProjectFields(
											projectHandles,
											authority.workspace.state,
											entry.projectId,
										)
									: {}),
								name: mcpTerminalTitle(entry.id, entry.projectId) ?? entry.id,
								status: entry.status,
								active:
									panel?.id ===
									authority.workspace.state.projects[entry.projectId]
										?.activePanelId,
								self: entry.id === context.terminalSessionId,
								cwd: entry.cwd,
								activity: activity?.status ?? 'idle',
								attention: activity?.attention ?? false,
								output_position: snapshot?.outputPosition ?? 0,
								replay_from: snapshot?.replayFrom ?? 0,
							};
						}),
				};
			},
			readTerminal: async (params, context) => {
				const target = terminal(context, params.terminal);
				const authority = requireMcpServer();
				const authorization = mcpAuthorization(target.projectId);
				if (params.format === 'raw') {
					const rawBytes = Math.floor(params.maxBytes / 4) * 3;
					const read = authority.service.readRetainedOutput(target.id, {
						authorization,
						...(params.after === undefined
							? {}
							: { fromPosition: params.after }),
						maxBytes: Math.max(1, rawBytes),
					});
					const bytes = rawBytes === 0 ? read.bytes.subarray(0, 0) : read.bytes;
					const next = read.fromPosition + bytes.byteLength;
					return {
						terminal: target.id,
						format: 'raw',
						encoding: 'base64',
						output: Buffer.from(bytes).toString('base64'),
						from: read.fromPosition,
						next,
						replay_from: read.replayFrom,
						output_position: read.outputPosition,
						history_lost: read.historyLost,
						dropped_bytes: read.droppedBytes,
						truncated_tail: next < read.outputPosition,
					};
				}
				const presentation = await authority.service.readPresentation(
					target.id,
					{
						authorization,
						format: params.format,
						maxBytes: params.maxBytes,
						...(params.lines === undefined ? {} : { maxRows: params.lines }),
					},
				);
				return {
					terminal: target.id,
					format: params.format,
					output:
						params.format === 'text'
							? (presentation.rows ?? []).join('\n')
							: (presentation.ansi ?? ''),
					output_position: presentation.outputPosition,
					dimensions: presentation.dimensions,
					presentation_truncated: presentation.truncated,
					dropped_bytes: presentation.droppedBytes,
					dropped_rows: presentation.droppedRows,
				};
			},
			searchTerminal: async (params, context) => {
				const target = terminal(context, params.terminal);
				const presentation = await requireMcpServer().service.readPresentation(
					target.id,
					{
						authorization: mcpAuthorization(target.projectId),
						format: 'text',
						maxBytes: params.maxBytes,
					},
				);
				return buildMcpTerminalSearchResult(target.id, presentation, params);
			},
			getTerminalStatus: (params, context) => {
				const target = terminal(context, params.terminal);
				const authority = requireMcpServer();
				const activity = authority.activity.get({
					serverId: target.serverId,
					projectId: target.projectId,
					sessionId: target.id,
				});
				return {
					terminal: target.id,
					status: target.status,
					cwd: target.cwd,
					activity: activity?.status ?? 'idle',
					attention: activity?.attention ?? false,
					output_position:
						authority.service.getSession(target.id)?.outputPosition ?? 0,
					replay_from: authority.service.getSession(target.id)?.replayFrom ?? 0,
				};
			},
			openTerminal: async (params, context) => {
				// A workspace-reach caller opens in the automation space unless it
				// names a project, and the space exists only once something has
				// needed it. A chat may be the first thing that does.
				if (reachOf(context) === 'workspace' && params.project === undefined)
					requireMcpServer().composition.workspaceOperations?.ensureAutomationSpace(
						options.homeDirectory,
					);
				const state = requireMcpServer().workspace.state;
				const projectId = resolveOpenTerminalProject({
					context,
					codec: projectHandles,
					state,
					project: params.project,
					liveTerminals: liveTerminalsIn,
				});
				// The caller's panel anchors cwd inheritance only in its own project,
				// and the new terminal joins the folder that panel is in.
				const callerPanel =
					projectId === context.projectId
						? mcpPanelFor(context.terminalSessionId, context.projectId)
						: undefined;
				const opened = await options.openTerminal(
					projectId,
					params.cwd,
					undefined,
					callerPanel?.id,
					callerPanel?.folderId,
					params.shellProfile,
				);
				// An automation terminal's opens join the run that owns it, so the
				// Automations section groups them under that run (ADR-0030).
				if (reachOf(context) === 'workspace')
					await boundServer?.composition.automationExecutor
						?.recordOpenedTerminal(context.terminalSessionId, opened.id)
						.catch(() => undefined);
				const panel = mcpPanelFor(opened.id, projectId);
				if (params.name !== undefined && panel !== undefined)
					applyMcpWorkspaceCommand(context, {
						type: 'panel.update',
						panelId: panel.id,
						patch: { title: params.name },
					});
				if (reachOf(context) === 'workspace')
					return {
						terminal: opened.id,
						...workspaceProjectFields(projectHandles, state, projectId),
						status: opened.status,
					};
				return { terminal: opened.id, status: opened.status };
			},
			writeTerminal: async (params, context, signal) => {
				const target = terminal(context, params.terminal);
				const bytes = await writeSeparatedInput(
					{
						body: params.text,
						keys: [
							...(params.keys ?? []).map((key) => TERMINAL_KEYS[key]),
							...(params.submit === true ? [SUBMIT_INPUT] : []),
						],
					},
					(data) =>
						requireMcpServer().write(
							target.id,
							data,
							mcpAuthorization(target.projectId),
						),
					{
						terminal: terminalInputKey(
							requireMcpServer().service.serverId,
							target.id,
						),
						signal,
					},
				);
				return {
					terminal: target.id,
					bytes,
					submitted: params.submit === true,
				};
			},
			runCommand: async (params, context, signal) => {
				const target = terminal(context, params.terminal);
				const service = requireMcpServer().service;
				const bracketed = await service.bracketedPasteMode(
					target.id,
					mcpAuthorization(target.projectId),
				);
				const from = service.getSession(target.id)?.outputPosition ?? 0;
				// Enter goes on its own, so a full-screen agent reads it as a key
				// press rather than as the end of the paste.
				const submittedBytes = await writeSeparatedInput(
					{
						body: commandPasteInput(params.command, bracketed),
						keys: [SUBMIT_INPUT],
					},
					(data) =>
						requireMcpServer().write(
							target.id,
							data,
							mcpAuthorization(target.projectId),
						),
					{
						terminal: terminalInputKey(
							requireMcpServer().service.serverId,
							target.id,
						),
						signal,
					},
				);
				return {
					terminal: target.id,
					command_id: context.requestId,
					from,
					submitted_bytes: submittedBytes,
					submitted: true,
					bracketed,
				};
			},
			closeTerminal: async (params, context) => {
				const target = terminal(context, params.terminal);
				await requireMcpServer().kill(
					target.id,
					mcpAuthorization(target.projectId),
				);
				return { terminal: target.id, closed: true };
			},
			// Showing a terminal is the agent's client's to do (ADR-0070): the host
			// only resolves it within scope.
			focusTerminal: (params, context) => ({
				terminal: terminal(context, params.terminal).id,
			}),
			renameTerminal: (params, context) => {
				const target = terminal(context, params.terminal);
				const panel = mcpPanelFor(target.id, target.projectId);
				if (panel === undefined)
					throw new ControlEndpointError(
						'terminal_not_found',
						'The requested terminal is unavailable.',
					);
				applyMcpWorkspaceCommand(context, {
					type: 'panel.update',
					panelId: panel.id,
					patch: { title: params.name },
				});
				return { terminal: target.id, name: params.name };
			},
			splitTerminal: async (params, context) => {
				const target = terminal(context, params.terminal);
				assertAutomationSpaceCapacity(
					isAutomationSpace(
						requireMcpServer().workspace.state.projects[target.projectId],
					),
					liveTerminalsIn(target.projectId),
				);
				// A split lands beside its target, so it is created in the target's
				// folder: a folder's layout holds only that folder's panels.
				const targetPanel = mcpPanelFor(target.id, target.projectId);
				const opened = await options.openTerminal(
					target.projectId,
					undefined,
					undefined,
					targetPanel?.id,
					targetPanel?.folderId,
				);
				// Where it appears is the agent's client's to decide (ADR-0070).
				const panel = mcpPanelFor(opened.id, target.projectId);
				if (params.name !== undefined && panel !== undefined)
					applyMcpWorkspaceCommand(context, {
						type: 'panel.update',
						panelId: panel.id,
						patch: { title: params.name },
					});
				if (reachOf(context) === 'workspace')
					await boundServer?.composition.automationExecutor
						?.recordOpenedTerminal(context.terminalSessionId, opened.id)
						.catch(() => undefined);
				return { terminal: opened.id, status: opened.status };
			},
			waitForIdle: async (params, context, signal) => {
				const target = terminal(context, params.terminal);
				await requireMcpServer().service.waitForInactivity(
					target.id,
					params.seconds * 1000,
					{ authorization: mcpAuthorization(target.projectId), signal },
				);
				return { terminal: target.id, idle: true };
			},
			waitForCommand: () => {
				throw new ControlEndpointError(
					'unsupported_op',
					'Structured command-completion observation is unavailable.',
				);
			},
			waitForAttention: () => {
				throw new ControlEndpointError(
					'unsupported_op',
					'Attention waiting is unavailable.',
				);
			},
			...createTerminalMetadataAdapter({
				state: () => requireMcpServer().workspace.state,
				apply: (command, context) => applyMcpWorkspaceCommand(context, command),
				resolveTerminal: (context, reference) => {
					const target = terminal(context, reference);
					return { sessionId: target.id, projectId: target.projectId };
				},
				projectHandles,
			}),
		};
	}

	function mcpToolAvailability(context: ControlRequestContext): readonly {
		readonly tool: string;
		readonly available: boolean;
		readonly permission: 'allow' | 'ask' | 'deny';
	}[] {
		const unavailable = new Set<ControlOperation>([
			'wait_for_command',
			'wait_for_attention',
		]);
		const approvals = boundServer?.composition.mcpApprovals;
		if (boundServer?.composition.appWindows === undefined)
			for (const tool of [
				'show_window',
				'close_window',
				'list_windows',
			] as const)
				unavailable.add(tool);
		const composition = boundServer?.composition;
		if (composition?.notifications === undefined)
			for (const tool of [
				'send_notification',
				'list_notifications',
				'dismiss_notification',
			] as const)
				unavailable.add(tool);
		if (composition?.settingsOperations === undefined)
			for (const tool of ['get_settings', 'update_settings'] as const)
				unavailable.add(tool);
		if (composition?.shellProfileOperations === undefined)
			for (const tool of [
				'list_shell_profiles',
				'save_shell_profile',
				'delete_shell_profile',
				'reorder_shell_profiles',
				'set_default_shell_profile',
			] as const)
				unavailable.add(tool);
		if (composition?.connectionMetrics === undefined)
			unavailable.add('get_connection_metrics');
		if (composition?.macroOperations === undefined)
			for (const tool of ['list_macros', 'run_macro', 'cancel_macro'] as const)
				unavailable.add(tool);
		if (composition?.workflowOperations === undefined)
			for (const tool of [
				'get_workflow',
				'create_workflow',
				'update_workflow_step',
				'list_workflow_templates',
				'get_workflow_template',
				'create_workflow_template',
				'update_workflow_template',
				'delete_workflow_template',
			] as const)
				unavailable.add(tool);
		return CONTROL_TOOL_OPERATIONS.map((tool) => {
			const group = CONTROL_PERMISSION_GROUPS[tool];
			return {
				tool,
				available: !unavailable.has(tool),
				permission:
					group === undefined || approvals === undefined
						? 'allow'
						: approvals.effectivePolicy(group, context.terminalSessionId),
			};
		});
	}

	/** The notification tools, bound to whichever authority is composed when called. */
	function createMcpNotificationAdapter(): NotificationControlAdapter {
		const bound = (): NotificationControlAdapter => {
			const notifications = boundServer?.composition.notifications;
			if (notifications === undefined)
				throw new ControlEndpointError(
					'unsupported_op',
					'Notifications are unavailable on this server.',
				);
			const operations =
				boundServer?.composition.notificationOperations?.operations;
			return createNotificationControlAdapter({
				notifications,
				// A user's own dismissal: an activity notification acknowledges its
				// terminal.
				...(operations === undefined
					? {}
					: {
							dismiss: async (record) =>
								(
									(await runMcpRegistryCommand(
										operations,
										'notifications.dismiss',
										{
											id: record.id,
											projectId: record.projectId,
											sessionId: record.sessionId,
										},
										new AbortController().signal,
									)) as { dismissed?: unknown } | null
								)?.dismissed === true,
						}),
				reaches: (context, owner) =>
					mcpReaches(context, owner.projectId) &&
					requireMcpServer()
						.list()
						.some(
							(entry) =>
								entry.id === owner.sessionId &&
								entry.projectId === owner.projectId,
						),
			});
		};
		return {
			sendNotification: (params, context, signal) =>
				bound().sendNotification(params, context, signal),
			dismissNotification: (params, context, signal) =>
				bound().dismissNotification(params, context, signal),
			listNotifications: (params, context, signal) =>
				bound().listNotifications(params, context, signal),
		};
	}

	function requireAutomationMcp() {
		const automations = requireMcpServer().composition.automationMcp;
		if (automations === undefined)
			throw new ControlEndpointError(
				'unsupported_op',
				'Automations are unavailable on this server.',
			);
		return automations;
	}

	/** Run an automation call, turning a service refusal into a public error. */
	async function automationMcpCall<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			const mapped = automationControlError(error);
			if (mapped !== undefined)
				throw new ControlEndpointError(mapped.code, mapped.message);
			throw error;
		}
	}

	/** A run's subject is visible only when its project is in the caller's reach. */
	function mcpSeesSubject(
		context: ControlRequestContext,
		subject: AutomationSubject,
	): boolean {
		return subject.kind === 'device' || mcpReaches(context, subject.projectId);
	}

	function mcpAutomationSubject(
		context: ControlRequestContext,
		reference: string,
	): { readonly subject: AutomationSubject; readonly title: string } {
		const target = resolveMcpTerminal(context, reference);
		const authority = requireMcpServer();
		const session = authority.service.getSession(target.id);
		const title = mcpTerminalTitle(target.id, target.projectId) ?? target.id;
		return {
			subject: {
				kind: 'terminal',
				serverId: authority.service.serverId,
				projectId: target.projectId,
				sessionId: target.id,
				...(session?.createdAt === undefined
					? {}
					: { sessionCreatedAt: session.createdAt }),
				title,
			},
			title,
		};
	}

	function createMcpAutomationAdapter(): AutomationControlAdapter {
		const actor = (context: ControlRequestContext) => ({
			terminalSessionId: context.terminalSessionId,
		});
		return {
			listAutomations: () =>
				automationMcpCall(() => requireAutomationMcp().list()),
			getAutomation: (params) =>
				automationMcpCall(() =>
					requireAutomationMcp().get(params.automationId),
				),
			listAutomationRuns: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().runs(
						params.automationId,
						params.limit,
						(subject) => mcpSeesSubject(context, subject),
					),
				),
			createAutomation: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().create(params.definition, actor(context)),
				),
			updateAutomation: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().update(
						params.automationId,
						params.definition,
						params.revision,
						actor(context),
					),
				),
			deleteAutomation: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().remove(
						params.automationId,
						params.revision,
						actor(context),
					),
				),
			setAutomationEnabled: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().setEnabled(
						params.automationId,
						params.enabled,
						params.revision,
						actor(context),
					),
				),
			runAutomation: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().run(
						params.automationId,
						params.terminal === undefined
							? undefined
							: mcpAutomationSubject(context, params.terminal).subject,
						actor(context),
					),
				),
			stopAutomationRun: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().stop(params.runId, actor(context)),
				),
			removeAutomationRun: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().removeRun(params.runId, actor(context)),
				),
			pruneAutomationRuns: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().pruneRuns(
						params.automationId,
						params.olderThanDays,
						actor(context),
					),
				),
			dismissMissedRuns: (params, context) =>
				automationMcpCall(() =>
					requireAutomationMcp().dismissMissed(
						params.automationId,
						actor(context),
					),
				),
		};
	}

	/** The agent detected in a terminal, as its session source names it. */
	function mcpAgentLabel(terminalSessionId: string): string {
		const entries =
			boundServer?.agents.entriesForTerminal(terminalSessionId) ?? [];
		const entry =
			entries.find((candidate) => candidate.kind === 'root') ?? entries[0];
		const label =
			entry?.harnessDisplayName?.trim() || entry?.providerDisplayName?.trim();
		return label === undefined || label === '' ? 'An agent' : label;
	}

	function createHostPermissionGate(): ControlPermissionGate {
		const gate = (): ControlPermissionGate | undefined => {
			const approvals = boundServer?.composition.mcpApprovals;
			return approvals === undefined
				? undefined
				: createMcpPermissionGate({
						approvals,
						describe: describeMcpRequest,
						chatAgentName: (chatId) =>
							boundServer?.composition.agentChat?.agentName(chatId),
					});
		};
		return {
			authorize: async (request) => {
				const refusal = await gate()?.authorize(request);
				if (refusal === undefined) noteChatMcpCall(request);
				return refusal;
			},
		};
	}

	/** Show a permitted Terminay call in the chat that made it, in our words. */
	function noteChatMcpCall(request: {
		readonly op: ControlOperation;
		readonly params: Readonly<Record<string, unknown>>;
		readonly context: ControlRequestContext;
	}): void {
		const chatId = request.context.chat?.chatId;
		const chats = boundServer?.composition.agentChat;
		if (chatId === undefined || chats === undefined) return;
		const text = describeChatMcpCall(
			request.op,
			request.params,
			(reference) => {
				try {
					const target = resolveMcpTerminal(request.context, reference);
					return mcpTerminalTitle(target.id, target.projectId);
				} catch {
					return undefined;
				}
			},
		);
		if (text !== undefined) chats.noteMcpCall(chatId, text);
	}

	async function describeMcpRequest(request: {
		readonly op: ControlOperation;
		readonly group: string;
		readonly params: Readonly<Record<string, unknown>>;
		readonly context: ControlRequestContext;
	}): Promise<
		| McpApprovalDescription
		| {
				readonly ok: false;
				readonly error: { code: ControlEndpointError['code']; message: string };
		  }
	> {
		const { op, params, context } = request;
		const terminalTitle =
			mcpTerminalTitle(context.terminalSessionId, context.projectId) ??
			'a terminal';
		const agent = mcpAgentLabel(context.terminalSessionId);
		try {
			const described = await describeMcpOperation(
				op,
				params,
				context,
				request.group,
			);
			return { agent, terminalTitle, ...described };
		} catch (error) {
			const mapped =
				automationControlError(error) ??
				(error instanceof ControlEndpointError
					? { code: error.code, message: error.message }
					: undefined);
			if (mapped !== undefined) return { ok: false, error: mapped };
			throw error;
		}
	}

	/** Plain words and full details for one MCP request's approval prompt. */
	async function describeMcpOperation(
		op: ControlOperation,
		params: Readonly<Record<string, unknown>>,
		context: ControlRequestContext,
		group?: string,
	): Promise<Pick<McpApprovalDescription, 'summary' | 'details'>> {
		const text = (value: unknown): string =>
			typeof value === 'string' ? value : '';
		const definition = () => {
			const { automation_id: _id, revision: _revision, ...rest } = params;
			return rest;
		};
		const targetTitle = () => {
			const reference = text(params.terminal);
			if (reference === '') return 'a terminal';
			const target = resolveMcpTerminal(context, reference);
			return mcpTerminalTitle(target.id, target.projectId) ?? target.id;
		};
		// The workflow tools default to the calling terminal.
		const workflowTerminal = () =>
			params.terminal === undefined ? 'this terminal' : targetTitle();
		// A template is named by its name, with its id when it cannot be read.
		const templateName = async (): Promise<string> => {
			const id = text(params.template_id);
			try {
				const state = (await runMcpRegistryQuery(
					requireMcpComposition('workflowOperations').operations,
					'workflows.templates.get',
					{},
					new AbortController().signal,
				)) as { templates?: readonly { id: string; name: string }[] };
				const found = state.templates?.find((item) => item.id === id);
				return found === undefined ? id : `${found.name} (${id})`;
			} catch {
				return id;
			}
		};
		switch (op) {
			case 'create_automation':
				return requireAutomationMcp().describe({
					kind: 'create',
					input: definition(),
				});
			case 'update_automation':
				return requireAutomationMcp().describe({
					kind: 'update',
					automationId: text(params.automation_id),
					input: definition(),
				});
			case 'delete_automation':
				return requireAutomationMcp().describe({
					kind: 'delete',
					automationId: text(params.automation_id),
				});
			case 'set_automation_enabled':
				return requireAutomationMcp().describe({
					kind: 'setEnabled',
					automationId: text(params.automation_id),
					enabled: params.enabled === true,
				});
			case 'run_automation':
				return requireAutomationMcp().describe({
					kind: 'run',
					automationId: text(params.automation_id),
					...(params.terminal === undefined
						? {}
						: {
								subjectTitle: mcpAutomationSubject(
									context,
									text(params.terminal),
								).title,
							}),
				});
			case 'stop_automation_run':
				return requireAutomationMcp().describe({
					kind: 'stop',
					runId: text(params.run_id),
				});
			case 'list_automations':
				return { summary: 'list your automations', details: [] };
			case 'get_automation':
			case 'list_automation_runs':
				return {
					summary: `read the automation ${text(params.automation_id)}${op === 'list_automation_runs' ? "'s run history" : ''}`,
					details: [],
				};
			case 'run_command':
				return {
					summary: `run a command in ${targetTitle()}`,
					details: [
						{ label: 'Command', value: text(params.command), code: true },
					],
				};
			case 'write_terminal':
				return {
					summary: `type into ${targetTitle()}`,
					details: [
						{ label: 'Text', value: text(params.text), code: true },
						{ label: 'Submit', value: params.submit === true ? 'Yes' : 'No' },
					],
				};
			case 'open_terminal':
				return {
					summary: 'open a new terminal',
					details: [
						...(typeof params.name === 'string'
							? [{ label: 'Name', value: params.name }]
							: []),
						...(typeof params.cwd === 'string'
							? [{ label: 'Working directory', value: params.cwd }]
							: []),
					],
				};
			case 'close_terminal':
				return { summary: `close ${targetTitle()}`, details: [] };
			case 'focus_terminal':
				return { summary: `switch to ${targetTitle()}`, details: [] };
			case 'rename_terminal':
				return {
					summary: `rename ${targetTitle()} to "${text(params.name)}"`,
					details: [],
				};
			case 'split_terminal':
				return { summary: `split ${targetTitle()}`, details: [] };
			case 'list_terminals':
				return { summary: 'list your terminals', details: [] };
			case 'show_window':
				return {
					summary:
						params.window === undefined
							? `show a window titled "${text(params.title)}" in this terminal`
							: `update its window to "${text(params.title)}"`,
					details: [],
				};
			case 'close_window':
				return { summary: 'close one of its windows', details: [] };
			case 'list_windows':
				return { summary: 'list the windows in this terminal', details: [] };
			case 'send_notification':
			case 'list_notifications':
			case 'dismiss_notification':
				return describeNotificationRequest(op, params);
			case 'remove_automation_run':
				return requireAutomationMcp().describe({
					kind: 'removeRun',
					runId: text(params.run_id),
				});
			case 'prune_automation_runs':
				return requireAutomationMcp().describe({
					kind: 'pruneRuns',
					automationId: text(params.automation_id),
					olderThanDays:
						typeof params.older_than_days === 'number'
							? params.older_than_days
							: 0,
				});
			case 'dismiss_missed_runs':
				return requireAutomationMcp().describe({
					kind: 'dismissMissed',
					...(typeof params.automation_id === 'string'
						? { automationId: params.automation_id }
						: {}),
				});
			case 'get_settings':
				return { summary: 'read the server settings', details: [] };
			case 'update_settings': {
				// The prompt is the whole request: every setting with its current
				// and requested value. A request that could never apply is refused
				// here, so nobody is asked to approve it.
				const operations =
					requireMcpComposition('settingsOperations').operations;
				const state = settingsState(
					await runMcpRegistryQuery(
						operations,
						SETTINGS_OPERATIONS.get,
						{},
						new AbortController().signal,
					),
				);
				return describeSettingsUpdate(
					planSettingsUpdate(
						typeof params.settings === 'object' && params.settings !== null
							? (params.settings as Record<string, unknown>)
							: {},
						state,
					),
				);
			}
			case 'list_shell_profiles':
				return { summary: 'list the shell profiles', details: [] };
			case 'get_connection_metrics':
				return { summary: 'read the connection timings', details: [] };
			case 'save_shell_profile': {
				const profile =
					typeof params.profile === 'object' && params.profile !== null
						? (params.profile as Record<string, unknown>)
						: {};
				const target =
					typeof profile.target === 'object' && profile.target !== null
						? (profile.target as Record<string, unknown>)
						: undefined;
				return {
					summary:
						typeof profile.id === 'string'
							? `change the shell profile ${profile.id}`
							: `add the shell profile "${text(profile.name)}"`,
					details: [
						...(typeof profile.name === 'string'
							? [{ label: 'Name', value: profile.name }]
							: []),
						...(target === undefined
							? []
							: [
									{
										label: 'Runs',
										value:
											target.kind === 'executable'
												? text(target.executable)
												: target.kind === 'wsl'
													? `WSL ${text(target.distribution)}`
													: 'System default shell',
										code: true,
									},
								]),
						...(Array.isArray(profile.args)
							? [
									{
										label: 'Arguments',
										value: profile.args.join(' '),
										code: true,
									},
								]
							: []),
						...(typeof profile.environment === 'object' &&
						profile.environment !== null
							? [
									{
										label: 'Environment variables',
										value: Object.keys(profile.environment).join(', '),
										code: true,
									},
								]
							: []),
					],
				};
			}
			case 'delete_shell_profile':
				return {
					summary: `delete the shell profile ${text(params.profile_id)}`,
					details: [],
				};
			case 'reorder_shell_profiles':
				return { summary: 'reorder the shell profiles', details: [] };
			case 'set_default_shell_profile':
				return {
					summary: `make ${text(params.profile_id)} the default shell profile`,
					details: [],
				};
			case 'list_macros':
				return { summary: 'list the macros', details: [] };
			case 'run_macro':
				return {
					summary: `run the macro ${text(params.macro_id)} in ${targetTitle()}`,
					details: Object.entries(
						typeof params.values === 'object' && params.values !== null
							? (params.values as Record<string, unknown>)
							: {},
					).map(([field, value]) => ({
						label: `Field ${field}`,
						value: String(value),
						code: true,
					})),
				};
			case 'cancel_macro':
				return { summary: 'cancel a macro run', details: [] };
			case 'get_workflow':
				return {
					summary: `read the workflow of ${workflowTerminal()}`,
					details: [],
				};
			case 'create_workflow':
				if (params.template_id !== undefined)
					return {
						summary: `attach a copy of the workflow template ${text(params.template_id)} to ${workflowTerminal()}`,
						details: [],
					};
				return {
					summary: `attach the workflow ${text(params.name)} to ${workflowTerminal()}`,
					details: (Array.isArray(params.steps) ? params.steps : [])
						.slice(0, 50)
						.map((step, index) => ({
							label: `Step ${index + 1}`,
							value: text((step as { title?: unknown } | null)?.title),
						})),
				};
			case 'list_workflow_templates':
				return { summary: 'list the workflow templates', details: [] };
			case 'get_workflow_template':
				return {
					summary: `read the workflow template ${text(params.template_id)}`,
					details: [],
				};
			case 'create_workflow_template':
			case 'update_workflow_template': {
				const steps = Array.isArray(params.steps) ? params.steps : undefined;
				const fields: { label: string; value: string }[] = [];
				if (params.name !== undefined)
					fields.push({ label: 'Name', value: text(params.name) });
				if (params.category !== undefined)
					fields.push({
						label: 'Category',
						value: text(params.category) || 'None',
					});
				if (params.description !== undefined)
					fields.push({
						label: 'Description',
						value: text(params.description),
					});
				if (params.opening_prompt !== undefined)
					fields.push({
						label: 'Opening prompt',
						value: text(params.opening_prompt),
					});
				for (const [index, step] of (steps ?? []).slice(0, 50).entries())
					fields.push({
						label: `Step ${index + 1}`,
						value: text((step as { title?: unknown } | null)?.title),
					});
				return {
					summary:
						op === 'create_workflow_template'
							? `save the workflow template ${text(params.name)} for every project on this server`
							: `change the workflow template ${await templateName()} for every project on this server`,
					details: fields,
				};
			}
			case 'delete_workflow_template':
				return {
					summary: `delete the workflow template ${await templateName()} for every project on this server`,
					details: [],
				};
			case 'update_workflow_step':
				return {
					summary: `mark a workflow step ${text(params.status)} in ${workflowTerminal()}`,
					details:
						typeof params.note === 'string' && params.note !== ''
							? [{ label: 'Note', value: params.note }]
							: [],
				};
			case 'update_terminal':
				return {
					summary: `change ${targetTitle()}`,
					details: (['icon', 'color', 'note'] as const).flatMap((field) =>
						params[field] === undefined
							? []
							: [
									{
										label: field[0]!.toUpperCase() + field.slice(1),
										value:
											params[field] === null ? 'None' : text(params[field]),
									},
								],
					),
				};
			case 'move_terminal_to_project':
				return {
					summary: `move ${targetTitle()} to ${mcpProjectTitle(context, params.project) ?? 'another project'}`,
					details: [],
				};
			case 'focus_home':
				return { summary: 'show Home', details: [] };
			case 'delete_folder':
				return { summary: 'delete a folder', details: [] };
			case 'reorder_folders':
				return { summary: 'reorder folders', details: [] };
			case 'list_projects':
				return { summary: 'list your projects', details: [] };
			case 'list_recent_folders':
				return { summary: 'list your recent project folders', details: [] };
			case 'create_project':
				return {
					summary: `create a project${typeof params.name === 'string' ? ` named "${params.name}"` : ''}`,
					details: [{ label: 'Folder', value: text(params.root), code: true }],
				};
			case 'update_project':
				return {
					summary: `change ${mcpProjectTitle(context, params.project) ?? 'a project'}`,
					details: [
						...(['name', 'icon', 'color', 'root'] as const).flatMap((field) =>
							typeof params[field] === 'string'
								? [
										{
											label: field[0]!.toUpperCase() + field.slice(1),
											value: params[field] as string,
										},
									]
								: [],
						),
						...(params.shell_profile === undefined
							? []
							: [
									{
										label: 'Default shell profile',
										value: text(params.shell_profile) || 'None',
									},
								]),
					],
				};
			case 'move_project':
				return {
					summary: `move ${mcpProjectTitle(context, params.project) ?? 'a project'}`,
					details: [],
				};
			case 'close_project':
				return {
					summary: `close ${mcpProjectTitle(context, params.project) ?? 'a project'}${params.force === true ? ', even with programs running' : ''}`,
					details: [],
				};
			case 'list_workspace_windows':
				return { summary: 'list your windows', details: [] };
			case 'open_workspace_window':
				return {
					summary: `open a window${typeof params.name === 'string' ? ` named "${params.name}"` : ''}`,
					details: [],
				};
			case 'rename_workspace_window':
				return {
					summary: `rename a window to "${text(params.name)}"`,
					details: [],
				};
			case 'close_workspace_window':
				return { summary: 'close a window', details: [] };
			case 'call_connected_tool':
				// One call asks twice: to run the tool, then to show its view.
				return group === 'appWindows'
					? {
							summary: `show the view of ${text(params.name)} in a window in this terminal`,
							details: [],
						}
					: {
							summary: `use the connected tool ${text(params.name)}`,
							details: [
								{
									label: 'Arguments',
									value: JSON.stringify(params.arguments ?? {}, null, 2),
									code: true,
								},
							],
						};
			default:
				return {
					summary: `${op.replaceAll('_', ' ')} ${targetTitle()}`,
					details: [],
				};
		}
	}

	/** The name of a project a caller named by handle, if it reaches it. */
	function mcpProjectTitle(
		context: ControlRequestContext,
		handle: unknown,
	): string | undefined {
		const state = requireMcpServer().workspace.state;
		const projectId =
			typeof handle === 'string'
				? mcpProjectHandles.resolve(handle, state)
				: reachOf(context) === 'workspace'
					? undefined
					: context.projectId;
		if (projectId === undefined || !mcpReaches(context, projectId))
			return undefined;
		const name = state.projects[projectId]?.name;
		return name === undefined ? undefined : `the project "${name}"`;
	}

	function buildMcpTerminalSearchResult(
		terminal: string,
		presentation: Awaited<
			ReturnType<McpBoundServer['service']['readPresentation']>
		>,
		params: Parameters<
			NonNullable<TerminalControlAdapter['searchTerminal']>
		>[0],
	) {
		const rows = presentation.rows ?? [];
		const query = params.caseSensitive
			? params.query
			: params.query.toLocaleLowerCase();
		const matches: Array<{
			row: number;
			text: string;
			before: readonly string[];
			after: readonly string[];
		}> = [];
		let matchesTruncated = false;
		for (let row = 0; row < rows.length; row += 1) {
			const text = rows[row] ?? '';
			const comparable = params.caseSensitive ? text : text.toLocaleLowerCase();
			if (!comparable.includes(query)) continue;
			if (matches.length >= params.maxMatches) {
				matchesTruncated = true;
				break;
			}
			let context = params.contextLines;
			let candidate: (typeof matches)[number];
			do {
				candidate = {
					row,
					text,
					before: rows.slice(Math.max(0, row - context), row),
					after: rows.slice(row + 1, row + 1 + context),
				};
				if (
					Buffer.byteLength(JSON.stringify([...matches, candidate]), 'utf8') <=
					params.maxBytes
				)
					break;
				context -= 1;
			} while (context >= 0);
			if (
				Buffer.byteLength(JSON.stringify([...matches, candidate]), 'utf8') >
				params.maxBytes
			) {
				matchesTruncated = true;
				break;
			}
			matches.push(candidate);
		}
		return {
			terminal,
			query: params.query,
			matches,
			output_position: presentation.outputPosition,
			dimensions: presentation.dimensions,
			matches_truncated: matchesTruncated,
			presentation_truncated: presentation.truncated,
		};
	}

	function requireMcpServer(): McpBoundServer {
		if (boundServer === null)
			throw new ControlEndpointError(
				'not_in_terminay',
				'The local Terminay server is unavailable.',
			);
		return boundServer;
	}

	function mcpPanelFor(sessionId: string, projectId: string) {
		return Object.values(requireMcpServer().workspace.state.panels).find(
			(panel) =>
				panel.type === 'terminal' &&
				panel.projectId === projectId &&
				panel.sessionId === sessionId,
		);
	}

	/** The title a terminal's tab displays, as the server resolves it: a name a
	 * person gave it, else its program's title, else its default name. A program
	 * title is live state the title service holds, not a panel field (ADR-0058). */
	function mcpTerminalTitle(
		sessionId: string,
		projectId: string,
	): string | undefined {
		return (
			requireMcpServer().composition.terminalTitles?.displayedTitleForSession(
				sessionId,
			) ?? mcpPanelFor(sessionId, projectId)?.title
		);
	}

	/** Whether a capability reaches a project on this server (ADR-0030). */
	function mcpReaches(
		context: ControlRequestContext,
		projectId: string,
	): boolean {
		// A terminal the server still remembers after its project was closed is
		// gone from the workspace, so MCP neither lists nor addresses it.
		if (requireMcpServer().workspace.state.projects[projectId] === undefined)
			return false;
		return reachOf(context) === 'workspace' || projectId === context.projectId;
	}

	function resolveMcpTerminal(
		context: ControlRequestContext,
		reference: string,
	) {
		const candidates = requireMcpServer()
			.list()
			.filter((entry) => mcpReaches(context, entry.projectId))
			.filter(
				(entry) =>
					entry.id === reference ||
					mcpTerminalTitle(entry.id, entry.projectId) === reference,
			);
		if (candidates.length === 1) return candidates[0]!;
		if (candidates.length > 1)
			throw new ControlEndpointError(
				'ambiguous_terminal',
				'The terminal reference is ambiguous.',
				candidates.map((entry) => entry.id),
			);
		throw new ControlEndpointError(
			'terminal_not_found',
			'The requested terminal is unavailable.',
		);
	}

	/** Authorize by the target's own project; `resolveMcpTerminal` has already
	 * confirmed the capability reaches it. */
	function mcpAuthorization(projectId: string) {
		return {
			serverId: requireMcpServer().service.serverId,
			projectId,
			scope: 'write' as const,
		};
	}

	function applyMcpWorkspaceCommand(
		context: ControlRequestContext,
		command: Parameters<
			NonNullable<
				McpBoundServer['composition']['workspaceOperations']
			>['applyHostCommand']
		>[1],
	): void {
		const authority = requireMcpServer();
		const applied = authority.composition.workspaceOperations?.applyHostCommand(
			`mcp:${context.requestId}:${Math.random().toString(36).slice(2)}`.slice(
				0,
				128,
			),
			command,
			authority.workspace.state.revision,
		);
		if (applied === undefined || !applied.ok)
			throw new ControlEndpointError(
				'internal',
				'The workspace rejected the control operation.',
			);
	}

	// MCP enablement is applied before anything can be minted, so a server
	// started with MCP off grants nothing while it restores terminals, runs
	// automations, or starts bots.
	applyMcpSetting(options.initialSettings ?? {});

	function boundFrom(server: McpHostServer): McpBoundServer {
		const service = server.composition.terminal;
		const projectOf = (id: string): string => {
			const session = service.getSession(id);
			if (session === undefined)
				throw new Error(`Unknown terminal session: ${id}`);
			return session.projectId;
		};
		return {
			...server,
			// A host's own write and kill are methods of its authority, so they
			// keep it as `this`.
			write:
				server.write?.bind(server) ??
				(async (id, data, authorization) => {
					await server.composition.terminalInputSources.write({
						identity: {
							serverId: service.serverId,
							projectId: projectOf(id),
							sessionId: id,
						},
						clientId: authorization?.clientId ?? 'mcp-host',
						source: 'remote',
						data,
						...(authorization === undefined ? {} : { authorization }),
					});
				}),
			kill:
				server.kill?.bind(server) ??
				((id, authorization) => service.kill(id, authorization)),
			composition: server.composition,
			workspace: server.workspace,
			activity: server.activity,
			agents: server.agents,
			keepsTerminalsAcrossRestart: server.keepsTerminalsAcrossRestart,
			service,
			list: () =>
				service.listSessions().map((snapshot) =>
					Object.freeze({
						id: snapshot.sessionId,
						serverId: snapshot.serverId,
						projectId: snapshot.projectId,
						cwd: snapshot.cwd,
						pid: snapshot.pid,
						status: snapshot.status,
					}),
				),
		};
	}

	return {
		capabilities: mcpCapabilities,
		gateway: mcpGateway,
		terminalLaunchEnvironmentFor: (intent, placement) => {
			if (!mcpCapabilities.isEnabled()) return undefined;
			// Reach comes only from the canonical project kind the launch
			// resolver read from server state (ADR-0030): an automation-space
			// terminal gets workspace reach, every other terminal project reach.
			const capability = mcpCapabilities.mint(
				intent.identity.sessionId,
				intent.identity.projectId,
				'write',
				placement,
			);
			return definedEnv(getTerminalControlEnv(capability));
		},
		terminalControlEnv: (capability) =>
			definedEnv(getTerminalControlEnv(capability)),
		agentChatMcp: {
			mint: (chatId, reach) => mcpCapabilities.mintChat(chatId, reach),
			revoke: (chatId) => {
				mcpCapabilities.revokeChat(chatId);
			},
			serverEntry: (token) => {
				const command = options.serverCommand();
				return {
					command: command.command,
					args: [...command.args],
					env: {
						...(command.env ?? {}),
						...definedEnv(getTerminalControlEnv({ token })),
					},
				};
			},
			// The dispatcher reports each Terminay call a chat makes, in
			// Terminay's own words, so provider reports of them are not shown.
			notesCalls: true,
		},
		botTerminayMcp: createBotTerminayMcpHost({
			capabilities: mcpCapabilities,
			socketPath: () => {
				try {
					return resolveMcpControlSocketPlacement().path;
				} catch {
					return undefined;
				}
			},
		}),
		serverCommand: () => options.serverCommand(),
		onTerminalExit: (sessionId) => {
			mcpCapabilities.onTerminalExit(sessionId);
		},
		revokeTerminal: (sessionId) => {
			mcpCapabilities.revokeSession(sessionId);
		},
		// The token lives in the running shell and cannot be replaced, so the
		// capability follows its terminal to the new project (ADR-0074). Entering
		// the automation space would widen it to workspace reach, so that revokes.
		onTerminalRehomed: (move) => {
			if (move.targetProjectId === AUTOMATION_SPACE_PROJECT_ID)
				mcpCapabilities.revokeSession(move.sessionId);
			else mcpCapabilities.followTerminal(move.sessionId, move.targetProjectId);
		},
		bind: async (server) => {
			const authority = boundFrom(server);
			boundServer = authority;
			// An approval and a session grant live exactly as long as the calling
			// terminal's capability: exit, move, disable, and restart all end them.
			removeMcpApprovalRevocation?.();
			removeMcpApprovalRevocation = mcpCapabilities.onRevoked(
				(_digest, terminalSessionId) =>
					authority.composition.mcpApprovals.revokeTerminal(terminalSessionId),
			);
			removeTerminalExitObserver?.();
			removeTerminalExitObserver = authority.service.onEvent((event) => {
				if (event.type === 'exit')
					mcpCapabilities.onTerminalExit(event.sessionId);
			});
			bindMcpGateway(authority);
			// Terminals that outlived the previous process still carry the control
			// token they were started with; reinstate its authority for the ones
			// that are running, then keep the saved copy current.
			if (authority.keepsTerminalsAcrossRestart) {
				restoreSavedMcpCapabilities(authority);
				removeMcpCapabilityPersistence?.();
				removeMcpCapabilityPersistence =
					mcpCapabilities.onChanged(saveMcpCapabilities);
				saveMcpCapabilities();
			}
			pruneMcpCapabilities(authority);
			if (mcpCapabilityPruneTimer !== undefined)
				clearInterval(mcpCapabilityPruneTimer);
			mcpCapabilityPruneTimer = setInterval(
				() => pruneMcpCapabilities(authority),
				MCP_CAPABILITY_PRUNE_INTERVAL_MS,
			);
			mcpCapabilityPruneTimer.unref();
			removeMcpSettingsObserver?.();
			removeMcpSettingsObserver = options.onSettingsChange((settings) =>
				applyMcpSetting(settings),
			);
			await startMcpControlEndpoint();
		},
		// Stopping the endpoint revokes every capability. Terminals that are being
		// kept must still hold theirs when the next process starts, so the saved
		// copy stops following before that happens.
		stopPersisting: () => {
			removeMcpCapabilityPersistence?.();
			removeMcpCapabilityPersistence = undefined;
			if (mcpCapabilityPruneTimer !== undefined) {
				clearInterval(mcpCapabilityPruneTimer);
				mcpCapabilityPruneTimer = undefined;
			}
		},
		forgetSaved: () => {
			rmSync(getMcpCapabilityFilePath(), { force: true });
		},
		stop: async () => {
			removeMcpCapabilityPersistence?.();
			removeMcpCapabilityPersistence = undefined;
			if (mcpCapabilityPruneTimer !== undefined) {
				clearInterval(mcpCapabilityPruneTimer);
				mcpCapabilityPruneTimer = undefined;
			}
			removeTerminalExitObserver?.();
			removeTerminalExitObserver = undefined;
			removeMcpApprovalRevocation?.();
			removeMcpApprovalRevocation = undefined;
			removeMcpGatewayBindings?.();
			removeMcpGatewayBindings = undefined;
			await stopMcpControlEndpoint();
		},
	};
}
