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
  type AgentProcessHandle,
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
  fingerprintKind?: string;
  process?: AgentProcessHandle;
  /**
   * Bytes of rollout that already existed when this process adopted it. It is
   * zero for a session this process opened, and the whole recorded history for
   * a `codex resume`, which re-opens an earlier rollout and appends to it.
   */
  historyBytes?: number;
}

interface ChildRollout {
  journal: AgentFileHandle;
  sessionId: string;
}

const SESSION_TITLE_RECORD = "terminay.codex_session_title";

/** Slack between a process's floored start time and its own rollout header. */
const ADOPTION_MARGIN_MS = 5_000;

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
    const restore = codexRestoreCommand(terminal.foreground.arguments);
    const rollout = restore
      ? (await findRestoredRootRollout(terminal, restore)) ?? (await findProcessBoundRootRollout(terminal))
      : await findProcessBoundRootRollout(terminal);
    if (!rollout) return { state: "not-bound" as const };

    const binding = await terminal.bindSession({
      providerSessionId: rollout.sessionId,
      mappingVersion: MAPPING_VERSION,
      journal: rollout.journal,
      fingerprint: {
        kind: rollout.fingerprintKind ?? "writable-file-below-terminal-process",
        file: rollout.sourceFile,
        ...(rollout.process ? { process: rollout.process } : {}),
      },
    });
    // Codex writes user-assigned session names into its terminal-scoped home
    // index rather than the rollout. This is intentionally independent from
    // the rollout fingerprint: the writer-held rollout remains the only
    // authority that binds the session to this PTY.
    const sessionIndex = await findSessionIndex(terminal);
    const sessionsDirectory = await findSessionsDirectory(terminal);
    const recordedChildren = await findChildRollouts(terminal, rollout.sessionId, sessionsDirectory);
    // A subagent recorded before this process adopted the rollout finished
    // under the earlier one. Its rollout is a completed transcript: attaching
    // it would announce a child that starts and can never finish, because
    // what completes a Codex child is a collaboration record in the root's
    // own history, which an adopted binding deliberately does not replay.
    // Those children are excluded from discovery too, so only subagents this
    // process actually spawns are admitted.
    const adopted = (rollout.historyBytes ?? 0) > 0;
    const sources = adopted ? [] : childSources(terminal, recordedChildren);
    const states = new Map<string, CodexState>();
    return jsonlSession({
      binding,
      source: new CodexSessionWatcher({
        terminal,
        rollout: rollout.journal,
        sessionIndex,
        sessionId: rollout.sessionId,
        ...(rollout.historyBytes ? { historyBytes: rollout.historyBytes } : {}),
      }),
      ...(sources.length === 0 ? {} : { childSources: sources }),
      ...(sessionsDirectory === undefined ? {} : {
        // Codex writes a subagent's native session_meta to a separate rollout
        // after the root binding may already be active. The generic host owns
        // admission and stable-id de-duplication; this extension supplies only
        // exact-parent, terminal-scoped journals.
        childSourceDiscovery: discoverChildSources(
          terminal,
          rollout.sessionId,
          sessionsDirectory,
          new Set(recordedChildren.map((child) => child.sessionId)),
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

type CodexRestore =
  | { kind: "last" | "picker" }
  | { kind: "id"; sessionId: string };

/** Codex's documented restore argv: `resume`, `resume --last`, `resume <id>`. */
export function codexRestoreCommand(
  arguments_: readonly string[] | undefined,
): CodexRestore | undefined {
  if (!arguments_) return undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "resume") continue;
    const next = arguments_[index + 1];
    if (next === "--last" || next === "-l") return { kind: "last" };
    if (typeof next === "string" && next.length > 0 && !next.startsWith("-")) {
      return { kind: "id", sessionId: next };
    }
    return { kind: "picker" };
  }
  return undefined;
}

const CHILD_DIRECTORY_OPTIONS = Object.freeze({
  extensions: [".jsonl"],
  maxDepth: 4,
  maxEntries: 256,
  maxBytes: 16 * 1024 * 1024,
});

/**
 * Restore commands close the rollout between writes, so they cannot depend on
 * an open writable handle. Admit an eligible CLI root under this process's
 * sessions tree that was appended after the process started. An explicit
 * `resume <id>` still has to match that id.
 */
async function findRestoredRootRollout(
  terminal: AgentTerminalContext,
  restore: CodexRestore,
): Promise<RootRollout | undefined> {
  const descendants = await terminal.observation.processes.descendants({
    signal: terminal.signal,
  });
  const process = descendants.find((candidate) => isCodexForeground(candidate.executableName));
  const startedAt = process?.startedAt ? Date.parse(process.startedAt) : Number.NaN;
  if (!process || !Number.isFinite(startedAt)) return undefined;
  const sessions = await findSessionsDirectory(terminal);
  if (!sessions) return undefined;
  const listing = await terminal.observation.files.listDirectory(sessions, {
    ...CHILD_DIRECTORY_OPTIONS,
    signal: terminal.signal,
  }).catch(() => undefined);
  if (!listing) return undefined;
  const matches: Array<RootRollout & { modifiedAt: number }> = [];
  for (const entry of listing.entries) {
    if (!isRestoredRolloutPath(entry.relativePath)) continue;
    const modifiedAt = entry.modifiedAt ? Date.parse(entry.modifiedAt) : Number.NaN;
    if (!Number.isFinite(modifiedAt) || modifiedAt < startedAt) continue;
    const journal = await terminal.observation.files.canonicalFile(entry.handle, {
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
    if (restore.kind === "id" && sessionId !== restore.sessionId) continue;
    matches.push({
      journal,
      sourceFile: journal,
      sessionId,
      modifiedAt,
      fingerprintKind: "sessions-rollout-appended-since-process-start",
      process: process.handle,
    });
  }
  matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!matches[0]) return undefined;
  const { modifiedAt: _modifiedAt, ...selected } = matches[0];
  return selected;
}

function isRestoredRolloutPath(relativePath: string): boolean {
  return /(?:^|[\\/])rollout-[^\\/]+\.jsonl$/u.test(relativePath);
}

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
  // The oldest live Codex process below this terminal. A rollout whose own
  // header predates it was recorded by an earlier process and re-opened here,
  // which is what `codex resume` does.
  const adoptedBefore = Math.min(
    ...descendants
      .filter((candidate) => isCodexForeground(candidate.executableName))
      .map((candidate) => (candidate.startedAt ? Date.parse(candidate.startedAt) : Number.NaN))
      .filter((value) => Number.isFinite(value)),
  );
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
    const recordedAt = rolloutRecordedAt(header);
    // Process start times are floored to the second, so a session opened by
    // this very process can read as marginally older than it. Only a header
    // older than that margin is evidence of an earlier process's session.
    const adopted =
      Number.isFinite(adoptedBefore)
      && recordedAt !== undefined
      && recordedAt < adoptedBefore - ADOPTION_MARGIN_MS;
    matches.push({
      journal,
      sourceFile: candidate.handle,
      sessionId,
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0,
      ...(adopted && stat?.size ? { historyBytes: stat.size } : {}),
      ...(adopted ? { fingerprintKind: "writable-file-below-terminal-process-resumed" } : {}),
    });
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

/** The child rollouts already on disk for this root, newest listing wins. */
async function findChildRollouts(terminal: AgentTerminalContext, parentSessionId: string, sessions: AgentDirectoryHandle | undefined): Promise<readonly ChildRollout[]> {
  if (!sessions) return [];
  try {
    const listing = await terminal.observation.files.listDirectory(sessions, { ...CHILD_DIRECTORY_OPTIONS, signal: terminal.signal });
    const children = new Map<string, ChildRollout>();
    for (const entry of listing.entries) {
      const child = await childSourceForEntry(terminal, parentSessionId, entry.handle);
      if (child && !children.has(child.sessionId)) children.set(child.sessionId, child);
    }
    return [...children.values()].slice(0, 64);
  } catch {
    // Child discovery is optional bounded enrichment. A temporarily missing
    // directory capability must not make the already proven root unavailable.
    return [];
  }
}

function childSources(terminal: AgentTerminalContext, children: readonly ChildRollout[]): readonly AgentChildJournalSource[] {
  return children.map(({ journal, sessionId }) => ({
    childId: sessionId,
    journal,
    source: terminal.observation.files.follow(journal, {
      signal: terminal.signal,
      maxChunkBytes: LIMITS.recordBytes,
    }),
  }));
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
    // Disposal after the terminal signal aborted is itself a cancelled
    // observation request; a cancelled cleanup must not reject the discovery.
    try { await watcher?.dispose(); } catch { /* already torn down by the host */ }
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
    /** Bytes already recorded when this terminal adopted the rollout. */
    historyBytes?: number;
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
    const { terminal, rollout, sessionIndex, sessionId, historyBytes } = this.options;
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
      if (historyBytes !== undefined && historyBytes > 0) {
        // An adopted rollout replays from byte zero, so the recorded history
        // arrives before anything this process writes. Consume exactly that
        // much, publish the trimmed form of it, then stream live appends.
        yield* this.adoptedChunks(rolloutIterator, historyBytes);
      } else {
        // The first rollout chunk always contains session_meta for a newly
        // opened watcher. Yield it before metadata so session.started exists
        // before an explicit title can refine the same root entry.
        const firstRollout = await rolloutIterator.next();
        if (!firstRollout.done && !this.closed && !terminal.signal.aborted) yield firstRollout.value;
      }

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
      try { await Promise.all(watchers.map((watcher) => watcher.dispose())); }
      catch { /* the host cancelled the observation; nothing is left to release */ }
    }
  }

  /**
   * Consumes the recorded history of an adopted rollout and yields it trimmed,
   * followed by whatever this process has already appended past it. Only whole
   * records cross the boundary: a chunk that ends mid-record is split at its
   * last newline so no half line reaches the mapping.
   */
  private async *adoptedChunks(
    iterator: AsyncIterator<AgentFileWatchChunk>,
    historyBytes: number,
  ): AsyncGenerator<AgentFileWatchChunk> {
    const { terminal } = this.options;
    let history: Uint8Array<ArrayBufferLike> = new Uint8Array();
    while (history.byteLength < historyBytes && !this.closed && !terminal.signal.aborted) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = chunkBytes(next.value);
      if (next.value.type === "append") {
        const merged = new Uint8Array(history.byteLength + chunk.byteLength);
        merged.set(history);
        merged.set(chunk, history.byteLength);
        history = merged;
      } else {
        // The rollout was replaced or truncated under the watcher; whatever it
        // holds now is the only history there is.
        history = chunk;
      }
    }
    if (this.closed || terminal.signal.aborted) return;
    let live: Uint8Array<ArrayBufferLike> = new Uint8Array();
    if (history.byteLength > historyBytes) {
      let boundary = Math.min(historyBytes, history.byteLength);
      while (boundary > 0 && history[boundary - 1] !== 0x0a) boundary -= 1;
      live = history.slice(boundary);
      history = history.slice(0, boundary);
    }
    const trimmed = trimAdoptedRollout(history);
    if (trimmed.byteLength > 0) yield { type: "append", bytes: trimmed };
    if (live.byteLength > 0) yield { type: "append", bytes: live };
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
  // Only the winner of each Promise.race is awaited. When the terminal signal
  // aborts, every source rejects at once and the losers would surface as
  // unhandled rejections, which the extension child treats as fatal.
  source.pending.catch(() => undefined);
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

/** When the rollout's own header says the session was first recorded. */
function rolloutRecordedAt(record: unknown): number | undefined {
  const payload = object(object(record)?.payload);
  const recorded = bounded(64, payload?.timestamp) ?? bounded(64, object(record)?.timestamp);
  if (!recorded) return undefined;
  const parsed = Date.parse(recorded);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A turn boundary in the rollout: the record the mapping turns into
 * `turn.started`. Replaying an adopted rollout from the last one publishes the
 * session's present state without re-announcing every turn it already ran.
 */
function isTurnBoundary(record: unknown): boolean {
  const envelope = object(record);
  if (envelope?.type !== "event_msg") return false;
  const payload = object(envelope.payload);
  const eventType = bounded(100, payload?.type);
  return eventType === "task_started" || eventType === "turn_started";
}

/**
 * Trims an already-recorded rollout to what a rebinding terminal must publish:
 * the session header, so the root carries its identity and model, and the last
 * turn, so its state is the state that turn ended in. Everything between is
 * history the session already reported while it was live, and republishing it
 * would show a resumed terminal re-running work that finished long ago.
 */
export function trimAdoptedRollout(history: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(history);
  const lines = text.split("\n");
  const parsed = lines.map((line) => {
    if (!line) return undefined;
    try { return JSON.parse(line) as unknown; }
    catch { return undefined; }
  });
  let header: string | undefined;
  let lastTurn = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const record = parsed[index];
    if (record === undefined) continue;
    if (header === undefined && object(record)?.type === "session_meta") header = lines[index];
    if (isTurnBoundary(record)) lastTurn = index;
  }
  if (lastTurn === -1) return history;
  const kept = [
    ...(header === undefined ? [] : [header]),
    // The subagents of the retained turn belong to the process that ran it and
    // are not re-attached, so their lifecycle records are left behind with the
    // rest of the history rather than announcing children nothing can finish.
    ...lines.slice(lastTurn).filter((line, offset) => line && !isSubagentLifecycle(parsed[lastTurn + offset])),
  ];
  return new TextEncoder().encode(`${kept.join("\n")}\n`);
}

/**
 * A watch chunk's payload. The host may hand a chunk's bytes across a process
 * boundary as a plain array of numbers rather than a typed array, so nothing
 * may assume `byteLength` is defined on it.
 */
function chunkBytes(chunk: AgentFileWatchChunk): Uint8Array {
  const bytes = chunk.bytes as unknown;
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(Array.isArray(bytes) ? bytes : []);
}

/** Records that announce or close a Codex subagent. */
function isSubagentLifecycle(record: unknown): boolean {
  const envelope = object(record);
  if (envelope?.type !== "event_msg") return false;
  const payload = object(envelope.payload);
  const eventType = bounded(100, payload?.type);
  if (!eventType) return false;
  if (eventType.startsWith("collab_") || eventType === "sub_agent_activity") return true;
  const item = bounded(100, object(payload?.item)?.type);
  return eventType === "item_completed" && (item === "CollabAgentToolCall" || item === "SubAgentActivity");
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
  if (eventType === "shutdown_complete") { publish.sessionStopped({ reason: "shutdown", ...(occurredAt ? { occurredAt } : {}) }); return; }
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
