import {
  defineAgentProvider,
  jsonlSession,
  type AgentFileHandle,
  type AgentFileWatchChunk,
  type AgentFileWatcher,
  type AgentLifecyclePublisher,
  type AgentModelMetadata,
  type AgentProcessSnapshot,
  type AgentRecordContext,
  type AgentTerminalContext,
} from "@terminay/extension-api";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { LIMITS, MAPPING_VERSION, SESSION_TITLE_RECORD } from "./constants.js";

type JsonObject = Record<string, unknown>;
type CompletionOutcome = "success" | "error" | "cancelled";

interface GrokRoot {
  journal: AgentFileHandle;
  sourceFile: AgentFileHandle;
  sessionId: string;
  modifiedAt: number;
  grokHome?: string;
  fingerprintKind?: string;
  process?: AgentProcessSnapshot["handle"];
}

export interface GrokState {
  started: boolean;
  title?: string;
  model?: AgentModelMetadata;
  pendingTools: Map<string, string[]>;
  pendingWaits: Map<string, string[]>;
  nextTool: number;
  nextWait: number;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const EVENTS_RELATIVE = /^[^\\/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/events\.jsonl$/iu;
const EVENTS_DISPLAY = /(?:^|[\\/])sessions[\\/][^\\/]+[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/]events\.jsonl$/iu;

/**
 * Documents the native Grok home convention for local Node integrations.
 * Agent observation itself always uses the terminal's environment-routed
 * broker, so remote sessions never accidentally read the local server home.
 */
export function effectiveGrokHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.GROK_HOME?.trim();
  return resolve(configured || resolve(homedir(), ".grok"));
}

/** Grok is recognized by its executable, never by the Cursor `agent` alias. */
export function isGrokForeground(executableName: string): boolean {
  const name = basename(executableName).trim().toLowerCase();
  return name === "grok" || name.startsWith("grok-") || name.startsWith("grok_") || name.startsWith("grok.");
}

export function createGrokRecordMapper(): (record: unknown, context: AgentRecordContext) => void {
  const state: GrokState = {
    started: false,
    pendingTools: new Map(),
    pendingWaits: new Map(),
    nextTool: 0,
    nextWait: 0,
  };
  return (record, context) => mapGrokRecord(record, context, state);
}

export const grokAgentProvider = defineAgentProvider({
  mappingVersion: MAPPING_VERSION,

  matchesForeground(process) {
    return isGrokForeground(process.executableName);
  },

  async observe(terminal) {
    if (!terminal.capabilities.has("process-observation")
      || !terminal.capabilities.has("filesystem-observation")
      || !terminal.capabilities.has("agent-journal")) {
      return { state: "unavailable" as const, reason: "environment-capability-missing" as const };
    }

    const root = await findProcessBoundRoot(terminal) ?? await findActiveSessionRoot(terminal);
    if (!root) return { state: "not-bound" as const };

    const binding = await terminal.bindSession({
      providerSessionId: root.sessionId,
      mappingVersion: MAPPING_VERSION,
      journal: root.journal,
      fingerprint: {
        kind: root.fingerprintKind ?? "writable-file-below-terminal-process",
        file: root.sourceFile,
        ...(root.process ? { process: root.process } : {}),
      },
    });
    return jsonlSession({
      binding,
      source: new GrokSessionWatcher({
        terminal,
        events: root.journal,
        summary: await findSummary(terminal, root),
        sessionId: root.sessionId,
      }),
      mapRecord: createGrokRecordMapper(),
    });
  },
});

async function findProcessBoundRoot(terminal: AgentTerminalContext): Promise<Omit<GrokRoot, "modifiedAt"> | undefined> {
  const descendants = await terminal.observation.processes.descendants({ signal: terminal.signal });
  const writable = await terminal.observation.processes.openFiles(descendants, {
    access: "writable",
    signal: terminal.signal,
  });
  let grokHome: string | undefined;
  try {
    const environment = await terminal.observation.processes.environment(["GROK_HOME"], { signal: terminal.signal });
    grokHome = environment.GROK_HOME?.trim() || undefined;
  } catch {
    grokHome = undefined;
  }

  const matches: GrokRoot[] = [];
  for (const candidate of writable.filter((file) => isGrokEventsPath(file.path))) {
    // Do not pass a home-relative `beneath` constraint. macOS login shells often
    // omit HOME from `ps e`, and a missing home directory makes that check fail
    // closed even when the writer-held events.jsonl is already proven.
    const journal = await terminal.observation.files.canonicalFile(candidate.handle, {
      extension: ".jsonl",
      signal: terminal.signal,
    });
    if (!journal) continue;
    const sessionId = await sessionIdFor(terminal, journal, grokHome, candidate.path);
    if (!sessionId) continue;
    if (!await isPrimaryRoot(terminal, journal, sessionId)) continue;
    const stat = await terminal.observation.files.stat(journal, { signal: terminal.signal });
    const modifiedAt = stat?.modifiedAt ? Date.parse(stat.modifiedAt) : Number.NaN;
    matches.push({
      journal,
      sourceFile: candidate.handle,
      sessionId,
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0,
      ...(grokHome ? { grokHome } : {}),
    });
  }
  matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!matches[0]) return undefined;
  const { modifiedAt: _modifiedAt, ...selected } = matches[0];
  return selected;
}

/**
 * Grok's live-session registry maps an OS pid to a session UUID. Join that
 * pid to a descendant of this PTY; never use cwd or newest-file selection.
 */
async function findActiveSessionRoot(terminal: AgentTerminalContext): Promise<Omit<GrokRoot, "modifiedAt"> | undefined> {
  const descendants = await terminal.observation.processes.descendants({ signal: terminal.signal });
  const byPid = new Map<number, AgentProcessSnapshot>();
  for (const process of descendants) {
    if (typeof process.pid === "number" && Number.isInteger(process.pid) && process.pid > 0) {
      byPid.set(process.pid, process);
    }
  }
  if (byPid.size === 0) return undefined;

  const registry = await readActiveSessions(terminal);
  if (!registry) return undefined;
  const matches = registry.sessions.filter((entry) => byPid.has(entry.pid));
  if (matches.length !== 1 || !matches[0]) return undefined;
  const selected = matches[0];
  const process = byPid.get(selected.pid);
  if (!process) return undefined;

  const journal = await resolveSessionJournal(terminal, selected.cwd, selected.sessionId);
  if (!journal || !await isPrimaryRoot(terminal, journal, selected.sessionId)) return undefined;
  return {
    journal,
    sourceFile: registry.handle,
    sessionId: selected.sessionId,
    fingerprintKind: "grok-active-session-registry",
    process: process.handle,
    ...(registry.grokHome ? { grokHome: registry.grokHome } : {}),
  };
}

interface GrokActiveSession {
  readonly sessionId: string;
  readonly pid: number;
  readonly cwd: string;
}

async function readActiveSessions(terminal: AgentTerminalContext): Promise<{
  handle: AgentFileHandle;
  sessions: readonly GrokActiveSession[];
  grokHome?: string;
} | undefined> {
  let grokHome: string | undefined;
  try {
    const environment = await terminal.observation.processes.environment(["GROK_HOME"], { signal: terminal.signal });
    grokHome = environment.GROK_HOME?.trim() || undefined;
  } catch {
    grokHome = undefined;
  }
  const handle = grokHome
    ? await terminal.observation.files.resolveRelativeToEnvironment("active_sessions.json", {
      environmentVariable: "GROK_HOME",
      extension: ".json",
      signal: terminal.signal,
    })
    : await terminal.observation.files.resolveHomeRelative(".grok/active_sessions.json", {
      beneath: { homeRelative: ".grok" },
      extension: ".json",
      signal: terminal.signal,
    });
  if (!handle) return undefined;
  try {
    const bytes = await terminal.observation.files.read(handle, {
      maxBytes: LIMITS.activeSessionsBytes,
      signal: terminal.signal,
    });
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 32) return undefined;
    const sessions = parsed.flatMap((entry) => {
      const row = object(entry);
      const sessionId = bounded(LIMITS.sessionId, row?.session_id);
      const cwd = bounded(LIMITS.cwd, row?.cwd);
      const pid = row?.pid;
      if (!sessionId || !SESSION_ID.test(sessionId) || !cwd?.startsWith("/") || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
        return [];
      }
      return [{ sessionId, pid, cwd }];
    });
    return { handle, sessions, ...(grokHome ? { grokHome } : {}) };
  } catch {
    return undefined;
  }
}

async function resolveSessionJournal(
  terminal: AgentTerminalContext,
  cwd: string,
  sessionId: string,
): Promise<AgentFileHandle | undefined> {
  const encoded = encodeURIComponent(cwd);
  if (!encoded || encoded.includes("..")) return undefined;
  try {
    const environment = await terminal.observation.processes.environment(["GROK_HOME"], { signal: terminal.signal });
    const grokHome = environment.GROK_HOME?.trim();
    if (grokHome) {
      return await terminal.observation.files.resolveRelativeToEnvironment(`sessions/${encoded}/${sessionId}/events.jsonl`, {
        environmentVariable: "GROK_HOME",
        extension: ".jsonl",
        signal: terminal.signal,
      });
    }
  } catch {
    // Fall through to the default home-relative journal.
  }
  return terminal.observation.files.resolveHomeRelative(`.grok/sessions/${encoded}/${sessionId}/events.jsonl`, {
    beneath: { homeRelative: ".grok/sessions" },
    extension: ".jsonl",
    signal: terminal.signal,
  });
}

async function sessionIdFor(
  terminal: AgentTerminalContext,
  journal: AgentFileHandle,
  grokHome: string | undefined,
  displayPath: string,
): Promise<string | undefined> {
  try {
    if (grokHome) {
      const relative = await terminal.observation.files.environmentRelativePath(journal, {
        environmentVariable: "GROK_HOME",
        beneathRelative: "sessions",
        signal: terminal.signal,
      });
      const fromEnvironment = sessionIdFromRelative(relative);
      if (fromEnvironment) return fromEnvironment;
    } else {
      const relative = await terminal.observation.files.homeRelativePath(journal, {
        beneath: { homeRelative: ".grok/sessions" },
        signal: terminal.signal,
      });
      const fromHome = sessionIdFromRelative(relative);
      if (fromHome) return fromHome;
    }
  } catch {
    // Relative-path facts are optional once the writable handle is proven.
  }
  return sessionIdFromDisplayPath(displayPath);
}

async function isPrimaryRoot(terminal: AgentTerminalContext, journal: AgentFileHandle, sessionId: string): Promise<boolean> {
  try {
    const bytes = await terminal.observation.files.read(journal, {
      maxBytes: LIMITS.recordBytes,
      signal: terminal.signal,
    });
    for (const line of new TextDecoder().decode(bytes).split("\n")) {
      if (!line) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      const envelope = object(parsed);
      if (envelope?.type !== "turn_started") continue;
      const recordSession = bounded(LIMITS.sessionId, envelope.session_id);
      if (recordSession && recordSession !== sessionId) return false;
      const relationship = bounded(100, envelope.session_relationship);
      return !relationship || relationship === "primary";
    }
    return true;
  } catch {
    return true;
  }
}

async function findSummary(terminal: AgentTerminalContext, root: Omit<GrokRoot, "modifiedAt">): Promise<AgentFileHandle | undefined> {
  const fromEnvironment = await summaryFromEnvironment(terminal, root);
  if (fromEnvironment) return fromEnvironment;
  return summaryFromHome(terminal, root);
}

async function summaryFromEnvironment(
  terminal: AgentTerminalContext,
  root: Omit<GrokRoot, "modifiedAt">,
): Promise<AgentFileHandle | undefined> {
  try {
    const relative = await terminal.observation.files.environmentRelativePath(root.journal, {
      environmentVariable: "GROK_HOME",
      beneathRelative: "sessions",
      signal: terminal.signal,
    });
    const summaryRelative = summaryRelativePath(relative);
    if (!summaryRelative) return undefined;
    return await terminal.observation.files.resolveRelativeToEnvironment(`sessions/${summaryRelative}`, {
      environmentVariable: "GROK_HOME",
      extension: ".json",
      signal: terminal.signal,
    });
  } catch {
    return undefined;
  }
}

async function summaryFromHome(
  terminal: AgentTerminalContext,
  root: Omit<GrokRoot, "modifiedAt">,
): Promise<AgentFileHandle | undefined> {
  try {
    const relative = await terminal.observation.files.homeRelativePath(root.journal, {
      beneath: { homeRelative: ".grok/sessions" },
      signal: terminal.signal,
    });
    const summaryRelative = summaryRelativePath(relative);
    if (!summaryRelative) return undefined;
    return await terminal.observation.files.resolveHomeRelative(`.grok/sessions/${summaryRelative}`, {
      beneath: { homeRelative: ".grok/sessions" },
      extension: ".json",
      signal: terminal.signal,
    });
  } catch {
    return undefined;
  }
}

function summaryRelativePath(relative: string | undefined): string | undefined {
  return relative?.endsWith("/events.jsonl") ? `${relative.slice(0, -"/events.jsonl".length)}/summary.json` : undefined;
}

/**
 * Merges the events journal with a sibling summary.json title stream. Events
 * remain authoritative: a hanging or rotating summary watcher cannot stall
 * replay, and host follow chunks are split into complete JSONL lines so a
 * resumed journal cannot drop `turn_ended` across the IPC cap.
 */
class GrokSessionWatcher implements AgentFileWatcher {
  private closed = false;

  constructor(private readonly options: {
    terminal: AgentTerminalContext;
    events: AgentFileHandle;
    summary?: AgentFileHandle;
    sessionId: string;
  }) {}

  dispose(): void {
    this.closed = true;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentFileWatchChunk> {
    yield* this.followedChunks();
  }

  private async *followedChunks(): AsyncGenerator<AgentFileWatchChunk> {
    const { terminal, events, summary, sessionId } = this.options;
    const watchOptions = { signal: terminal.signal, maxChunkBytes: LIMITS.followChunkBytes };
    const eventsWatcher = await terminal.observation.files.follow(events, watchOptions);
    let summaryWatcher: AgentFileWatcher | undefined;
    if (summary !== undefined) {
      try {
        summaryWatcher = await terminal.observation.files.follow(summary, watchOptions);
      } catch {
        // Title enrichment is optional. The writer-held events journal remains
        // the binding authority.
      }
    }
    const watchers = [eventsWatcher, ...(summaryWatcher === undefined ? [] : [summaryWatcher])];
    const pendingEvents = { text: "" };
    let lastTitle: string | undefined;
    let lastModelId: string | undefined;
    try {
      const eventsIterator = eventsWatcher[Symbol.asyncIterator]();
      const firstEvents = await eventsIterator.next();
      if (!firstEvents.done && !this.closed && !terminal.signal.aborted) {
        const complete = completeLines(pendingEvents, firstEvents.value);
        if (complete) yield complete;
      }

      const sources: ObservedSource[] = [{ iterator: eventsIterator, title: false }];
      if (summaryWatcher !== undefined) {
        sources.push({ iterator: summaryWatcher[Symbol.asyncIterator](), title: true });
      }
      for (const source of sources) scheduleNext(source);
      while (!this.closed && !terminal.signal.aborted && sources.some((source) => source.pending !== undefined)) {
        const ready = await Promise.race(
          sources.flatMap((source) => source.pending === undefined ? [] : [source.pending]),
        );
        ready.source.pending = undefined;
        if (ready.result.done) continue;
        if (!ready.source.title) {
          const complete = completeLines(pendingEvents, ready.result.value);
          scheduleNext(ready.source);
          if (complete) yield complete;
          continue;
        }
        // summary.json is rewritten as a whole document. A grow-in-place
        // rewrite looks like a JSONL tail-append to the host follower, so
        // always re-read the current document from the issued handle.
        const metadata = summary === undefined ? undefined : await readSummaryMetadata(terminal, summary, sessionId);
        scheduleNext(ready.source);
        if (!metadata) continue;
        if (metadata.title === lastTitle && metadata.modelId === lastModelId) continue;
        lastTitle = metadata.title;
        lastModelId = metadata.modelId;
        yield metadata.chunk;
      }
    } finally {
      this.closed = true;
      await Promise.all(watchers.map((watcher) => watcher.dispose()));
    }
  }
}

interface ObservedSource {
  iterator: AsyncIterator<AgentFileWatchChunk>;
  title: boolean;
  pending?: Promise<{ source: ObservedSource; result: IteratorResult<AgentFileWatchChunk> }>;
}

function scheduleNext(source: ObservedSource): void {
  source.pending = source.iterator.next().then((result) => ({ source, result }));
}

function completeLines(
  pending: { text: string },
  chunk: AgentFileWatchChunk,
): AgentFileWatchChunk | undefined {
  const bytes = chunkBytes(chunk.bytes);
  if (bytes.byteLength === 0) return undefined;
  if (chunk.type !== "append") pending.text = "";
  pending.text += new TextDecoder().decode(bytes);
  const lines = pending.text.split("\n");
  pending.text = lines.pop() ?? "";
  if (lines.length === 0) return undefined;
  return { type: chunk.type, bytes: new TextEncoder().encode(`${lines.join("\n")}\n`) };
}

function chunkBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value);
  }
  return new Uint8Array();
}

async function readSummaryMetadata(
  terminal: AgentTerminalContext,
  summary: AgentFileHandle,
  sessionId: string,
): Promise<{ title?: string; modelId?: string; chunk: AgentFileWatchChunk } | undefined> {
  try {
    const bytes = await terminal.observation.files.read(summary, {
      maxBytes: LIMITS.summaryBytes,
      signal: terminal.signal,
    });
    return metadataChunk(chunkBytes(bytes), sessionId);
  } catch {
    return undefined;
  }
}

function metadataChunk(bytes: Uint8Array, sessionId: string): {
  title?: string;
  modelId?: string;
  chunk: AgentFileWatchChunk;
} | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const document = Array.isArray(parsed) ? object(parsed[0]) : object(parsed);
    if (!document) return undefined;
    const info = object(document.info);
    const recordedId = bounded(LIMITS.sessionId, info?.id, document.id);
    if (recordedId && recordedId !== sessionId) return undefined;
    const title = bounded(LIMITS.title, document.generated_title, document.session_summary);
    const modelId = bounded(LIMITS.title, document.current_model_id);
    if (!title && !modelId) return undefined;
    const value = JSON.stringify({
      type: SESSION_TITLE_RECORD,
      sessionId,
      ...(title ? { title } : {}),
      ...(modelId ? { modelId } : {}),
    });
    return {
      ...(title ? { title } : {}),
      ...(modelId ? { modelId } : {}),
      chunk: { type: "append", bytes: new TextEncoder().encode(`${value}\n`) },
    };
  } catch {
    return undefined;
  }
}

/** Maps one bounded Grok events.jsonl record to public canonical lifecycle facts. */
export function mapGrokRecord(record: unknown, context: AgentRecordContext, state: GrokState = emptyState()): void {
  const envelope = object(record);
  if (!envelope) return;
  if (context.journal?.role === "child") return;
  const occurredAt = timestamp(envelope);
  const at = occurredAt ? { occurredAt } : {};
  const publish = context.publish;

  if (envelope.type === SESSION_TITLE_RECORD) {
    if (bounded(LIMITS.sessionId, envelope.sessionId) !== context.binding.providerSessionId) return;
    const title = bounded(LIMITS.title, envelope.title);
    const modelId = bounded(LIMITS.title, envelope.modelId);
    if (title) state.title = title;
    if (modelId) state.model = { id: modelId };
    if (title || modelId) {
      // bindSession already materialized the root as idle. Title/model must
      // refine that row even before the first native turn; gating on the
      // mapper's local started flag dropped the one-shot summary and every
      // later rewrite.
      publish.metadataChanged({
        ...(title ? { title } : {}),
        ...(state.model ? { model: state.model } : {}),
        ...at,
      });
    }
    return;
  }

  const type = bounded(100, envelope.type);
  if (!type) return;

  if (type === "turn_started") {
    const sessionId = bounded(LIMITS.sessionId, envelope.session_id);
    if (sessionId && sessionId !== context.binding.providerSessionId) return;
    const relationship = bounded(100, envelope.session_relationship);
    if (relationship && relationship !== "primary") return;
    const model = modelMetadata(envelope.model_id);
    if (model) state.model = model;
    ensureStarted(publish, state, at);
    const turnId = turnIdFor(envelope.turn_number);
    if (turnId) publish.turnStarted({ turnId, ...at });
    return;
  }
  if (type === "tool_started") {
    const name = bounded(LIMITS.toolName, envelope.tool_name);
    if (!name) return;
    ensureStarted(publish, state, at);
    finishActiveWait(publish, state, name, at);
    const toolId = `grok:tool:${name}:${++state.nextTool}`;
    queue(state.pendingTools, name, toolId);
    publish.toolStarted({ toolId, name, ...at });
    return;
  }
  if (type === "tool_completed") {
    const name = bounded(LIMITS.toolName, envelope.tool_name);
    if (!name) return;
    ensureStarted(publish, state, at);
    finishActiveWait(publish, state, name, at);
    const toolId = dequeue(state.pendingTools, name) ?? bounded(LIMITS.toolId, envelope.tool_call_id);
    if (toolId) publish.toolFinished({ toolId, outcome: outcome(envelope.outcome), ...at });
    return;
  }
  if (type === "permission_requested") {
    const name = bounded(LIMITS.toolName, envelope.tool_name);
    if (!name) return;
    ensureStarted(publish, state, at);
    const waitId = `grok:permission:${name}:${++state.nextWait}`;
    queue(state.pendingWaits, name, waitId);
    publish.waitStarted({ waitId, state: "waiting", reason: "permission_requested", ...at });
    return;
  }
  if (type === "permission_resolved") {
    const name = bounded(LIMITS.toolName, envelope.tool_name);
    if (!name) return;
    const waitId = dequeue(state.pendingWaits, name);
    if (waitId) publish.waitFinished({ waitId, ...at });
    return;
  }
  if (type === "mcp_tool_call_started") {
    const toolId = bounded(LIMITS.toolId, envelope.call_id);
    const name = bounded(LIMITS.toolName, envelope.tool_name, envelope.server_name);
    if (!toolId || !name) return;
    ensureStarted(publish, state, at);
    publish.toolStarted({ toolId, name, ...at });
    return;
  }
  if (type === "mcp_tool_call_completed") {
    const toolId = bounded(LIMITS.toolId, envelope.call_id);
    if (!toolId) return;
    ensureStarted(publish, state, at);
    publish.toolFinished({ toolId, outcome: envelope.success === false ? "error" : "success", ...at });
    return;
  }
  if (type === "turn_ended") {
    ensureStarted(publish, state, at);
    publish.done({ outcome: outcome(envelope.outcome), ...at });
  }
}

function ensureStarted(publish: AgentLifecyclePublisher, state: GrokState, at: { occurredAt?: string }): void {
  if (state.started) return;
  state.started = true;
  publish.sessionStarted({
    title: state.title ?? "Grok",
    ...(state.model ? { model: state.model } : {}),
    ...at,
  });
}

function finishActiveWait(
  publish: AgentLifecyclePublisher,
  state: GrokState,
  toolName: string,
  at: { occurredAt?: string },
): void {
  const waitId = dequeue(state.pendingWaits, toolName) ?? dequeueAny(state.pendingWaits);
  if (waitId) publish.waitFinished({ waitId, ...at });
}

function queue(store: Map<string, string[]>, key: string, value: string): void {
  const pending = store.get(key) ?? [];
  pending.push(value);
  store.set(key, pending);
}

function dequeue(store: Map<string, string[]>, key: string): string | undefined {
  const pending = store.get(key);
  const value = pending?.shift();
  if (pending && pending.length === 0) store.delete(key);
  return value;
}

function dequeueAny(store: Map<string, string[]>): string | undefined {
  for (const key of store.keys()) {
    const value = dequeue(store, key);
    if (value) return value;
  }
  return undefined;
}

function modelMetadata(value: unknown): AgentModelMetadata | undefined {
  const id = bounded(LIMITS.title, value);
  return id ? { id } : undefined;
}

function turnIdFor(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000) return `grok-turn-${value}`;
  const text = bounded(LIMITS.toolId, value);
  return text ? `grok-turn-${text}` : undefined;
}

function outcome(value: unknown): CompletionOutcome {
  const reason = bounded(100, value)?.toLowerCase();
  if (reason?.includes("cancel") || reason?.includes("abort") || reason?.includes("interrupt")) return "cancelled";
  if (reason?.includes("error") || reason?.includes("fail")) return "error";
  return "success";
}

function timestamp(record: JsonObject): string | undefined {
  const value = bounded(64, record.ts, record.timestamp);
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function isGrokEventsPath(path: string): boolean {
  return EVENTS_DISPLAY.test(path);
}

function sessionIdFromDisplayPath(path: string): string | undefined {
  const match = EVENTS_DISPLAY.exec(path);
  const sessionId = match?.[1];
  return sessionId && SESSION_ID.test(sessionId) ? sessionId : undefined;
}

function sessionIdFromRelative(relative: string | undefined): string | undefined {
  const match = relative ? EVENTS_RELATIVE.exec(relative) : undefined;
  const sessionId = match?.[1];
  return sessionId && SESSION_ID.test(sessionId) ? sessionId : undefined;
}

function emptyState(): GrokState {
  return {
    started: false,
    pendingTools: new Map(),
    pendingWaits: new Map(),
    nextTool: 0,
    nextWait: 0,
  };
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
