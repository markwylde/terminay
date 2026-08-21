import {
  type ActivityEvent,
  type ActivitySnapshot,
  TerminalActivityService,
  type TerminalAuthorization,
  type TerminalEvent,
  type TerminalLaunchResolver,
  TerminalService,
  type TerminalSessionSnapshot,
  type WorkspacePanel,
  WorkspaceRepository,
  type WorkspaceRepository as WorkspaceRepositoryType,
} from "@terminay/server-core";
import { ControlEndpointError, type ControlRequestContext } from "./controlEndpoint.js";
import type { OpenTerminalParams, ReadTerminalParams, RenameTerminalParams, RunCommandParams, SplitTerminalParams, TerminalControlAdapter, TerminalParams, WaitForIdleParams, WaitParams, WriteTerminalParams } from "./dispatcher.js";

export interface ServerTerminalControlAdapterOptions {
  readonly terminal: TerminalService;
  /** Canonical server-owned shell/profile/cwd launch authority. */
  readonly launchResolver: TerminalLaunchResolver;
  readonly activity?: TerminalActivityService;
  /** Canonical server-owned workspace/view authority for layout mutations. */
  readonly workspace?: WorkspaceRepositoryType;
  readonly maxReadBytes?: number;
  readonly maxWaitSeconds?: number;
  readonly focusTerminal?: (params: TerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly renameTerminal?: (params: RenameTerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
  readonly splitTerminal?: (params: SplitTerminalParams, context: ControlRequestContext, signal: AbortSignal) => unknown | Promise<unknown>;
}

const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const DEFAULT_MAX_WAIT_SECONDS = 15 * 60;

/**
 * Bind MCP operations to the server-owned terminal and activity authorities.
 * TerminalService deliberately owns PTYs, while WorkspaceRepository owns the
 * canonical view tree. Layout mutations use the repository when composed;
 * injected callbacks remain a compatibility seam for hosts that have not yet
 * composed workspace persistence.
 */
export function createServerTerminalControlAdapter(options: ServerTerminalControlAdapterOptions): TerminalControlAdapter {
  if (!(options.terminal instanceof TerminalService)) throw new TypeError("terminal service is required");
  const maxReadBytes = positive(options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES, "maxReadBytes");
  const maxWaitSeconds = positive(options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS, "maxWaitSeconds");
  return {
    listTerminals: (context) => listTerminals(options, context),
    readTerminal: (params, context) => readTerminal(options, params, context, maxReadBytes),
    getTerminalStatus: (params, context) => terminalStatus(options, params, context),
    openTerminal: (params, context) => openTerminal(options, params, context),
    writeTerminal: (params, context) => writeTerminal(options, params, context),
    runCommand: (params, context) => runCommand(options, params, context),
    closeTerminal: (params, context) => closeTerminal(options, params, context),
    focusTerminal: (params, context, signal) => {
      targetSession(options.terminal, context, params.terminal);
      return options.workspace === undefined ? (options.focusTerminal === undefined ? unsupported("focus_terminal") : options.focusTerminal(params, context, signal)) : applyWorkspaceViewCommand(options.workspace, "focus_terminal", params.terminal, context, signal);
    },
    renameTerminal: (params, context, signal) => {
      targetSession(options.terminal, context, params.terminal);
      return options.workspace === undefined ? (options.renameTerminal === undefined ? unsupported("rename_terminal") : options.renameTerminal(params, context, signal)) : applyWorkspaceViewCommand(options.workspace, "rename_terminal", params.terminal, context, signal, params.name);
    },
    splitTerminal: (params, context, signal) => {
      targetSession(options.terminal, context, params.terminal);
      return options.workspace === undefined ? (options.splitTerminal === undefined ? unsupported("split_terminal") : options.splitTerminal(params, context, signal)) : applyWorkspaceViewCommand(options.workspace, "split_terminal", params.terminal, context, signal, params.direction);
    },
    waitForIdle: (params, context, signal) => waitForIdle(options, params, context, signal, maxWaitSeconds),
    waitForCommand: (params, context, signal) => waitForCommand(options, params, context, signal, maxWaitSeconds),
    waitForAttention: (params, context, signal) => waitForAttention(options, params, context, signal, maxWaitSeconds),
  };
}

function listTerminals(options: ServerTerminalControlAdapterOptions, context: ControlRequestContext): unknown {
  const terminals = options.terminal
    .listSessions()
    .filter((session) => session.serverId === options.terminal.serverId && session.projectId === context.projectId)
    .map((session) => {
      const activity = activitySnapshot(options.activity, context, session.sessionId);
      return {
        terminal: session.sessionId,
        projectId: session.projectId,
        status: session.status,
        outputPosition: session.outputPosition,
        replayFrom: session.replayFrom,
        ...(activity === undefined ? {} : { activity }),
      };
    });
  return { terminals };
}

async function readTerminal(options: ServerTerminalControlAdapterOptions, params: ReadTerminalParams, context: ControlRequestContext, maxReadBytes: number): Promise<unknown> {
  const session = targetSession(options.terminal, context, params.terminal);
  const subscription = options.terminal.subscribe(session, {
    authorization: authorization(context, options.terminal.serverId, "read"),
    fromPosition: session.replayFrom,
    maxQueuedBytes: maxReadBytes,
  });
  try {
    const events = subscription.drain();
    if (subscription.closed && events.some((event) => event.type === "resync_required")) throw new ControlEndpointError("limit_exceeded", "terminal replay is no longer available");
    const chunks = events.filter((event): event is Extract<TerminalEvent, { type: "output" }> => event.type === "output");
    const bytes = chunks.reduce((sum, event) => sum + event.bytes.byteLength, 0);
    const raw = new TextDecoder().decode(
      concat(
        chunks.map((event) => event.bytes),
        bytes,
      ),
    );
    const lines = params.lines === undefined ? raw : takeLastLines(raw, params.lines);
    return {
      terminal: session.sessionId,
      output: lines,
      truncated: lines !== raw,
    };
  } finally {
    subscription.close();
  }
}

function terminalStatus(options: ServerTerminalControlAdapterOptions, params: TerminalParams, context: ControlRequestContext): unknown {
  const session = targetSession(options.terminal, context, params.terminal);
  const activity = activitySnapshot(options.activity, context, session.sessionId);
  return {
    terminal: session.sessionId,
    status: session.status,
    outputPosition: session.outputPosition,
    replayFrom: session.replayFrom,
    ...(session.exit === undefined ? {} : { exit: session.exit }),
    ...(activity === undefined ? {} : { activity }),
  };
}

async function openTerminal(options: ServerTerminalControlAdapterOptions, params: OpenTerminalParams, context: ControlRequestContext): Promise<unknown> {
  const activePanelId = await callerPanelId(options.workspace, context);
  const launch = await options.launchResolver.resolve({
    identity: options.terminal.allocateIdentity(context.projectId),
    cols: 80,
    rows: 24,
    ...(params.cwd === undefined ? {} : { explicitCwd: params.cwd }),
    ...(activePanelId === undefined ? {} : { activePanelId }),
  });
  const handle = await options.terminal.createResolvedSession(launch);
  try {
    await reconcileOpenedTerminal(options.workspace, handle.snapshot(), params.name, context);
  } catch (error) {
    await options.terminal.kill(handle.snapshot()).catch(() => undefined);
    throw error;
  }
  return {
    terminal: handle.sessionId,
    projectId: handle.projectId,
    status: handle.status,
    ...(params.split === undefined ? {} : { split: params.split }),
  };
}

async function callerPanelId(workspace: WorkspaceRepositoryType | undefined, context: ControlRequestContext): Promise<string | undefined> {
  if (workspace === undefined) return undefined;
  const state = await workspace.load();
  return Object.values(state.panels).find((panel): panel is Extract<WorkspacePanel, { type: "terminal" }> => panel.type === "terminal" && panel.projectId === context.projectId && panel.sessionId === context.terminalSessionId)?.id;
}

async function reconcileOpenedTerminal(workspace: WorkspaceRepositoryType | undefined, session: TerminalSessionSnapshot, requestedName: string | undefined, context: ControlRequestContext): Promise<void> {
  if (workspace === undefined) return;
  const state = await workspace.load();
  const panelCount = Object.values(state.panels).filter((panel) => panel.projectId === session.projectId && panel.type === "terminal").length;
  const result = await workspace.apply({
    commandId: `${context.requestId}.open`.slice(0, 128),
    command: {
      type: "terminal.createPanel",
      sessionId: session.sessionId,
      projectId: session.projectId,
      panelId: `p:${session.sessionId}`.slice(0, 128),
      title: requestedName ?? `Terminal ${panelCount + 1}`,
      cwd: session.cwd,
      createdAt: session.createdAt,
    },
  });
  if (!result.ok) {
    throw new ControlEndpointError("internal", `The workspace rejected open_terminal at revision ${result.conflict.currentRevision}.`);
  }
}

async function writeTerminal(options: ServerTerminalControlAdapterOptions, params: WriteTerminalParams, context: ControlRequestContext): Promise<unknown> {
  const session = targetSession(options.terminal, context, params.terminal);
  const text = params.submit === true ? `${params.text}\r` : params.text;
  await options.terminal.write(session, text, authorization(context, options.terminal.serverId, "write"));
  return {
    terminal: session.sessionId,
    bytes: new TextEncoder().encode(text).byteLength,
    submitted: params.submit === true,
  };
}

async function runCommand(options: ServerTerminalControlAdapterOptions, params: RunCommandParams, context: ControlRequestContext): Promise<unknown> {
  const session = targetSession(options.terminal, context, params.terminal);
  const text = `\u001b[200~${params.command}\u001b[201~\r`;
  await options.terminal.write(session, text, authorization(context, options.terminal.serverId, "write"));
  return {
    terminal: session.sessionId,
    bytes: new TextEncoder().encode(text).byteLength,
    submitted: true,
  };
}

async function closeTerminal(options: ServerTerminalControlAdapterOptions, params: TerminalParams, context: ControlRequestContext): Promise<unknown> {
  const session = targetSession(options.terminal, context, params.terminal);
  await options.terminal.kill(session, authorization(context, options.terminal.serverId, "write"));
  return { terminal: session.sessionId, closed: true };
}

function waitForIdle(options: ServerTerminalControlAdapterOptions, params: WaitForIdleParams, context: ControlRequestContext, signal: AbortSignal, maxWaitSeconds: number): Promise<unknown> {
  return waitForActivity(options, params.terminal, context, signal, params.timeout ?? maxWaitSeconds, (snapshot) => snapshot.status === "idle", { terminal: params.terminal, idle: true }, { terminal: params.terminal, idle: false });
}

function waitForCommand(options: ServerTerminalControlAdapterOptions, params: WaitParams, context: ControlRequestContext, signal: AbortSignal, maxWaitSeconds: number): Promise<unknown> {
  return waitForActivity(
    options,
    params.terminal,
    context,
    signal,
    params.timeout ?? maxWaitSeconds,
    (snapshot, event) => event !== undefined && snapshot.status === "idle" && snapshot.exitCode !== undefined && snapshot.source.includes("command"),
    { terminal: params.terminal, completed: true },
    { terminal: params.terminal, completed: false },
  );
}

function waitForAttention(options: ServerTerminalControlAdapterOptions, params: WaitParams, context: ControlRequestContext, signal: AbortSignal, maxWaitSeconds: number): Promise<unknown> {
  return waitForActivity(options, params.terminal, context, signal, params.timeout ?? maxWaitSeconds, (snapshot, event) => event !== undefined && snapshot.attention, { terminal: params.terminal, attention: true }, { terminal: params.terminal, attention: false });
}

function waitForActivity(
  options: ServerTerminalControlAdapterOptions,
  terminal: string,
  context: ControlRequestContext,
  signal: AbortSignal,
  timeoutSeconds: number,
  predicate: (snapshot: NonNullable<ReturnType<TerminalActivityService["get"]>>, event?: ActivityEvent) => boolean,
  success: Record<string, unknown>,
  timedOut: Record<string, unknown>,
): Promise<unknown> {
  const activity = options.activity;
  if (activity === undefined) return Promise.reject(new ControlEndpointError("unsupported_op", "canonical terminal activity is unavailable"));
  const session = targetSession(options.terminal, context, terminal);
  const identity = {
    serverId: options.terminal.serverId,
    projectId: context.projectId,
    sessionId: session.sessionId,
  };
  const initial = activity.get(identity);
  if (initial !== undefined && predicate(initial))
    return Promise.resolve({
      ...success,
      terminal: terminal,
      timedOut: false,
      ...(initial.exitCode === undefined ? {} : { exitCode: initial.exitCode }),
    });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      removeExitSubscription();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(new ControlEndpointError("cancelled", "The control operation was cancelled.")));
    const removeExit = (event: TerminalEvent): void => {
      if (event.type === "exit" && event.sessionId === session.sessionId) finish(() => reject(new ControlEndpointError("terminal_not_found", "The requested terminal is unavailable.")));
    };
    const unsubscribe = activity.subscribe((_event, snapshot: ActivitySnapshot) => {
      const current = snapshot.sessions[session.sessionId];
      if (current !== undefined && predicate(current, _event))
        finish(() =>
          resolve({
            ...success,
            terminal,
            timedOut: false,
            ...(current.exitCode === undefined ? {} : { exitCode: current.exitCode }),
          }),
        );
    });
    const removeExitSubscription = options.terminal.onEvent(removeExit);
    const timer = setTimeout(() => finish(() => resolve({ ...timedOut, timedOut: true })), Math.min(timeoutSeconds, maxSafeWaitSeconds(options)) * 1_000);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function targetSession(service: TerminalService, context: ControlRequestContext, terminal: string): TerminalSessionSnapshot {
  const session = service.getSession(terminal);
  if (session === undefined || session.serverId !== service.serverId || session.projectId !== context.projectId) throw new ControlEndpointError("terminal_not_found", "The requested terminal is unavailable.");
  return session;
}

async function applyWorkspaceViewCommand(workspace: WorkspaceRepository, operation: "focus_terminal" | "rename_terminal" | "split_terminal", sessionId: string, context: ControlRequestContext, signal: AbortSignal, value?: string): Promise<unknown> {
  throwIfAborted(signal);
  const state = await workspace.load();
  throwIfAborted(signal);
  const panel = Object.values(state.panels).find((candidate): candidate is Extract<WorkspacePanel, { type: "terminal" }> => candidate.type === "terminal" && candidate.sessionId === sessionId && candidate.projectId === context.projectId);
  if (panel === undefined) {
    throw new ControlEndpointError("terminal_not_found", "The requested terminal has no canonical workspace panel.");
  }

  const command =
    operation === "focus_terminal"
      ? {
          type: "panel.activate" as const,
          projectId: panel.projectId,
          panelId: panel.id,
        }
      : operation === "rename_terminal"
        ? {
            type: "panel.update" as const,
            panelId: panel.id,
            patch: { title: value ?? "" },
          }
        : {
            type: "panel.split" as const,
            projectId: panel.projectId,
            panelId: panel.id,
            direction: splitDirection(value),
          };
  const result = await workspace.apply({
    commandId: `${context.requestId}.${operation}`.slice(0, 128),
    command,
  });
  throwIfAborted(signal);
  if (!result.ok) {
    throw new ControlEndpointError("internal", `The workspace rejected ${operation} at revision ${result.conflict.currentRevision}.`);
  }
  if (operation === "rename_terminal") return { terminal: sessionId, renamed: true, name: value };
  if (operation === "split_terminal") return { terminal: sessionId, split: value };
  return { terminal: sessionId, focused: true };
}

function splitDirection(value: string | undefined): "horizontal" | "vertical" {
  if (value === "right" || value === "left") return "horizontal";
  return "vertical";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ControlEndpointError("cancelled", "The control operation was cancelled.");
}

function activitySnapshot(activity: TerminalActivityService | undefined, context: ControlRequestContext, sessionId: string): ReturnType<TerminalActivityService["get"]> | undefined {
  if (activity === undefined) return undefined;
  try {
    return activity.get({
      serverId: activity.serverId,
      projectId: context.projectId,
      sessionId,
    });
  } catch {
    return undefined;
  }
}

function authorization(context: ControlRequestContext, serverId: string, scope: "read" | "write"): TerminalAuthorization {
  // The MCP capability scopes a project; sibling target sessions are
  // authorized by project identity, not by the calling session id.
  return { serverId, projectId: context.projectId, scope };
}

function unsupported(operation: string): never {
  throw new ControlEndpointError("unsupported_op", `control operation ${operation} is unavailable`);
}
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
function maxSafeWaitSeconds(options: ServerTerminalControlAdapterOptions): number {
  return options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS;
}
function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function takeLastLines(value: string, lines: number): string {
  const parts = value.split(/\r?\n/u);
  return parts.slice(Math.max(0, parts.length - lines - (parts.at(-1) === "" ? 1 : 0))).join("\n");
}
