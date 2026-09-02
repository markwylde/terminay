import { createServerCore, type ServerCore } from "./connection.js";
import type { JsonValue } from "@terminay/protocol";
import { OrderedEventJournal } from "./events.js";
import {
  createTerminalOperationRegistry,
  type TerminalOperationRegistry,
} from "./terminalService/protocol.js";
import { TerminalServiceAdapter } from "./terminalService/adapter.js";
import { TerminalInputSourceAdapter } from "./terminalService/inputSources.js";
import { TerminalPresentationCheckpointAuthority } from "./terminalService/presentationCheckpoint.js";
import {
  TerminalService,
} from "./terminalService/service.js";
import { TerminalServiceError } from "./terminalService/errors.js";
import {
  createMacroOperationRegistry,
  type MacroOperationRegistry,
} from "./macroService/protocol.js";
import type { MacroRepository, MacroRunner } from "./macroService/index.js";
import type { MacroExecutionEnvironment, MacroTarget } from "./macroService/types.js";
import {
  TERMINAL_CLOSE_OBSERVATION_TIMEOUT_MS,
  type PtyFactory,
  type TerminalServiceOptions,
} from "./terminalService/types.js";
import {
  TerminalLaunchResolver,
  type ShellProfileLaunchAuthority,
  type TerminalLaunchPathAuthority,
} from "./terminalService/launchResolver.js";
import type {
  CommandHandler,
  OperationPolicy,
  OperationRegistries,
  OrderedEventJournalLike,
  QueryHandler,
  ServerCoreOptions,
  ServerConnectionLike,
} from "./types.js";
import { createWorkspaceOperationRegistry, type WorkspaceOperationRegistryOptions } from "./workspaceProtocol.js";
import { WorkspaceStore } from "./workspace.js";
import { createActivityEventProjector, createActivityOperationRegistry, type ActivityOperationRegistry } from "./activity/protocol.js";
import { createAgentEventProjector, createAgentOperationRegistry, type AgentOperationRegistry } from "./activity/agentProtocol.js";
import type { TerminalActivityService } from "./activity/service.js";
import { AgentStatusService } from "./activity/agentService.js";
import { ExtensionAgentRuntimeRegistry } from "./activity/extensionAgentRuntime.js";
import type { TerminalSessionLifecycle } from "./terminalService/types.js";
import { createAiOperationHandlers, type AiService } from "./aiService/index.js";
import type { ServerGitAdapter } from "./gitService/adapter.js";
import type { RecordingAdapter } from "./recordingService/adapter.js";
import { createSettingsOperationRegistry, type SettingsOperationRegistry } from "./settings/protocol.js";
import type { ServerSettingsRepository } from "./settings/repository.js";
import { createEnvironmentRoutedPtyFactory, createProjectEnvironmentOperationHandlers, routeProjectOperationRegistries, type ProjectEnvironmentOperationOptions, type ProjectEnvironmentRouter } from "./projectEnvironment/index.js";
import { createFileObservationEventProjector, type ServerFileObservationAdapter } from "./fileService/observationAdapter.js";
import {
  createShellProfileOperationRegistry,
  type ShellProfileCatalogueService,
  type ShellStartupMode,
} from "./shellProfiles/index.js";
import { createExtensionOperationHandlers, type ExtensionOperationOptions } from "./extensions/index.js";

/**
 * Internal lifecycle evidence emitted by a host PTY adapter when foreground
 * process observation is available. It deliberately remains outside the
 * terminal protocol: it is input to server-owned agent reconciliation, not
 * terminal output or client-visible state.
 */
export interface TerminalForegroundProcessLifecycle {
  readonly foregroundProcessChanged?: (
    identity: import("./terminalService/types.js").TerminalIdentity,
    event: Readonly<{
      processName: string;
      shellForeground: boolean;
      observation?: "available" | "limited";
    }>,
  ) => void;
}

export type ComposedTerminalSessionLifecycle = TerminalSessionLifecycle & TerminalForegroundProcessLifecycle;

/** All dispatch tables are present so a transport adapter can pass this
 * registry directly to ServerCore without filling in optional fields. */
export interface CompleteServerCoreOperationRegistry {
  readonly queries: ReadonlyMap<string, QueryHandler>;
  readonly commands: ReadonlyMap<string, CommandHandler>;
  readonly policies: ReadonlyMap<string, OperationPolicy>;
}

/**
 * Host-neutral inputs for composing one server authority.
 *
 * The PTY implementation is deliberately injected. An embedded Desktop host
 * can adapt node-pty (or a test double) without making this package aware of
 * Electron, windows, renderers, or MessagePort. `operations` is the extension
 * point for other server-owned services; terminal operations are always added
 * by this factory.
 */
export interface ServerCoreCompositionOptions
  extends Omit<
    ServerCoreOptions,
    "queries" | "commands" | "policies" | "eventJournal" | "onConnectionClosed"
  > {
  /** Existing service for hosts that have already composed the PTY factory. */
  readonly terminalService?: TerminalService;
  /** Used to create the server-owned service when `terminalService` is absent. */
  readonly ptyFactory?: PtyFactory;
  /** Additional TerminalService limits/hooks, excluding its identity/factory. */
  readonly terminalOptions?: Omit<TerminalServiceOptions, "serverId" | "ptyFactory">;
  /** Server-owned shell catalogue used to build the canonical launch resolver. */
  readonly terminalProfiles?: ShellProfileLaunchAuthority;
  /** Concrete server profile authority. When supplied its privileged
   * catalogue/mutation operations are composed alongside terminal launch. */
  readonly shellProfiles?: ShellProfileCatalogueService;
  readonly terminalLaunchPathAuthority?: TerminalLaunchPathAuthority;
  readonly terminalLaunchEnvironment?: Readonly<Record<string, string | undefined>>;
  /** Host-owned, per-session launch environment reserved for ephemeral
   * authority material such as local control capabilities. */
  readonly terminalLaunchEnvironmentFor?: import("./terminalService/launchResolver.js").TerminalLaunchResolverOptions["environmentFor"];
  readonly terminalEnvironmentCaseInsensitive?: boolean;
  readonly terminalSystemDefaultStartupMode?: ShellStartupMode;
	/** @internal Explicit escape hatch for low-level composition tests only. */
	readonly allowUnresolvedTestSessions?: boolean;
  /** Optional adapters supplied by a host; defaults are server-owned. */
  readonly terminalAttachments?: TerminalServiceAdapter;
  readonly terminalInputSources?: TerminalInputSourceAdapter;
  /** Bounded canonical emulator used for fresh terminal presentation recovery.
   * Hosts that inject a TerminalService supply the same authority to the
   * service and this composition; normal compositions create one here. */
  readonly presentationCheckpoints?: TerminalPresentationCheckpointAuthority;
  /** Optional canonical workspace authority. When supplied, workspace
   * queries and authenticated project.move commands are composed into the
   * same server dispatcher as terminal operations. */
  readonly workspace?: WorkspaceStore;
  readonly workspaceOperations?: WorkspaceOperationRegistryOptions;
  /** Optional canonical terminal activity authority exposed through the same
   * authenticated protocol and ordered event journal as terminal streams. */
  readonly activity?: TerminalActivityService;
  /** Optional server-owned provider-journal and agent status authority. It shares
   * the terminal lifecycle with activity; it is never a renderer service. */
  readonly agents?: AgentStatusService;
  /** Optional extension-backed agent admission authority. It claims an exact
   * terminal incarnation before an installed provider can publish sidebar
   * lifecycle state; generic terminal activity remains the fallback. */
  readonly extensionAgentRuntime?: ExtensionAgentRuntimeRegistry;
  /** Other server-owned operation handlers to merge with terminal handlers. */
  readonly operations?: OperationRegistries;
  /** Optional selected-server extension manager. Fixed operations are merged
   * into every transport and changes use the canonical ordered event stream. */
  readonly extensions?: Omit<ExtensionOperationOptions, "onChanged">;
  /** Optional server-owned macro repository, runner, and exact PTY/vault environment. */
  readonly macros?: {
    readonly repository: MacroRepository;
    readonly runner?: MacroRunner;
    readonly environmentFor: (request: import("./types.js").CommandRequest, target: MacroTarget) => MacroExecutionEnvironment;
  };
  /** Optional server-owned AI authority exposed identically by embedded,
   * local HTTP, and framed transports. */
  readonly ai?: AiService;
  /** Optional server-owned Git protocol authority. */
  readonly git?: ServerGitAdapter;
  /** Optional server-owned recording protocol authority. */
  readonly recordings?: RecordingAdapter;
  /** Optional durable server settings authority. No settings capability is
   * registered when a host has not supplied a concrete repository. */
  readonly settings?: ServerSettingsRepository;
  /** Optional project-scoped filesystem watch and folder-size authority. */
  readonly fileObservations?: ServerFileObservationAdapter;
  /** Canonical environment router. When present every project-scoped file,
   * Git, observation, agent and shell operation is routed before a local host
   * adapter can run. */
  readonly projectEnvironmentRouter?: ProjectEnvironmentRouter;
  /** Canonical selected-server environment management authority. */
  readonly projectEnvironments?: Omit<ProjectEnvironmentOperationOptions, 'workspace' | 'onChanged'>;
  /** Host-neutral startup/cleanup for optional authorities that require
   * asynchronous binding before any transport listener becomes ready. */
  readonly serviceLifecycle?: {
    readonly start?: () => void | Promise<void>;
    readonly stop?: () => void | Promise<void>;
  };
  /** Shared ordered journal used by terminal events and ServerConnection. */
  readonly eventJournal?: OrderedEventJournalLike;
  /** Host observer invoked after terminal connection cleanup is performed. */
  readonly onConnectionClosed?: (connectionId: string, clientId: string) => void;
}

/**
 * The complete server-side surface needed by a transport adapter.
 *
 * A future Electron MessagePort adapter only needs `core.accept(transport)`;
 * it does not need to know how PTYs, attachments, journals, or operation
 * maps were composed. `coreOptions` and `operations` are exposed for hosts
 * that need to pass the canonical registry to another transport-neutral
 * endpoint such as the local UI server.
 */
export interface ServerCoreComposition {
  readonly core: ServerCore;
  readonly coreOptions: ServerCoreOptions;
  readonly operations: CompleteServerCoreOperationRegistry;
  readonly eventJournal: OrderedEventJournalLike;
  readonly terminal: TerminalService;
  readonly terminalLaunchResolver?: TerminalLaunchResolver;
  readonly workspace?: WorkspaceStore;
  readonly activity?: TerminalActivityService;
  readonly agents?: AgentStatusService;
  readonly extensionAgentRuntime?: ExtensionAgentRuntimeRegistry;
  readonly activityOperations?: ActivityOperationRegistry;
  readonly agentOperations?: AgentOperationRegistry;
  readonly terminalOperations: TerminalOperationRegistry;
  readonly macroOperations?: MacroOperationRegistry;
  readonly settingsOperations?: SettingsOperationRegistry;
  readonly shellProfileOperations?: ReturnType<typeof createShellProfileOperationRegistry>;
  readonly workspaceOperations?: import("./workspaceProtocol.js").WorkspaceOperationRegistry;
  /** Start host-facing services that must be live before a terminal is
   * created. The composition, not ServerRuntime, owns these instances. */
  readonly start: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

/**
 * Compose the server-owned terminal authority and the canonical ServerCore.
 *
 * Operation-name collisions are rejected instead of silently choosing one
 * handler. That keeps a Desktop host from accidentally shadowing a privileged
 * terminal operation while it incrementally adds the remaining services.
 */
export function createServerCoreComposition(
  options: ServerCoreCompositionOptions,
): ServerCoreComposition {
  const presentationCheckpoints =
    options.presentationCheckpoints ??
    options.terminalOptions?.presentationCheckpoints ??
    (options.terminalService === undefined
      ? new TerminalPresentationCheckpointAuthority()
      : undefined);
  const terminal = composeTerminal({
    ...options,
    ...(presentationCheckpoints === undefined || options.terminalService !== undefined
      ? {}
      : {
          terminalOptions: {
            ...options.terminalOptions,
            presentationCheckpoints,
          },
        }),
  });
  if (terminal.serverId !== options.serverId) {
    throw new TypeError("terminal service server id does not match server core identity");
  }

  const eventJournal = options.eventJournal ?? new OrderedEventJournal();
  if (options.terminalProfiles !== undefined && options.workspace === undefined) {
    throw new TypeError("workspace is required for canonical terminal launch resolution");
  }
  const terminalLaunchResolver = options.terminalProfiles === undefined || options.workspace === undefined
    ? undefined
    : new TerminalLaunchResolver({
        serverId: options.serverId,
        profiles: options.terminalProfiles,
        workspaceSnapshot: () => options.workspace?.state as import("./workspace.js").WorkspaceState,
		...(options.projectEnvironmentRouter === undefined ? {} : { projectEnvironmentRouter: options.projectEnvironmentRouter }),
        observeTerminalCwd: async (sessionId) => {
          const session = terminal.getSession(sessionId);
          return session === undefined ? null : (await terminal.currentCwd(session)).cwd;
        },
        ...(options.terminalLaunchPathAuthority === undefined ? {} : { pathAuthority: options.terminalLaunchPathAuthority }),
        ...(options.terminalLaunchEnvironment === undefined ? {} : { defaultEnvironment: options.terminalLaunchEnvironment }),
        ...(options.terminalLaunchEnvironmentFor === undefined ? {} : { environmentFor: options.terminalLaunchEnvironmentFor }),
        ...(options.terminalEnvironmentCaseInsensitive === undefined ? {} : { environmentCaseInsensitive: options.terminalEnvironmentCaseInsensitive }),
        ...(options.terminalSystemDefaultStartupMode === undefined ? {} : { systemDefaultStartupMode: options.terminalSystemDefaultStartupMode }),
      });
	if (terminalLaunchResolver === undefined && options.allowUnresolvedTestSessions !== true) {
		throw new TypeError("terminalProfiles and workspace are required for production terminal composition");
	}
  const unsubscribeGitEvents =
    typeof options.git?.subscribeEvents === "function"
      ? options.git.subscribeEvents((event) => {
          eventJournal.append(event.type, event as unknown as JsonValue);
        })
      : undefined;
  const workspaceOperations = options.workspace === undefined
    ? undefined
    : createWorkspaceOperationRegistry(options.workspace, {
        ...options.workspaceOperations,
		...(options.workspaceOperations?.prepareProjectRootUpdate === undefined || options.projectEnvironmentRouter === undefined
			? {}
			: { prepareProjectRootUpdate: (projectId: string, root: string) => prepareRoutedProjectRoot(options.projectEnvironmentRouter!, options.workspaceOperations!.prepareProjectRootUpdate!, projectId, root) }),
        closeTerminalSessions: async (sessionIds) => {
          await Promise.allSettled(sessionIds.map((sessionId) => terminal.kill(sessionId)));
          await options.workspaceOperations?.closeTerminalSessions?.(sessionIds);
        },
        closeProjectTerminalSessions: async (sessionIds) => {
          await options.workspaceOperations?.closeProjectTerminalSessions?.(sessionIds);
        },
        eventJournal,
        ...(options.shellProfiles === undefined ? {} : { shellProfileExists: (profileId: string) => options.shellProfiles?.isDurableProfile(profileId) ?? false }),
      });
  terminal.onEvent((event) => {
    if (event.type !== "exit") return;
    workspaceOperations?.applyHostCommand(
      `terminal-exit:${event.sessionId}`.slice(0, 128),
      {
        type: "terminal.markExited",
        sessionId: event.sessionId,
        exitCode: event.exitCode,
      },
    );
  });
  const macroOperations = options.macros === undefined ? undefined : createMacroOperationRegistry({
    serverId: options.serverId,
    repository: options.macros.repository,
    ...(options.macros.runner === undefined ? {} : { runner: options.macros.runner }),
    eventJournal,
    environmentFor: options.macros.environmentFor,
  });
  const terminalOperations = createTerminalOperationRegistry({
    service: terminal,
    eventJournal,
    ...(presentationCheckpoints === undefined ? {} : { checkpoints: presentationCheckpoints }),
    ...(terminalLaunchResolver === undefined ? {} : { launchResolver: terminalLaunchResolver }),
		...(options.allowUnresolvedTestSessions === true ? { allowUnresolvedTestSessions: true } : {}),
    ...(options.maxTerminalUnconfirmedBytes === undefined
      ? {}
      : { maxTerminalUnconfirmedBytes: options.maxTerminalUnconfirmedBytes }),
    ...(options.workspace === undefined
      ? {}
      : {
          onSessionCreated: (session: import("./terminalService/types.js").TerminalSessionSnapshot): void => {
            const workspace = options.workspace;
            if (workspace === undefined) return;
            let state = workspace.state;
            if (state.projects[session.projectId] === undefined) {
              const viewId = state.viewOrder[0];
              if (viewId === undefined) throw new Error("workspace has no view for terminal project");
              const created = workspaceOperations?.applyHostCommand(
                `tp:${session.sessionId}`.slice(0, 128),
                {
                  type: "project.create",
                  projectId: session.projectId,
                  viewId,
                  root: session.cwd,
                  name: session.projectId,
                },
              );
              if (created === undefined) throw new Error("workspace operation registry is unavailable");
              if (!created.ok) throw new Error(created.conflict.message);
              state = created.state;
            }
            if (state.terminalSessions[session.sessionId] === undefined) {
              const panelCount = Object.values(state.panels)
                .filter((panel) => panel.projectId === session.projectId && panel.type === "terminal")
                .length;
              const created = workspaceOperations?.applyHostCommand(
                `tcp:${session.sessionId}`.slice(0, 128),
                {
                  type: "terminal.createPanel",
                  sessionId: session.sessionId,
                  projectId: session.projectId,
                  panelId: `p:${session.sessionId}`.slice(0, 128),
                  title: `Terminal ${panelCount + 1}`,
                  cwd: session.cwd,
                  createdAt: session.createdAt,
                  ...(session.launch === undefined ? {} : { launch: session.launch }),
                },
              );
              if (created === undefined) throw new Error("workspace operation registry is unavailable");
              if (!created.ok) throw new Error(created.conflict.message);
              state = created.state;
            }
            if (!Object.values(state.panels).some((panel) => panel.type === "terminal" && panel.sessionId === session.sessionId)) {
              const panelCount = Object.values(state.panels)
                .filter((panel) => panel.projectId === session.projectId && panel.type === "terminal")
                .length;
              const created = workspaceOperations?.applyHostCommand(
                `pc:${session.sessionId}`.slice(0, 128),
                {
                  type: "panel.create",
                  panel: {
                    id: `p:${session.sessionId}`.slice(0, 128),
                    projectId: session.projectId,
                    type: "terminal",
                    sessionId: session.sessionId,
                    title: `Terminal ${panelCount + 1}`,
                    cwd: session.cwd,
                    createdAt: session.createdAt,
                  },
                },
              );
              if (created === undefined) throw new Error("workspace operation registry is unavailable");
              if (!created.ok) throw new Error(created.conflict.message);
            }
          },
        }),
    ...(options.terminalAttachments === undefined
      ? {}
      : { attachments: options.terminalAttachments }),
    ...(options.terminalInputSources === undefined
      ? {}
      : { inputSources: options.terminalInputSources }),
  });
  const activityOperations = options.activity === undefined
    ? undefined
    : createActivityOperationRegistry({
        service: options.activity,
        eventJournal,
        observeForeground: async (request, scope) => {
          const readScope = request.context.authScope === "none" ? "none" as const : "read" as const;
          const authorization = {
            serverId: terminal.serverId,
            projectId: scope.projectId,
            clientId: request.context.clientId,
            scope: readScope,
          };
          try {
            if (scope.sessionId !== undefined) {
              const snapshot = terminal.getSession(scope.sessionId);
              if (snapshot === undefined || snapshot.status !== "running") {
                return [{
                  sessionId: scope.sessionId,
                  projectId: scope.projectId,
                  observation: "available" as const,
                  foregroundBusy: false,
                }];
              }
              return [await terminal.observeForegroundProcess(
                scope.sessionId,
                {
                  ...authorization,
                  projectId: snapshot.projectId,
                  sessionId: scope.sessionId,
                },
                TERMINAL_CLOSE_OBSERVATION_TIMEOUT_MS,
              )];
            }
            return [...await terminal.observeProjectForegroundProcesses(
              scope.projectId,
              authorization,
              TERMINAL_CLOSE_OBSERVATION_TIMEOUT_MS,
            )];
          } catch (error) {
            if (error instanceof TerminalServiceError && (error.code === "session_not_found" || error.code === "session_exited" || error.code === "session_interrupted")) {
              return [{
                sessionId: scope.sessionId ?? "",
                projectId: scope.projectId,
                observation: "available" as const,
                foregroundBusy: false,
              }].filter((observation) => observation.sessionId.length > 0);
            }
            if (scope.sessionId !== undefined) {
              return [{
                sessionId: scope.sessionId,
                projectId: scope.projectId,
                observation: "limited" as const,
                foregroundBusy: false,
                observationError: "failed" as const,
              }];
            }
            return [];
          }
        },
      });
  const agentOperations = options.agents === undefined
    ? undefined
    : createAgentOperationRegistry({ service: options.agents, eventJournal });
  const aiOperations = options.ai === undefined ? undefined : createAiOperationHandlers(options.ai);
  const gitOperations = options.git?.operations();
  const recordingOperations = options.recordings?.operations();
  if (options.recordings !== undefined) {
    terminal.onEvent((event) => {
      if (event.type === "output" && !event.replay) {
        options.recordings?.service.appendOutput(event.sessionId, new TextDecoder().decode(event.bytes));
      } else if (event.type === "exit") {
        options.recordings?.service.finalize(event.sessionId, event.exitCode, event.signal);
      }
    });
  }
  const settingsOperations = options.settings === undefined
    ? undefined
    : createSettingsOperationRegistry(options.settings, eventJournal);
  const shellProfileOperations = options.shellProfiles === undefined
    ? undefined
    : createShellProfileOperationRegistry(options.shellProfiles);
  const extensionOperations = options.extensions === undefined ? undefined : createExtensionOperationHandlers({
    ...options.extensions,
    onChanged: (payload) => { eventJournal.append("extensions.changed", payload); },
  });
  const projectEnvironmentOperations = options.projectEnvironments === undefined || options.workspace === undefined ? undefined : createProjectEnvironmentOperationHandlers({
    ...options.projectEnvironments,
    workspace: options.workspace,
	...(options.workspaceOperations?.prepareProjectRootUpdate === undefined
		? {}
		: {
				// Project-environment creation prepares the built-in This-server
				// root before its workspace object exists; routing by project id at
				// that point would reject the legitimate new identity.
				prepareProjectRootUpdate:
					options.workspaceOperations.prepareProjectRootUpdate,
			}),
    ...(options.projectEnvironments.providerDefinitions !== undefined || options.extensions?.hosts === undefined ? {} : { providerDefinitions: () => options.extensions!.hosts!.statuses().flatMap((status) => status.providers ?? []) }),
    ...(options.projectEnvironments.providerRuntime !== undefined || options.extensions?.hosts === undefined ? {} : { providerRuntime: options.extensions.hosts }),
    onChanged: (payload) => { eventJournal.append('project-environments.changed', payload); },
  });
  const operations = mergeOperationRegistries(
    mergeOperationRegistries(mergeOperationRegistries(
      mergeOperationRegistries(
        mergeOperationRegistries(
          mergeOperationRegistries(mergeOperationRegistries(mergeOperationRegistries(options.operations ?? {}, extensionOperations ?? {}), projectEnvironmentOperations ?? {}), options.fileObservations?.operations ?? {}),
          macroOperations?.operations ?? {},
        ),
        workspaceOperations?.operations ?? {},
      ),
      mergeOperationRegistries(activityOperations?.operations ?? {}, agentOperations?.operations ?? {}),
    ), mergeOperationRegistries(aiOperations ?? {}, gitOperations ?? {})),
    mergeOperationRegistries(
      mergeOperationRegistries(recordingOperations ?? {}, settingsOperations?.operations ?? {}),
      shellProfileOperations?.operations ?? {},
    ),
  );
  const routedOperations = options.projectEnvironmentRouter === undefined
    ? operations
    : routeProjectOperationRegistries(operations, options.projectEnvironmentRouter);
  const completeOperations = mergeOperationRegistries(
    routedOperations,
    terminalOperations.operations,
  );
  const onConnectionClosed = (connectionId: string, clientId: string): void => {
    terminalOperations.closeConnection(connectionId);
    macroOperations?.closeConnection(connectionId);
    options.fileObservations?.closeConnection(connectionId);
    options.onConnectionClosed?.(connectionId, clientId);
  };
  const coreOptions: ServerCoreOptions = {
    serverId: options.serverId,
    serverVersion: options.serverVersion,
    capabilities: uniqueCapabilities(options),
    eventJournal,
    ...(options.activity === undefined && options.agents === undefined && options.fileObservations === undefined
      ? {}
      : { projectEvent: composeProjectEventProjectors(
        options.activity === undefined ? undefined : createActivityEventProjector(options.activity),
        options.agents === undefined ? undefined : createAgentEventProjector(options.agents),
        options.fileObservations === undefined ? undefined : createFileObservationEventProjector,
      ) }),
    ...optionalCoreOptions(options),
    ...completeOperations,
    onConnectionClosed,
		onTerminalCongestion: (attachmentId, clientId, connectionId) => {
			terminalOperations.suppressOutput(attachmentId, connectionId);
			options.onTerminalCongestion?.(attachmentId, clientId, connectionId);
		},
  };
  const baseCore = createServerCore(coreOptions);
  const connections = new Set<ServerConnectionLike>();
  const core: ServerCore = {
    accept: (transport, connectionOptions) => {
		let connection: ReturnType<typeof baseCore.accept>;
		connection = baseCore.accept(transport, {
			...connectionOptions,
			onClosed: () => { connections.delete(connection); connectionOptions?.onClosed?.(); },
		});
      connections.add(connection);
      return connection;
    },
  };
	let lifecycle: "created" | "starting" | "ready" | "stopping" | "stopped" | "failed" = "created";
	let startPromise: Promise<void> | undefined;
	let shutdownPromise: Promise<void> | undefined;
	// Durable provider operations belong to the server, not to whichever client
	// happens to open the Project Environments view. Keep a server-owned context
	// for startup recovery so a Puzed job can advance after an embedded server
	// restart even when no renderer has connected yet.
	const environmentRecoveryAbort = new AbortController();
	const environmentRecoveryContext = {
		connectionId: `server:${options.serverId}`,
		clientId: `server:${options.serverId}`,
		authScope: "admin" as const,
		permissions: ["environments:read", "environments:manage"],
		signal: environmentRecoveryAbort.signal,
	};
	const start = (): Promise<void> => {
		if (lifecycle === "ready") return Promise.resolve();
		if (lifecycle === "starting" && startPromise !== undefined) return startPromise;
		if (lifecycle === "stopping" || lifecycle === "stopped") return Promise.reject(new Error(`server composition is ${lifecycle}`));
		lifecycle = "starting";
		startPromise = (async () => {
			try {
				if (options.extensions?.initialize !== undefined) await options.extensions.initialize();
				else {
					await options.extensions?.installer.initialize();
					await options.extensions?.activateEnabled?.();
				}
				// Extensions provide the runtime required to resume their durable
				// operations, so recovery must follow activation but precede normal
				// client-facing service startup.
				// A VM can still be waiting for SSH when the server starts. Recovery is
				// durable background work, not a prerequisite for serving the workspace;
				// blocking here made the entire desktop appear unable to open.
				void projectEnvironmentOperations?.recoverPending(environmentRecoveryContext).catch(() => undefined);
				await options.settings?.load();
				await options.serviceLifecycle?.start?.();
				await options.agents?.start();
				if (lifecycle === "starting") lifecycle = "ready";
			} catch (error) {
				if (lifecycle === "starting") lifecycle = "failed";
				throw error;
			}
		})();
		return startPromise;
	};
	const shutdown = (): Promise<void> => {
		if (shutdownPromise !== undefined) return shutdownPromise;
		if (lifecycle === "stopped") return Promise.resolve();
		lifecycle = "stopping";
		shutdownPromise = (async () => {
			// If startup was still binding a hook receiver, wait for it before
			// teardown so it cannot resurrect after shutdown begins.
			environmentRecoveryAbort.abort();
			await startPromise?.catch(() => undefined);
			const failures: unknown[] = [];
			const attempt = async (operation: () => Promise<unknown> | unknown): Promise<void> => {
				try { await operation(); } catch (error) { failures.push(error); }
			};
			await attempt(() => Promise.allSettled([...connections].map((connection) => connection.close())));
			connections.clear();
			await attempt(() => options.extensionAgentRuntime?.drain("server-stopping"));
			// Terminal exit is a final agent lifecycle input, so terminal stops
			// before the agent service. Every later cleanup still runs if it fails.
			await attempt(() => terminal.shutdown());
			await attempt(() => presentationCheckpoints?.close());
			await attempt(() => options.recordings?.service.shutdown());
			await attempt(() => options.serviceLifecycle?.stop?.());
			await attempt(() => unsubscribeGitEvents?.());
			await attempt(() => options.git?.close?.());
			await attempt(() => options.agents?.stop());
			await attempt(() => activityOperations?.close());
			await attempt(() => agentOperations?.close());
			await attempt(() => options.fileObservations?.close());
			await attempt(() => options.activity?.shutdown());
			lifecycle = "stopped";
			if (failures.length > 0) throw cleanupFailure("server composition shutdown failed", failures);
		})();
		return shutdownPromise;
	};

  return {
    core,
    coreOptions,
    operations: completeOperations,
    eventJournal,
    terminal,
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    ...(workspaceOperations === undefined ? {} : { workspaceOperations }),
    ...(options.activity === undefined ? {} : { activity: options.activity }),
    ...(options.agents === undefined ? {} : { agents: options.agents }),
    ...(options.extensionAgentRuntime === undefined ? {} : { extensionAgentRuntime: options.extensionAgentRuntime }),
    ...(activityOperations === undefined ? {} : { activityOperations }),
    ...(agentOperations === undefined ? {} : { agentOperations }),
    terminalOperations,
    ...(terminalLaunchResolver === undefined ? {} : { terminalLaunchResolver }),
    ...(macroOperations === undefined ? {} : { macroOperations }),
    ...(settingsOperations === undefined ? {} : { settingsOperations }),
    ...(shellProfileOperations === undefined ? {} : { shellProfileOperations }),
    start,
    shutdown,
  };
}

async function prepareRoutedProjectRoot(
	router: ProjectEnvironmentRouter,
	local: NonNullable<WorkspaceOperationRegistryOptions['prepareProjectRootUpdate']>,
	projectId: string,
	root: string,
): Promise<import('./workspaceProtocol.js').PreparedProjectRootUpdate> {
	return router.route(projectId, 'filesystem', 'prepare-project-root', { root }, () => local(projectId, root)).then((prepared) => {
		if (typeof prepared === 'object' && prepared !== null && 'commit' in prepared && typeof prepared.commit === 'function') return prepared as import('./workspaceProtocol.js').PreparedProjectRootUpdate;
		const remote = prepared as { readonly canonicalRoot?: unknown; readonly preparationId?: unknown };
		if (typeof remote.canonicalRoot !== 'string' || typeof remote.preparationId !== 'string') throw new Error('project environment returned an invalid prepared root');
		return {
			canonicalRoot: remote.canonicalRoot,
			commit: async () => { await router.invoke(projectId, 'filesystem', 'commit-project-root', { preparationId: remote.preparationId }); },
		};
	});
}

function cleanupFailure(message: string, failures: readonly unknown[]): Error {
	const error = new Error(message);
	Object.defineProperty(error, "errors", { value: [...failures], enumerable: false });
	return error;
}

function composeTerminal(options: ServerCoreCompositionOptions): TerminalService {
  if (options.terminalService !== undefined && options.ptyFactory !== undefined) {
    throw new TypeError("provide terminalService or ptyFactory, not both");
  }
  if (options.terminalService !== undefined) {
    if (!(options.terminalService instanceof TerminalService)) {
      throw new TypeError("terminalService must be a TerminalService");
    }
    bindTerminalActivity(options.terminalService, options.activity);
    return options.terminalService;
  }
  if (options.ptyFactory === undefined) {
    throw new TypeError("ptyFactory is required when terminalService is absent");
  }
  const terminalOptions = options.terminalOptions ?? {};
  const terminal = new TerminalService({
    ...terminalOptions,
    serverId: options.serverId,
    ptyFactory: options.projectEnvironmentRouter === undefined
		? options.ptyFactory
		: createEnvironmentRoutedPtyFactory(options.projectEnvironmentRouter, options.ptyFactory),
    ...((options.activity === undefined && options.agents === undefined && options.extensionAgentRuntime === undefined)
      ? {}
      : { sessionLifecycle: composeActivityLifecycle(options.activity, options.agents, terminalOptions.sessionLifecycle, options.extensionAgentRuntime) }),
  });
  bindTerminalActivity(terminal, options.activity);
  return terminal;
}

/** Bind the PTY byte boundary to canonical activity exactly once. This is
 * server composition, never a renderer callback; raw bytes stay untouched. */
function bindTerminalActivity(terminal: TerminalService, activity: TerminalActivityService | undefined): void {
  if (activity === undefined) return;
  for (const session of terminal.listSessions()) ensureActivitySession(activity, session);
  terminal.onInput((identity, bytes) => {
    if (isTerminalFocusReport(bytes)) return;
    ensureActivitySession(activity, identity);
    activity.ingestSignal(identity, { kind: "userInput" });
  });
  terminal.onEvent((event) => {
    const identity = { serverId: event.serverId, projectId: event.projectId, sessionId: event.sessionId };
    ensureActivitySession(activity, identity);
    if (event.type === "output") activity.ingestPtyOutput(identity, event.bytes);
    else if (event.type === "exit") activity.markExited(identity);
  });
}

function isTerminalFocusReport(bytes: Uint8Array): boolean {
  return bytes.byteLength === 3
    && bytes[0] === 0x1b
    && bytes[1] === 0x5b
    && (bytes[2] === 0x49 || bytes[2] === 0x4f);
}

export function composeActivityLifecycle(
  activity: TerminalActivityService | undefined,
  agents: AgentStatusService | undefined,
  lifecycle: ComposedTerminalSessionLifecycle | undefined,
  extensionAgents?: ExtensionAgentRuntimeRegistry,
): ComposedTerminalSessionLifecycle {
  return {
    prepareTerminalSession: (identity) => {
      if (activity !== undefined) ensureActivitySession(activity, identity);
      agents?.register(identity);
      extensionAgents?.register(identity);
      const hostEnvironment = lifecycle?.prepareTerminalSession(identity) ?? {};
      return { ...hostEnvironment };
    },
    terminalStarted: (identity, shellPid) => {
      agents?.terminalStarted(identity, shellPid);
      extensionAgents?.terminalStarted(identity, shellPid);
      lifecycle?.terminalStarted?.(identity, shellPid);
    },
    terminalInput: (identity) => {
      lifecycle?.terminalInput?.(identity);
    },
    terminalExited: (identity, exit) => {
      if (activity !== undefined) {
        try { activity.markExited(identity); } catch { /* terminal exit remains authoritative */ }
      }
      extensionAgents?.terminalExited(identity);
      agents?.terminalExited(identity, exit);
      lifecycle?.terminalExited(identity, exit);
    },
    foregroundProcessChanged: (identity, event) => {
      // Foreground observation is trusted host lifecycle input. It does not
      // cross the terminal event stream or any renderer-controlled boundary.
      if (activity !== undefined) {
        try {
          activity.ingestSignal(identity, event.observation === "limited"
            ? { kind: "foreground", observation: "limited" }
            : {
                kind: "foreground",
                busy: !event.shellForeground,
                processName: event.processName,
              });
        } catch {
          // Foreground observation cannot change PTY supervision.
        }
      }
      extensionAgents?.foregroundProcessChanged(identity, event.processName, event.shellForeground);
      agents?.foregroundProcessChanged(identity, event.processName, event.shellForeground);
      lifecycle?.foregroundProcessChanged?.(identity, event);
    },
  };
}

function ensureActivitySession(
  activity: TerminalActivityService,
  identity: { readonly serverId: string; readonly projectId: string; readonly sessionId: string },
): void {
  activity.register(identity);
}

function optionalCoreOptions(
  options: ServerCoreCompositionOptions,
): Pick<
  ServerCoreOptions,
  | "authenticate"
  | "limits"
  | "maxConnections"
  | "maxTerminalUnconfirmedBytes"
  | "defaultQueryScope"
  | "defaultCommandScope"
> {
  return {
    ...(options.authenticate === undefined ? {} : { authenticate: options.authenticate }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
    ...(options.maxTerminalUnconfirmedBytes === undefined
      ? {}
      : { maxTerminalUnconfirmedBytes: options.maxTerminalUnconfirmedBytes }),
    ...(options.defaultQueryScope === undefined
      ? {}
      : { defaultQueryScope: options.defaultQueryScope }),
    ...(options.defaultCommandScope === undefined
      ? {}
      : { defaultCommandScope: options.defaultCommandScope }),
  };
}

function uniqueCapabilities(options: ServerCoreCompositionOptions): readonly string[] {
  return Object.freeze([...new Set([
    ...options.capabilities,
    "terminal",
    ...(options.macros === undefined ? [] : ["macros"]),
    ...(options.ai === undefined ? [] : ["ai"]),
    ...(options.git === undefined ? [] : ["git"]),
    ...(options.recordings === undefined ? [] : ["recordings"]),
    ...(options.settings === undefined ? [] : ["settings"]),
    ...(options.shellProfiles === undefined ? [] : ["shell-profiles"]),
    ...(options.fileObservations === undefined ? [] : ["files.observe"]),
  ])]) as readonly string[];
}

function composeProjectEventProjectors(
  ...projectors: readonly (NonNullable<ServerCoreOptions["projectEvent"]> | undefined)[]
): NonNullable<ServerCoreOptions["projectEvent"]> {
  return (event, client) => {
    let current: import("./types.js").OrderedEvent | undefined = event;
    for (const projector of projectors) {
      if (projector === undefined || current === undefined) continue;
      current = projector(current, client);
    }
    return current;
  };
}

function mergeOperationRegistries(
  extension: OperationRegistries,
  terminal: OperationRegistries,
): CompleteServerCoreOperationRegistry {
  const queries = mergeEntries("query", extension.queries, terminal.queries);
  const commands = mergeEntries("command", extension.commands, terminal.commands);
  for (const operation of queries.keys()) {
    if (commands.has(operation)) throw new TypeError(`operation is registered as both query and command: ${operation}`);
  }
  return {
    queries,
    commands,
    policies: mergeEntries("policy", extension.policies, terminal.policies),
  };
}

function mergeEntries<T>(
  kind: string,
  first: ReadonlyMap<string, T> | Record<string, T> | undefined,
  second: ReadonlyMap<string, T> | Record<string, T> | undefined,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const [name, handler] of entries(first)) result.set(name, handler);
  for (const [name, handler] of entries(second)) {
    if (result.has(name)) throw new TypeError(`${kind} operation is registered more than once: ${name}`);
    result.set(name, handler);
  }
  return result;
}

function entries<T>(
  value: ReadonlyMap<string, T> | Record<string, T> | undefined,
): readonly (readonly [string, T])[] {
  if (value === undefined) return [];
  if (typeof (value as ReadonlyMap<string, T>).get === "function") {
    return [...(value as ReadonlyMap<string, T>).entries()];
  }
  return Object.entries(value as Record<string, T>);
}
