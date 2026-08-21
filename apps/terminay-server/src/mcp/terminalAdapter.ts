import {
  type ActivityEvent,
  type ActivitySnapshot,
  TerminalActivityService,
  type TerminalAuthorization,
  type TerminalEvent,
  type TerminalLaunchResolver,
  type TerminalPresentationRead,
  type TerminalPresentationReadOptions,
  type TerminalRetainedOutputRead,
  type TerminalRetainedOutputReadOptions,
  TerminalService,
  type TerminalSessionSnapshot,
  type WorkspacePanel,
  WorkspaceRepository,
  type WorkspaceRepository as WorkspaceRepositoryType,
} from "@terminay/server-core";
import { ControlEndpointError, type ControlRequestContext } from "./controlEndpoint.js";
import type { OpenTerminalParams, ReadTerminalParams, RenameTerminalParams, RunCommandParams, SearchTerminalParams, SplitTerminalParams, TerminalControlAdapter, TerminalParams, WaitForIdleParams, WaitParams, WriteTerminalParams } from "./dispatcher.js";

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
    getMcpCapabilities: () => getMcpCapabilities(options),
    listTerminals: (context) => listTerminals(options, context),
    readTerminal: (params, context) => readTerminal(options, params, context, maxReadBytes),
    searchTerminal: (params, context) => searchTerminal(options, params, context, maxReadBytes),
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

function getMcpCapabilities(options: ServerTerminalControlAdapterOptions): unknown {
  const activityAvailable = options.activity !== undefined;
  const workspaceAvailable = options.workspace !== undefined;
  return {
    tools: [
      "get_mcp_capabilities",
      "list_terminals",
      "read_terminal",
      "search_terminal",
      "get_terminal_status",
      "open_terminal",
      "write_terminal",
      "run_command",
      "close_terminal",
      "focus_terminal",
      "rename_terminal",
      "split_terminal",
      "wait_for_idle",
      "wait_for_command",
      "wait_for_attention",
    ].map((tool) => ({
      tool,
      available:
        tool === "wait_for_idle" || tool === "wait_for_command" || tool === "wait_for_attention"
          ? activityAvailable
          : tool === "focus_terminal"
            ? workspaceAvailable || options.focusTerminal !== undefined
            : tool === "rename_terminal"
              ? workspaceAvailable || options.renameTerminal !== undefined
              : tool === "split_terminal"
                ? workspaceAvailable || options.splitTerminal !== undefined
                : true,
    })),
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
        status: session.status,
        output_position: session.outputPosition,
        replay_from: session.replayFrom,
        ...(activity === undefined ? {} : { activity }),
      };
    });
  return { terminals };
}

async function readTerminal(options: ServerTerminalControlAdapterOptions, params: ReadTerminalParams, context: ControlRequestContext, maxReadBytes: number): Promise<unknown> {
  const session = targetSession(options.terminal, context, params.terminal);
  const terminal = outputReader(options.terminal);
  const readAuthorization = authorization(context, options.terminal.serverId, "read");
  const responseBudget = Math.min(params.maxBytes, maxReadBytes);
  if (params.format === "raw") {
    // Base64 expands every complete triple of PTY bytes into four response
    // bytes. Never return a partial Base64 quantum just to use the final one
    // to three requested bytes of budget.
    const rawBudget = Math.floor(responseBudget / 4) * 3;
    const retained = terminal.readRetainedOutput(session, {
      authorization: readAuthorization,
      ...(params.after === undefined ? {} : { fromPosition: params.after }),
      maxBytes: Math.max(1, rawBudget),
    });
    const bytes = rawBudget === 0 ? new Uint8Array() : retained.bytes;
    return {
      terminal: session.sessionId,
      format: "raw",
      encoding: "base64",
      output: Buffer.from(bytes).toString("base64"),
      from: retained.fromPosition,
      next: retained.fromPosition + bytes.byteLength,
      replay_from: retained.replayFrom,
      output_position: retained.outputPosition,
      history_lost: retained.historyLost,
      truncated_tail: retained.fromPosition + bytes.byteLength < retained.outputPosition,
    };
  }
  const presentation = await terminal.readPresentation(session, {
    authorization: readAuthorization,
    format: params.format,
    maxBytes: responseBudget,
    ...(params.format === "text" && params.lines !== undefined ? { maxRows: params.lines } : {}),
  });
  return {
    terminal: session.sessionId,
    format: presentation.format,
    output_position: presentation.outputPosition,
    dimensions: presentation.dimensions,
    presentation_truncated: presentation.truncated,
    dropped_bytes: presentation.droppedBytes,
    dropped_rows: presentation.droppedRows,
    ...(presentation.format === "text"
      ? { output: (presentation.rows ?? []).join("\n") }
      : { output: presentation.ansi ?? "" }),
  };
}

async function searchTerminal(options: ServerTerminalControlAdapterOptions, params: SearchTerminalParams, context: ControlRequestContext, maxReadBytes: number): Promise<unknown> {
  const session = targetSession(options.terminal, context, params.terminal);
  const terminal = outputReader(options.terminal);
  // Search is snapshot-only. Obtain a bounded text presentation large enough
  // to search useful scrollback, then independently bound the result object.
  const presentation = await terminal.readPresentation(session, {
    authorization: authorization(context, options.terminal.serverId, "read"),
    format: "text",
    maxBytes: Math.max(params.maxBytes, Math.min(maxReadBytes, 64 * 1024)),
  });
  const rows = presentation.rows ?? [];
  const fold = params.caseSensitive
    ? (value: string) => value
    : (value: string) => value.toLocaleLowerCase("und");
  const query = fold(params.query);
  const matchingIndexes: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (fold(rows[index]!).includes(query)) matchingIndexes.push(index);
  }

  const matches: Array<Record<string, unknown>> = [];
  let matchesTruncated = false;
  for (let matchOffset = 0; matchOffset < matchingIndexes.length; matchOffset += 1) {
    if (matches.length >= params.maxMatches) {
      matchesTruncated = true;
      break;
    }
    const index = matchingIndexes[matchOffset]!;
    let accepted: Record<string, unknown> | undefined;
    // Prefer the requested surrounding context, then progressively shorten it
    // before omitting a later match. Row indexes identify this snapshot only.
    for (let contextLines = params.contextLines; contextLines >= 0; contextLines -= 1) {
      const candidate = {
        row: index,
        text: rows[index]!,
        before: rows.slice(Math.max(0, index - contextLines), index),
        after: rows.slice(index + 1, Math.min(rows.length, index + contextLines + 1)),
      };
      const result = searchResult(session.sessionId, presentation.dimensions, presentation.outputPosition, matches.concat(candidate), false, presentation.truncated);
      if (Buffer.byteLength(JSON.stringify(result), "utf8") <= params.maxBytes) {
        accepted = candidate;
        break;
      }
    }
    if (accepted === undefined) {
      matchesTruncated = true;
      break;
    }
    matches.push(accepted);
  }
  if (matches.length < matchingIndexes.length) matchesTruncated = true;
  return searchResult(
    session.sessionId,
    presentation.dimensions,
    presentation.outputPosition,
    matches,
    matchesTruncated,
    presentation.truncated,
  );
}

function searchResult(
  terminal: string,
  dimensions: { readonly cols: number; readonly rows: number },
  outputPosition: number,
  matches: readonly Record<string, unknown>[],
  matchesTruncated: boolean,
  presentationTruncated: boolean,
): Record<string, unknown> {
  return {
    terminal,
    output_position: outputPosition,
    dimensions,
    matches,
    matches_truncated: matchesTruncated,
    presentation_truncated: presentationTruncated,
  };
}

/**
 * The output-read APIs were added to TerminalService after the long-lived
 * server adapter surface. Keep their small structural boundary explicit so
 * an older generated declaration cannot accidentally make this host fall
 * back to subscription/replay behaviour at runtime.
 */
function outputReader(service: TerminalService): TerminalOutputReader {
  return service as TerminalOutputReader;
}

interface TerminalOutputReader {
  readRetainedOutput(
    session: string | TerminalSessionSnapshot,
    options: TerminalRetainedOutputReadOptions,
  ): TerminalRetainedOutputRead;
  readPresentation(
    session: string | TerminalSessionSnapshot,
    options: TerminalPresentationReadOptions,
  ): Promise<TerminalPresentationRead>;
}

function terminalStatus(options: ServerTerminalControlAdapterOptions, params: TerminalParams, context: ControlRequestContext): unknown {
  const session = targetSession(options.terminal, context, params.terminal);
  const activity = activitySnapshot(options.activity, context, session.sessionId);
  return {
    terminal: session.sessionId,
    status: session.status,
    output_position: session.outputPosition,
    replay_from: session.replayFrom,
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
  const from = session.outputPosition;
  const text = `\u001b[200~${params.command}\u001b[201~\r`;
  await options.terminal.write(session, text, authorization(context, options.terminal.serverId, "write"));
  return {
    terminal: session.sessionId,
    command_id: context.requestId,
    from,
    submitted_bytes: new TextEncoder().encode(text).byteLength,
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
