import {
  createJsonlRecordDecoder,
  defineAgentProvider,
  jsonlSession,
  type AgentFileHandle,
  type AgentFileWatchChunk,
  type AgentFileWatcher,
  type AgentChildJournalSource,
  type AgentDirectoryHandle,
  type AgentLifecyclePublisher,
  type AgentModelMetadata,
  type AgentRecordContext,
  type AgentTerminalContext,
} from "@terminay/extension-api";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { LIMITS, MAPPING_VERSION } from "./constants.js";

type JsonObject = Record<string, unknown>;
type CompletionOutcome = "success" | "error" | "cancelled";

interface CodexState {
  promptPublished: boolean;
  activeWait?: string;
}

interface RootRollout {
  journal: AgentFileHandle;
  sourceFile: AgentFileHandle;
  sessionId: string;
}

interface ChildRollout {
  journal: AgentFileHandle;
  sessionId: string;
}

const SESSION_TITLE_RECORD = "terminay.codex_session_title";

/**
 * Documents the native Codex home convention for local Node integrations.
 * Agent observation itself always uses the terminal's environment-routed
 * broker, so remote sessions never accidentally read the local server home.
 */
export function effectiveCodexHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.CODEX_HOME?.trim();
  return resolve(configured || resolve(homedir(), ".codex"));
}

/** Codex is intentionally recognized only by its executable, never text output. */
export function isCodexForeground(executableName: string): boolean {
  const name = executableName.trim().toLowerCase();
  return name === "codex" || name.startsWith("codex-") || name.startsWith("codex_") || name.startsWith("codex.");
}

export const codexAgentProvider = defineAgentProvider({
  mappingVersion: MAPPING_VERSION,

  matchesForeground(process) {
    return isCodexForeground(process.executableName);
  },

  async observe(terminal) {
    if (!terminal.capabilities.has("process-observation")
      || !terminal.capabilities.has("filesystem-observation")
      || !terminal.capabilities.has("agent-journal")) {
      return { state: "unavailable" as const, reason: "environment-capability-missing" as const };
    }

    const rollout = await findProcessBoundRootRollout(terminal);
    if (!rollout) return { state: "not-bound" as const };

    const binding = await terminal.bindSession({
      providerSessionId: rollout.sessionId,
      mappingVersion: MAPPING_VERSION,
      journal: rollout.journal,
      fingerprint: {
        kind: "writable-file-below-terminal-process",
        file: rollout.sourceFile,
      },
    });
    // Codex writes user-assigned session names into its terminal-scoped home
    // index rather than the rollout. This is intentionally independent from
    // the rollout fingerprint: the writer-held rollout remains the only
    // authority that binds the session to this PTY.
    const sessionIndex = await findSessionIndex(terminal);
    const sessionsDirectory = await findSessionsDirectory(terminal);
    const childSources = await findChildSources(terminal, rollout.sessionId, sessionsDirectory);
    const states = new Map<string, CodexState>();
    return jsonlSession({
      binding,
      source: new CodexSessionWatcher({
        terminal,
        rollout: rollout.journal,
        sessionIndex,
        sessionId: rollout.sessionId,
      }),
      ...(childSources.length === 0 ? {} : { childSources }),
      ...(sessionsDirectory === undefined ? {} : {
        // Codex writes a subagent's native session_meta to a separate rollout
        // after the root binding may already be active. The generic host owns
        // admission and stable-id de-duplication; this extension supplies only
        // exact-parent, terminal-scoped journals.
        childSourceDiscovery: discoverChildSources(
          terminal,
          rollout.sessionId,
          sessionsDirectory,
          new Set(childSources.map((child) => child.childId)),
        ),
      }),
      mapRecord(record, context) {
        const key = context.journal.role === "root" ? "root" : `child:${context.journal.childId}`;
        const recordState = states.get(key) ?? { promptPublished: false };
        states.set(key, recordState);
        mapCodexRecord(record, context, recordState);
      },
    });
  },
});

/**
 * Finds only a root rollout with an open writable descriptor below this exact
 * terminal process tree. The opaque handle (not its display path) is retained
 * in the binding fingerprint, so a newest-file or cwd heuristic cannot bind a
 * session. Codex subagent rollouts are rejected by their non-CLI source.
 */
async function findProcessBoundRootRollout(terminal: AgentTerminalContext): Promise<RootRollout | undefined> {
  const descendants = await terminal.observation.processes.descendants({ signal: terminal.signal });
  const writable = await terminal.observation.processes.openFiles(descendants, {
    access: "writable",
    signal: terminal.signal,
  });
  const matches: Array<RootRollout & { modifiedAt: number }> = [];
  const candidates = writable.filter((file) => isRolloutPath(file.path));
  for (const candidate of candidates) {
    const journal = await terminal.observation.files.canonicalFile(candidate.handle, {
      extension: ".jsonl",
      signal: terminal.signal,
    });
    if (!journal) continue;
    const header = await terminal.observation.files.readJsonLine<unknown>(journal, {
      position: "first",
      maxBytes: LIMITS.recordBytes,
      signal: terminal.signal,
    });
    const sessionId = rootSessionId(header);
    if (!sessionId) continue;
    const stat = await terminal.observation.files.stat(journal, { signal: terminal.signal });
    const modifiedAt = stat?.modifiedAt ? Date.parse(stat.modifiedAt) : Number.NaN;
    matches.push({ journal, sourceFile: candidate.handle, sessionId, modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0 });
  }
  // Codex can retain an earlier rollout while a resumed/branched root opens a
  // second one. Both have exact writer proof; its own modified timestamp is
  // the root-selection rule used by the prior in-core provider.
  matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!matches[0]) return undefined;
  const { modifiedAt: _modifiedAt, ...selected } = matches[0];
  return selected;
}

/**
 * Resolves Codex's append-only session-name index through the issued terminal
 * context. No extension-host home directory or raw path becomes authority.
 */
async function findSessionIndex(terminal: AgentTerminalContext): Promise<AgentFileHandle | undefined> {
  try {
    const environment = await terminal.observation.processes.environment(["CODEX_HOME"], { signal: terminal.signal });
    if (environment.CODEX_HOME) {
      return await terminal.observation.files.resolveRelativeToEnvironment("session_index.jsonl", {
        environmentVariable: "CODEX_HOME",
        signal: terminal.signal,
      });
    }
    return await terminal.observation.files.resolveHomeRelative(".codex/session_index.jsonl", {
      beneath: { homeRelative: ".codex" },
      signal: terminal.signal,
    });
  } catch {
    // Titles are enrichment. A declared-env or home-index miss must not unwind
    // an already proven writer-bound rollout.
    return undefined;
  }
}

/**
 * A child never establishes a root binding. Codex persists children as
 * separate rollouts, so discovery accepts only files whose native nested
 * parent id equals the already-bound root session id.
 */
const CHILD_DIRECTORY_OPTIONS = Object.freeze({
  extensions: [".jsonl"],
  maxDepth: 4,
  maxEntries: 256,
  maxBytes: 16 * 1024 * 1024,
});

async function findSessionsDirectory(terminal: AgentTerminalContext): Promise<AgentDirectoryHandle | undefined> {
  try {
    const environment = await terminal.observation.processes.environment(["CODEX_HOME"], { signal: terminal.signal });
    return environment.CODEX_HOME
      ? await terminal.observation.files.resolveDirectoryRelativeToEnvironment("sessions", {
        environmentVariable: "CODEX_HOME",
        signal: terminal.signal,
      })
      : await terminal.observation.files.resolveHomeDirectory(".codex/sessions", {
        beneath: { homeRelative: ".codex" },
        signal: terminal.signal,
      });
  } catch {
    return undefined;
  }
}

async function findChildSources(terminal: AgentTerminalContext, parentSessionId: string, sessions: AgentDirectoryHandle | undefined): Promise<readonly AgentChildJournalSource[]> {
  if (!sessions) return [];
  try {
    const listing = await terminal.observation.files.listDirectory(sessions, { ...CHILD_DIRECTORY_OPTIONS, signal: terminal.signal });
    const children = new Map<string, ChildRollout>();
    for (const entry of listing.entries) {
      const child = await childSourceForEntry(terminal, parentSessionId, entry.handle);
      if (child && !children.has(child.sessionId)) children.set(child.sessionId, child);
    }
    return [...children.values()].slice(0, 64).map(({ journal, sessionId }) => ({
      childId: sessionId,
      journal,
      source: terminal.observation.files.follow(journal, {
        signal: terminal.signal,
        maxChunkBytes: LIMITS.recordBytes,
      }),
    }));
  } catch {
    // Child discovery is optional bounded enrichment. A temporarily missing
    // directory capability must not make the already proven root unavailable.
    return [];
  }
}

/**
 * Discovers only *new* native child journals while the already-proven root is
 * live. A directory replacement or repeat snapshot cannot re-admit a child:
 * ids are native session ids and remain stable for one root binding.
 */
async function* discoverChildSources(
  terminal: AgentTerminalContext,
  parentSessionId: string,
  sessions: AgentDirectoryHandle,
  seen: Set<string>,
): AsyncGenerator<AgentChildJournalSource> {
  let watcher: Awaited<ReturnType<AgentTerminalContext["observation"]["files"]["watchDirectory"]>> | undefined;
  try {
    watcher = await terminal.observation.files.watchDirectory(sessions, { ...CHILD_DIRECTORY_OPTIONS, signal: terminal.signal });
    for await (const listing of watcher) {
      for (const entry of listing.entries) {
        if (seen.size >= 64) return;
        const child = await childSourceForEntry(terminal, parentSessionId, entry.handle);
        if (!child || seen.has(child.sessionId)) continue;
        seen.add(child.sessionId);
        yield {
          childId: child.sessionId,
          journal: child.journal,
          source: terminal.observation.files.follow(child.journal, {
            signal: terminal.signal,
            maxChunkBytes: LIMITS.recordBytes,
          }),
        };
      }
    }
  } catch {
    // The root remains valid when optional bounded discovery disappears.
  } finally {
    await watcher?.dispose();
  }
}

async function childSourceForEntry(
  terminal: AgentTerminalContext,
  parentSessionId: string,
  journal: AgentFileHandle,
): Promise<ChildRollout | undefined> {
  try {
    const header = await terminal.observation.files.readJsonLine<unknown>(journal, {
      position: "first",
      maxBytes: LIMITS.recordBytes,
      signal: terminal.signal,
    });
    const child = childRollout(header, parentSessionId);
    return child ? { journal, sessionId: child.sessionId } : undefined;
  } catch {
    // One racing/malformed candidate cannot stop discovery of later native
    // children in the same bounded snapshot.
    return undefined;
  }
}

function childRollout(record: unknown, expectedParentId: string): { sessionId: string; parentThreadId: string } | undefined {
  const envelope = object(record);
  const payload = object(envelope?.payload);
  const source = object(payload?.source);
  const subagent = object(source?.subagent);
  const spawn = object(subagent?.thread_spawn);
  const sessionId = bounded(LIMITS.sessionId, payload?.id, payload?.session_id);
  const parentThreadId = bounded(LIMITS.sessionId, spawn?.parent_thread_id);
  return envelope?.type === "session_meta" && sessionId && parentThreadId === expectedParentId
    ? { sessionId, parentThreadId }
    : undefined;
}

/**
 * Merges the rollout journal with a narrowly normalized title stream. The
 * host continues to decode, order and validate every resulting lifecycle
 * event; provider-private index entries never leave this extension.
 */
class CodexSessionWatcher implements AgentFileWatcher {
  private closed = false;

  constructor(private readonly options: {
    terminal: AgentTerminalContext;
    rollout: AgentFileHandle;
    sessionIndex?: AgentFileHandle;
    sessionId: string;
  }) {}

  dispose(): void { this.closed = true; }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentFileWatchChunk> {
    try { yield* this.followedChunks(); }
    catch {
      // A live writer remains authoritative even if a host watcher loses its
      // opaque handle during Codex's rapid collaboration startup. Fall back
      // to bounded snapshot tails through that same issued handle; no path is
      // reconstructed and no unrelated session can enter the stream.
      yield* this.snapshotChunks();
    }
  }

  private async *followedChunks(): AsyncGenerator<AgentFileWatchChunk> {
    const { terminal, rollout, sessionIndex, sessionId } = this.options;
    const watchOptions = { signal: terminal.signal, maxChunkBytes: LIMITS.recordBytes };
    const rolloutWatcher = await terminal.observation.files.follow(rollout, watchOptions);
    // The rollout is the binding authority. The optional title index can be
    // rotated between discovery and watcher setup, so it must never prevent
    // the root stream (and its collaboration children) from being consumed.
    let indexWatcher: AgentFileWatcher | undefined;
    if (sessionIndex !== undefined) {
      try { indexWatcher = await terminal.observation.files.follow(sessionIndex, watchOptions); }
      catch { /* title enrichment is unavailable until the next observation */ }
    }
    const watchers = [rolloutWatcher, ...(indexWatcher === undefined ? [] : [indexWatcher])];
    const decoder = createJsonlRecordDecoder(LIMITS.recordBytes);
    let lastTitle: string | undefined;
    try {
      const rolloutIterator = rolloutWatcher[Symbol.asyncIterator]();
      // The first rollout chunk always contains session_meta for a newly
      // opened watcher. Yield it before metadata so session.started exists
      // before an explicit title can refine the same root entry.
      const firstRollout = await rolloutIterator.next();
      if (!firstRollout.done && !this.closed && !terminal.signal.aborted) yield firstRollout.value;

      const sources: Array<ObservedSource> = [{ iterator: rolloutIterator, titleIndex: false }];
      if (indexWatcher !== undefined) sources.push({ iterator: indexWatcher[Symbol.asyncIterator](), titleIndex: true });
      for (const source of sources) scheduleNext(source);
      while (!this.closed && !terminal.signal.aborted && sources.some((source) => source.pending !== undefined)) {
        const ready = await Promise.race(sources.flatMap((source) => source.pending === undefined ? [] : [source.pending]));
        ready.source.pending = undefined;
        if (ready.result.done) continue;
        scheduleNext(ready.source);
        if (!ready.source.titleIndex) {
          yield ready.result.value;
          continue;
        }
        for (const record of decoder.push(ready.result.value.bytes, ready.result.value.type !== "append")) {
          const title = sessionTitle(record, sessionId);
          if (!title || title === lastTitle) continue;
          lastTitle = title;
          yield titleChunk(sessionId, title);
        }
      }
    } finally {
      this.closed = true;
      await Promise.all(watchers.map((watcher) => watcher.dispose()));
    }
  }

  private async *snapshotChunks(): AsyncGenerator<AgentFileWatchChunk> {
    const { terminal, rollout } = this.options;
    let previous: Uint8Array<ArrayBufferLike> = new Uint8Array();
    while (!this.closed && !terminal.signal.aborted) {
      const current = await terminal.observation.files.read(rollout, {
        maxBytes: LIMITS.recordBytes,
        signal: terminal.signal,
      });
      const shared = Math.min(previous.byteLength, current.byteLength);
      let prefixMatches = previous.byteLength <= current.byteLength;
      for (let index = 0; prefixMatches && index < shared; index += 1) {
        if (previous[index] !== current[index]) prefixMatches = false;
      }
      if (prefixMatches && current.byteLength > previous.byteLength) {
        yield { type: "append", bytes: current.slice(previous.byteLength) };
      } else if (!prefixMatches || current.byteLength < previous.byteLength) {
        yield { type: "replace", bytes: current };
      }
      previous = current;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

interface ObservedSource {
  iterator: AsyncIterator<AgentFileWatchChunk>;
  titleIndex: boolean;
  pending?: Promise<{ source: ObservedSource; result: IteratorResult<AgentFileWatchChunk> }>;
}

function scheduleNext(source: ObservedSource): void {
  source.pending = source.iterator.next().then((result) => ({ source, result }));
}

function sessionTitle(record: unknown, sessionId: string): string | undefined {
  const entry = object(record);
  return entry?.id === sessionId ? bounded(LIMITS.title, entry.thread_name) : undefined;
}

function titleChunk(sessionId: string, title: string): AgentFileWatchChunk {
  return {
    type: "append",
    bytes: new TextEncoder().encode(`${JSON.stringify({ type: SESSION_TITLE_RECORD, sessionId, title })}\n`),
  };
}

function isRolloutPath(path: string): boolean {
  // `path` is display metadata supplied by the environment, not a filesystem
  // authority. The actual proof remains the broker-issued writable handle.
  return /(?:^|[\\/])rollout-[^\\/]+\.jsonl$/u.test(path)
    && /(?:^|[\\/])sessions(?:[\\/]|$)/u.test(path);
}

function rootSessionId(record: unknown): string | undefined {
  const envelope = object(record);
  const payload = object(envelope?.payload);
  if (envelope?.type !== "session_meta" || !payload) return undefined;
  const sessionId = bounded(LIMITS.sessionId, payload.id, payload.session_id);
  return sessionId && payload.originator === "codex-tui" && payload.source === "cli" ? sessionId : undefined;
}

/** Maps one bounded Codex rollout record to public canonical lifecycle facts. */
export function mapCodexRecord(record: unknown, context: AgentRecordContext, state: CodexState = { promptPublished: false }): void {
  const envelope = object(record);
  if (context.journal?.role === "child") {
    mapCodexChildRecord(record, context, state);
    return;
  }
  if (envelope?.type === SESSION_TITLE_RECORD) {
    const title = bounded(LIMITS.title, envelope.title);
    if (title && bounded(LIMITS.sessionId, envelope.sessionId) === context.binding.providerSessionId) {
      context.publish.metadataChanged({ title });
    }
    return;
  }
  const payload = object(envelope?.payload);
  if (!envelope || !payload) return;
  const occurredAt = timestamp(envelope);
  const publish = context.publish;
  const started = (): void => {
    finishActiveWait(publish, state, occurredAt);
  };

  if (envelope.type === "session_meta") {
    if (rootSessionId(envelope) !== context.binding.providerSessionId) return;
    publish.sessionStarted({ title: "Codex", model: model(payload), ...(occurredAt ? { occurredAt } : {}) });
    return;
  }
  if (envelope.type === "turn_context") return;
  if (envelope.type === "response_item") {
    const itemType = bounded(100, payload.type);
    if (itemType === "custom_tool_call" || itemType === "function_call" || itemType === "local_shell_call") {
      const tool = toolFields(payload);
      if (tool) { started(); publish.toolStarted({ ...tool, ...(occurredAt ? { occurredAt } : {}) }); }
    } else if (itemType === "custom_tool_call_output" || itemType === "function_call_output" || itemType === "local_shell_call_output") {
      const toolId = bounded(LIMITS.toolId, payload.call_id, payload.id);
      if (toolId) { started(); publish.toolFinished({ toolId, outcome: outcome(payload), ...(occurredAt ? { occurredAt } : {}) }); }
    }
    return;
  }
  if (envelope.type !== "event_msg") return;

  const eventType = bounded(100, payload.type);
  if (!eventType) return;
  if (eventType === "task_started" || eventType === "turn_started") {
    const turnId = bounded(LIMITS.toolId, payload.turn_id);
    if (turnId) { started(); publish.turnStarted({ turnId, ...(occurredAt ? { occurredAt } : {}) }); }
    return;
  }
  if (eventType === "user_message") {
    publishPrompt(payload.message, bounded(LIMITS.toolId, payload.turn_id), publish, state, occurredAt);
    return;
  }
  if (eventType === "item_completed") {
    const prompt = completedUserMessage(payload);
    if (prompt) publishPrompt(prompt, undefined, publish, state, occurredAt);
    const item = object(payload.item);
    if (item?.type === "CollabAgentToolCall") mapCollabTool(item, publish, occurredAt);
    if (item?.type === "SubAgentActivity") mapSubagentActivity(item, publish, occurredAt);
    return;
  }
  if (eventType === "task_complete" || eventType === "turn_complete") {
    publish.done({ outcome: outcome(payload), ...(occurredAt ? { occurredAt } : {}) }); return;
  }
  if (eventType === "turn_aborted") { publish.done({ outcome: "cancelled", ...(occurredAt ? { occurredAt } : {}) }); return; }
  if (eventType === "error") { publish.done({ outcome: "error", ...(occurredAt ? { occurredAt } : {}) }); return; }
  if (eventType === "shutdown_complete") { publish.publish({ kind: "session.stopped", reason: "shutdown", ...(occurredAt ? { occurredAt } : {}) }); return; }
  if (isWaitEvent(eventType)) {
    const waitId = bounded(LIMITS.toolId, payload.request_id, payload.call_id, payload.id) ?? `codex:${eventType}`;
    state.activeWait = waitId;
    publish.waitStarted({ waitId, state: "waiting", reason: eventType, ...(occurredAt ? { occurredAt } : {}) });
    return;
  }
  if (eventType === "collab_agent_spawn_end") { mapCollabSpawn(payload, publish, occurredAt); return; }
  if (eventType === "collab_agent_interaction_end" || eventType === "collab_resume_end") { mapCollabInteraction(payload, publish, occurredAt); return; }
  if (eventType === "collab_close_end" || eventType === "collab_agent_shutdown") { mapCollabClose(payload, publish, occurredAt); return; }
  if (eventType === "sub_agent_activity") { mapSubagentActivity(payload, publish, occurredAt); return; }
  if (eventType.endsWith("_begin")) {
    const tool = toolFields(payload, eventType.slice(0, -6));
    if (tool) { started(); publish.toolStarted({ ...tool, ...(occurredAt ? { occurredAt } : {}) }); }
  } else if (eventType.endsWith("_end")) {
    const tool = toolFields(payload, eventType.slice(0, -4));
    if (tool) { started(); publish.toolFinished({ toolId: tool.toolId, outcome: outcome(payload), ...(occurredAt ? { occurredAt } : {}) }); }
  }
}

/** Maps a separately persisted Codex child rollout into its already-bound root. */
function mapCodexChildRecord(record: unknown, context: AgentRecordContext, state: CodexState): void {
  const envelope = object(record);
  const payload = object(envelope?.payload);
  if (!envelope || !payload || context.journal.role !== "child") return;
  const childId = context.journal.childId;
  const occurredAt = timestamp(envelope);
  const at = occurredAt ? { occurredAt } : {};
  const publish = context.publish;
  const finishWait = (): void => finishActiveWait(publish, state, occurredAt, childId);
  if (envelope.type === "session_meta") {
    const child = childRollout(envelope, context.binding.providerSessionId);
    if (!child || child.sessionId !== childId) return;
    const source = object(payload.source);
    const subagent = object(source?.subagent);
    const spawn = object(subagent?.thread_spawn);
    publish.subagentStarted({
      subagentId: childId,
      ...(agentTitle({ ...payload, ...spawn }) ? { title: agentTitle({ ...payload, ...spawn }) } : {}),
      ...(model(payload) ? { model: model(payload) } : {}),
      ...at,
    });
    return;
  }
  if (envelope.type === "turn_context") return;
  if (envelope.type === "response_item") {
    const itemType = bounded(100, payload.type);
    if (itemType === "custom_tool_call" || itemType === "function_call" || itemType === "local_shell_call") {
      const tool = toolFields(payload);
      if (tool) { finishWait(); publish.toolStarted({ agentId: childId, ...tool, ...at }); }
    } else if (itemType === "custom_tool_call_output" || itemType === "function_call_output" || itemType === "local_shell_call_output") {
      const toolId = bounded(LIMITS.toolId, payload.call_id, payload.id);
      if (toolId) { finishWait(); publish.toolFinished({ agentId: childId, toolId, outcome: outcome(payload), ...at }); }
    }
    return;
  }
  if (envelope.type !== "event_msg") return;
  const eventType = bounded(100, payload.type);
  if (!eventType) return;
  if (eventType === "task_started" || eventType === "turn_started") {
    const turnId = bounded(LIMITS.toolId, payload.turn_id);
    if (turnId) { finishWait(); publish.turnStarted({ agentId: childId, turnId, ...at }); }
    return;
  }
  if (eventType === "user_message") { publishPrompt(payload.message, bounded(LIMITS.toolId, payload.turn_id), publish, state, occurredAt, childId); return; }
  if (eventType === "item_completed") {
    const prompt = completedUserMessage(payload);
    if (prompt) publishPrompt(prompt, undefined, publish, state, occurredAt, childId);
    return;
  }
  if (eventType === "task_complete" || eventType === "turn_complete") { publish.done({ agentId: childId, outcome: outcome(payload), ...at }); return; }
  if (eventType === "turn_aborted") { publish.done({ agentId: childId, outcome: "cancelled", ...at }); return; }
  if (eventType === "error") { publish.done({ agentId: childId, outcome: "error", ...at }); return; }
  if (eventType === "shutdown_complete") { publish.exited({ agentId: childId, ...at }); return; }
  if (isWaitEvent(eventType)) {
    const waitId = bounded(LIMITS.toolId, payload.request_id, payload.call_id, payload.id) ?? `codex:${eventType}`;
    state.activeWait = waitId;
    publish.waitStarted({ agentId: childId, waitId, state: "waiting", reason: eventType, ...at });
    return;
  }
  if (eventType.endsWith("_begin")) {
    const tool = toolFields(payload, eventType.slice(0, -6));
    if (tool) { finishWait(); publish.toolStarted({ agentId: childId, ...tool, ...at }); }
  } else if (eventType.endsWith("_end")) {
    const tool = toolFields(payload, eventType.slice(0, -4));
    if (tool) { finishWait(); publish.toolFinished({ agentId: childId, toolId: tool.toolId, outcome: outcome(payload), ...at }); }
  }
}

function publishPrompt(value: unknown, turnId: string | undefined, publish: AgentLifecyclePublisher, state: CodexState, occurredAt?: string, agentId?: string): void {
  const promptText = codexPromptText(value);
  if (!promptText || state.promptPublished) return;
  state.promptPublished = true;
  // Newer Codex event envelopes provide a stable native turn id. Older
  // UserMessage records do not; metadata keeps the root label without
  // inventing an identity from timing or content.
  if (turnId) publish.turnStarted({ ...(agentId ? { agentId } : {}), turnId, promptText, ...(occurredAt ? { occurredAt } : {}) });
  else publish.metadataChanged({ ...(agentId ? { agentId } : {}), promptText, ...(occurredAt ? { occurredAt } : {}) });
}

function mapCollabTool(item: JsonObject, publish: AgentLifecyclePublisher, occurredAt?: string): void {
  const tool = bounded(100, item.tool);
  if (tool === "spawn_agent") {
    for (const receiver of receivers(item)) {
      publish.subagentStarted({
        subagentId: receiver.id,
        ...(receiver.title ? { title: receiver.title } : {}),
        ...(bounded(LIMITS.prompt, item.prompt) ? { promptText: bounded(LIMITS.prompt, item.prompt) } : {}),
        ...(model(item) ? { model: model(item) } : {}),
        ...(occurredAt ? { occurredAt } : {}),
      });
    }
  } else if (tool === "wait") {
    const states = object(item.agents_states);
    for (const [id, status] of Object.entries(states ?? {})) {
      const subagentId = bounded(LIMITS.toolId, id);
      const result = agentOutcome(status);
      if (subagentId && result) publish.subagentDone({ subagentId, outcome: result, ...(occurredAt ? { occurredAt } : {}) });
    }
  }
}

function mapCollabSpawn(payload: JsonObject, publish: AgentLifecyclePublisher, occurredAt?: string): void {
  const subagentId = bounded(LIMITS.toolId, payload.new_thread_id, payload.agent_id, payload.thread_id, payload.receiver_thread_id);
  if (!subagentId) return;
  publish.subagentStarted({
    subagentId,
    ...(bounded(LIMITS.toolId, payload.sender_thread_id, payload.parent_agent_id) ? { parentAgentId: bounded(LIMITS.toolId, payload.sender_thread_id, payload.parent_agent_id) } : {}),
    ...(agentTitle(payload) ? { title: agentTitle(payload) } : {}),
    ...(bounded(LIMITS.prompt, payload.prompt) ? { promptText: bounded(LIMITS.prompt, payload.prompt) } : {}),
    ...(model(payload) ? { model: model(payload) } : {}),
    ...(occurredAt ? { occurredAt } : {}),
  });
}

function mapCollabInteraction(payload: JsonObject, publish: AgentLifecyclePublisher, occurredAt?: string): void {
  const subagentId = bounded(LIMITS.toolId, payload.receiver_thread_id, payload.agent_id, payload.thread_id);
  if (!subagentId) return;
  const result = agentOutcome(payload.status);
  if (result) publish.subagentDone({ subagentId, outcome: result, ...(occurredAt ? { occurredAt } : {}) });
  else publish.subagentStarted({ subagentId, ...(agentTitle(payload) ? { title: agentTitle(payload) } : {}), ...(bounded(LIMITS.prompt, payload.prompt) ? { promptText: bounded(LIMITS.prompt, payload.prompt) } : {}), ...(occurredAt ? { occurredAt } : {}) });
}

function mapCollabClose(payload: JsonObject, publish: AgentLifecyclePublisher, occurredAt?: string): void {
  const subagentId = bounded(LIMITS.toolId, payload.receiver_thread_id, payload.agent_id, payload.thread_id);
  if (subagentId) publish.subagentDone({ subagentId, outcome: agentOutcome(payload.status) ?? outcome(payload), ...(occurredAt ? { occurredAt } : {}) });
}

function mapSubagentActivity(payload: JsonObject, publish: AgentLifecyclePublisher, occurredAt?: string): void {
  const subagentId = bounded(LIMITS.toolId, payload.agent_thread_id);
  const kind = bounded(100, payload.kind);
  if (!subagentId || !kind) return;
  if (kind === "started" || kind === "interacted") publish.subagentStarted({ subagentId, ...(agentTitle(payload) ? { title: agentTitle(payload) } : {}), ...(occurredAt ? { occurredAt } : {}) });
  else if (kind === "interrupted" || kind === "completed") publish.subagentDone({ subagentId, outcome: kind === "interrupted" ? "cancelled" : outcome(payload), ...(occurredAt ? { occurredAt } : {}) });
  else if (kind === "stopped" || kind === "shutdown") publish.subagentDone({ subagentId, outcome: outcome(payload), ...(occurredAt ? { occurredAt } : {}) });
}

function finishActiveWait(publish: AgentLifecyclePublisher, state: CodexState, occurredAt?: string, agentId?: string): void {
  if (!state.activeWait) return;
  publish.waitFinished({ ...(agentId ? { agentId } : {}), waitId: state.activeWait, ...(occurredAt ? { occurredAt } : {}) });
  state.activeWait = undefined;
}

function completedUserMessage(payload: JsonObject): string | undefined {
  const item = object(payload.item);
  if (item?.type !== "UserMessage" || !Array.isArray(item.content)) return undefined;
  return item.content.map(object).filter((entry): entry is JsonObject => entry?.type === "text")
    .map((entry) => codexPromptText(entry.text)).filter((entry): entry is string => Boolean(entry)).join("").slice(0, LIMITS.prompt) || undefined;
}

function receivers(item: JsonObject): readonly { id: string; title?: string }[] {
  const result = new Map<string, { id: string; title?: string }>();
  for (const receiver of Array.isArray(item.receiver_agents) ? item.receiver_agents.map(object) : []) {
    const id = bounded(LIMITS.toolId, receiver?.thread_id);
    if (id) result.set(id, { id, ...(bounded(LIMITS.title, receiver?.agent_nickname) ? { title: bounded(LIMITS.title, receiver?.agent_nickname) } : {}) });
  }
  for (const value of Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : []) {
    const id = bounded(LIMITS.toolId, value);
    if (id && !result.has(id)) result.set(id, { id });
  }
  return [...result.values()];
}

function agentTitle(payload: JsonObject): string | undefined {
  const path = bounded(1_000, payload.agent_path);
  return bounded(LIMITS.title, payload.new_agent_nickname, payload.receiver_agent_nickname, payload.agent_nickname, payload.new_agent_role, payload.receiver_agent_role, payload.agent_role, path ? basename(path) : undefined);
}

function toolFields(payload: JsonObject, fallbackName?: string): { toolId: string; name: string } | undefined {
  const item = object(payload.item);
  const toolId = bounded(LIMITS.toolId, payload.call_id, payload.id, item?.call_id, item?.id);
  const name = bounded(LIMITS.toolName, payload.tool_name, payload.name, item?.name, item?.type, fallbackName);
  return toolId && name ? { toolId, name } : undefined;
}

function model(payload: JsonObject): AgentModelMetadata | undefined {
  const id = bounded(LIMITS.title, payload.model, payload.model_provider);
  if (!id) return undefined;
  return {
    id,
    ...(bounded(LIMITS.title, payload.model_display_name) ? { displayName: bounded(LIMITS.title, payload.model_display_name) } : {}),
    ...(bounded(100, payload.effort, payload.reasoning_effort) ? { reasoningEffort: bounded(100, payload.effort, payload.reasoning_effort) } : {}),
  };
}

function codexPromptText(value: unknown): string | undefined {
  const text = bounded(LIMITS.prompt, value);
  return text && !/^\s*<turn_aborted>[\s\S]*<\/turn_aborted>\s*$/u.test(text) ? text : undefined;
}

function isWaitEvent(type: string): boolean {
  return ["exec_approval_request", "apply_patch_approval_request", "request_permissions", "request_user_input", "elicitation_request"].includes(type);
}

function agentOutcome(status: unknown): CompletionOutcome | undefined {
  const name = typeof status === "string" ? status.toLowerCase() : Object.keys(object(status) ?? {})[0]?.toLowerCase();
  if (name === "completed" || name === "shutdown") return "success";
  if (name === "errored" || name === "not_found") return "error";
  if (name === "interrupted") return "cancelled";
  return undefined;
}

function outcome(payload: JsonObject): CompletionOutcome {
  const reason = bounded(100, payload.reason, payload.status)?.toLowerCase();
  if (reason?.includes("cancel") || reason?.includes("abort")) return "cancelled";
  if (payload.error !== undefined || reason?.includes("error") || reason?.includes("fail")) return "error";
  return "success";
}

function timestamp(record: JsonObject): string | undefined {
  const value = bounded(64, record.timestamp);
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function bounded(limit: number, ...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0 && value.length <= limit) return value;
  }
  return undefined;
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}
