import {
  defineAgentProvider,
  jsonlSession,
  safeAgentString,
  type AgentFileHandle,
  type AgentLifecyclePublisher,
  type AgentRecordContext,
  type AgentTerminalContext,
} from "@terminay/extension-api";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** OMP reserves this fixed prefix for a mutable JSON title record. */
export const OMP_TITLE_SLOT_BYTES = 256;
const MAX_HEADER_BYTES = 64 * 1024;

type JsonRecord = Record<string, unknown>;

interface OmpBreadcrumb {
  readonly sessionFile: string;
  readonly fresh: boolean;
}

type OmpRootScope =
  | { readonly kind: "home"; readonly root: string }
  | { readonly kind: "environment"; readonly environmentVariable: string; readonly root: string };

interface OmpObservationRoot {
  readonly sessions: OmpRootScope;
  readonly terminalSessions: OmpRootScope;
}

const OMP_TERMINAL_ENVIRONMENT_VARIABLES = [
  "OMP_PROFILE", "PI_PROFILE", "PI_CODING_AGENT_DIR", "XDG_DATA_HOME", "XDG_STATE_HOME",
] as const;

/** True for OMP's executable names and only the Bun launcher command shape. */
export function isOmpForeground(process: AgentTerminalContext["foreground"]): boolean {
  if (process.executableName === "omp" || process.executableName === "oh-my-pi") return true;
  if (process.executableName !== "bun") return false;
  return (process.arguments ?? []).some((argument) => /(?:^|\/)omp(?:\/|$)|(?:^|\/)omp(?:\.tsx?|\.js)$/u.test(argument));
}

/**
 * Candidate directories below an environment home. The selected environment
 * is responsible for interpreting home and profile/XDG configuration. The
 * local equivalent is exported separately for direct Node diagnostics/tests.
 */
export function ompJournalRelativeRoots(): readonly { readonly sessions: string; readonly terminalSessions: string }[] {
  return [
    { sessions: ".omp/agent/sessions", terminalSessions: ".omp/agent/terminal-sessions" },
    { sessions: ".local/share/omp/sessions", terminalSessions: ".local/state/omp/terminal-sessions" },
    { sessions: ".local/state/omp/agent/sessions", terminalSessions: ".local/state/omp/agent/terminal-sessions" },
  ];
}

/**
 * Reproduces OMP's documented local root precedence for callers deliberately
 * operating on the Terminay Server host: explicit OMP home, profile,
 * `PI_CODING_AGENT_DIR`, default home, then Linux XDG roots. Remote terminal
 * observation must use the environment broker instead of these local paths.
 */
export function resolveLocalOmpJournalRoots(options: {
  ompHome?: string;
  home?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
} = {}): readonly { readonly sessions: string; readonly terminalSessions: string }[] {
  const home = options.home ?? homedir();
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const agentRoot = (path: string) => ({ sessions: resolve(path, "sessions"), terminalSessions: resolve(path, "terminal-sessions") });
  if (options.ompHome) return [agentRoot(resolve(options.ompHome, "agent"))];
  const profile = environment.OMP_PROFILE ?? environment.PI_PROFILE;
  if (profile?.trim()) return [agentRoot(resolve(home, ".omp", "profiles", profile.trim(), "agent"))];
  const agentDirectory = environment.PI_CODING_AGENT_DIR?.trim();
  if (agentDirectory) return [agentRoot(resolve(agentDirectory))];
  const roots = [agentRoot(resolve(home, ".omp", "agent"))];
  if (platform === "linux") {
    const data = environment.XDG_DATA_HOME?.trim() || join(home, ".local", "share");
    const state = environment.XDG_STATE_HOME?.trim() || join(home, ".local", "state");
    roots.push(
      { sessions: resolve(data, "omp", "sessions"), terminalSessions: resolve(state, "omp", "terminal-sessions") },
      agentRoot(resolve(state, "omp")),
    );
  }
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = `${root.sessions}\0${root.terminalSessions}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const ompAgentProvider = defineAgentProvider({
  mappingVersion: "0.1",

  matchesForeground: isOmpForeground,

  async observe(terminal) {
    if (!terminal.capabilities.has("process-observation")
      || !terminal.capabilities.has("filesystem-observation")
      || !terminal.capabilities.has("agent-journal")) {
      return { state: "unavailable", reason: "environment-capability-missing" } as const;
    }

    // The OMP breadcrumb is authoritative, survives an atomic journal
    // replacement, and binds to the exact PTY. Use it whenever the environment
    // supplies the public terminal/home operations.
    const breadcrumbBound = await bindFromBreadcrumb(terminal);
    if (breadcrumbBound) return breadcrumbBound;

    // The conservative compatibility path is still exact process evidence:
    // a root journal opened for writing by a descendant of this terminal. It
    // never scans a directory or selects the newest same-CWD journal.
    return bindFromOpenRootJournal(terminal);
  },
});

async function bindFromBreadcrumb(terminal: AgentTerminalContext) {
  const files = terminal.observation.files;
  const terminalId = terminal.tty?.deviceId;
  if (!terminalId) return undefined;
  if (!terminalId || !/^[A-Za-z0-9._-]{1,256}$/u.test(terminalId)) return undefined;
  const environment = await terminal.observation.processes.environment(
    OMP_TERMINAL_ENVIRONMENT_VARIABLES,
    { signal: terminal.signal },
  );

  for (const root of ompObservationRoots(environment)) {
    const breadcrumb = await resolveScopedRelative(terminal, root.terminalSessions, terminalId);
    if (!breadcrumb) continue;
    const parsed = parseBreadcrumb(await terminal.observation.files.read(breadcrumb, {
      maxBytes: 8 * 1024,
      signal: terminal.signal,
    }));
    if (!parsed) continue;

    // The host canonicalizes OMP's absolute provider-record path only after it
    // proves containment beneath this explicit environment-home sessions root.
    // The extension never turns it into a local filesystem capability.
    const journal = await resolveScopedProviderPath(terminal, root.sessions, parsed.sessionFile);
    if (!journal || !await isOmpRootJournal(terminal, journal)) continue;
    return boundSession(terminal, journal, breadcrumb, root.sessions);
  }
  return undefined;
}

function ompObservationRoots(environment: Record<string, string>): readonly OmpObservationRoot[] {
  const home = (root: string): OmpRootScope => ({ kind: "home", root });
  const env = (environmentVariable: string, root: string): OmpRootScope => ({ kind: "environment", environmentVariable, root });
  // Match OMP exactly: an explicitly present (including blank) OMP_PROFILE
  // takes precedence over PI_PROFILE.
  const profile = environment.OMP_PROFILE !== undefined
    ? environment.OMP_PROFILE.trim()
    : environment.PI_PROFILE?.trim();
  if (profile) return [{
    sessions: home(`.omp/profiles/${profile}/agent/sessions`),
    terminalSessions: home(`.omp/profiles/${profile}/agent/terminal-sessions`),
  }];
  if (environment.PI_CODING_AGENT_DIR?.trim()) return [{
    sessions: env("PI_CODING_AGENT_DIR", "sessions"),
    terminalSessions: env("PI_CODING_AGENT_DIR", "terminal-sessions"),
  }];
  const roots: OmpObservationRoot[] = [{
    sessions: home(".omp/agent/sessions"), terminalSessions: home(".omp/agent/terminal-sessions"),
  }];
  if (environment.XDG_DATA_HOME?.trim() && environment.XDG_STATE_HOME?.trim()) roots.push({
    sessions: env("XDG_DATA_HOME", "omp/sessions"), terminalSessions: env("XDG_STATE_HOME", "omp/terminal-sessions"),
  });
  if (environment.XDG_STATE_HOME?.trim()) roots.push({
    sessions: env("XDG_STATE_HOME", "omp/agent/sessions"), terminalSessions: env("XDG_STATE_HOME", "omp/agent/terminal-sessions"),
  });
  return roots;
}

async function resolveScopedRelative(terminal: AgentTerminalContext, scope: OmpRootScope, relativePath: string) {
  const path = `${scope.root}/${relativePath}`;
  if (scope.kind === "home") return terminal.observation.files.resolveHomeRelative(path, {
    beneath: { homeRelative: scope.root }, signal: terminal.signal,
  });
  return terminal.observation.files.resolveRelativeToEnvironment(path, {
    environmentVariable: scope.environmentVariable, signal: terminal.signal,
  });
}

async function resolveScopedProviderPath(terminal: AgentTerminalContext, scope: OmpRootScope, providerPath: string) {
  if (scope.kind === "home") return terminal.observation.files.resolvePathUnderHome(providerPath, {
    beneath: { homeRelative: scope.root }, extension: ".jsonl", signal: terminal.signal,
  });
  return terminal.observation.files.resolvePathUnderEnvironment(providerPath, {
    environmentVariable: scope.environmentVariable,
    beneathRelative: scope.root,
    extension: ".jsonl",
    signal: terminal.signal,
  });
}

async function bindFromOpenRootJournal(terminal: AgentTerminalContext) {
  const processes = await terminal.observation.processes.descendants({ signal: terminal.signal });
  const files = await terminal.observation.processes.openFiles(processes, {
    access: "writable",
    signal: terminal.signal,
  });
  for (const openFile of files) {
    if (!openFile.path.endsWith(".jsonl")) continue;
    const journal = await terminal.observation.files.canonicalFile(openFile.handle, {
      extension: ".jsonl",
      signal: terminal.signal,
    });
    if (!journal || !await isOmpRootJournal(terminal, journal)) continue;
    return boundSession(terminal, journal, openFile.handle);
  }
  return { state: "not-bound" } as const;
}

async function boundSession(terminal: AgentTerminalContext, journal: AgentFileHandle, identityFile: AgentFileHandle, sessionsRoot?: OmpRootScope) {
  const header = await extractOmpSessionHeader(terminal, journal);
  if (!header) return { state: "not-bound" } as const;
  const title = await readOmpTitle(terminal, journal);
  const binding = await terminal.bindSession({
    providerSessionId: header.id,
    mappingVersion: "0.1",
    journal,
    fingerprint: { kind: "omp-terminal-breadcrumb-or-writer", file: identityFile },
  });
  return jsonlSession({
    binding,
    source: terminal.observation.files.follow(journal, { signal: terminal.signal }),
    ...(sessionsRoot ? { childSources: await findOmpChildSources(terminal, journal, sessionsRoot) } : {}),
    mapRecord: createOmpRecordMapper({ title }),
  });
}

/**
 * Child journals are admitted only when a writable file below the exact PTY
 * is a direct child of the root journal's provider-owned stem directory. The
 * normalized path fact is safe display metadata, not read authority; reads
 * and follows still use the host-issued opaque handle.
 */
async function findOmpChildSources(terminal: AgentTerminalContext, rootJournal: AgentFileHandle, sessionsRoot: OmpRootScope) {
  const files = terminal.observation.files;
  const rootRelative = await scopedRelativePath(terminal, rootJournal, sessionsRoot);
  if (!rootRelative?.endsWith(".jsonl")) return [];
  const childDirectory = join(dirname(rootRelative), basename(rootRelative, ".jsonl"));
  const descendants = await terminal.observation.processes.descendants({ signal: terminal.signal });
  const openFiles = await terminal.observation.processes.openFiles(descendants, {
    access: "writable", signal: terminal.signal,
  });
  const sources: Array<{ childId: string; journal: AgentFileHandle; source: ReturnType<typeof files.follow> }> = [];
  const seen = new Set<string>();
  for (const openFile of openFiles) {
    const journal = await files.canonicalFile(openFile.handle, {
      ...(sessionsRoot.kind === "home" ? { beneath: { homeRelative: sessionsRoot.root } } : {}),
      extension: ".jsonl", signal: terminal.signal,
    });
    if (!journal) continue;
    const relativePath = await scopedRelativePath(terminal, journal, sessionsRoot);
    if (!relativePath || dirname(relativePath) !== childDirectory) continue;
    const childId = safeId(basename(relativePath, ".jsonl"));
    if (!childId || seen.has(childId) || !await extractOmpSessionHeader(terminal, journal)) continue;
    seen.add(childId);
    sources.push({ childId, journal, source: files.follow(journal, { signal: terminal.signal }) });
  }
  return sources;
}

async function scopedRelativePath(terminal: AgentTerminalContext, handle: AgentFileHandle, scope: OmpRootScope) {
  if (scope.kind === "home") return terminal.observation.files.homeRelativePath(handle, {
    beneath: { homeRelative: scope.root }, signal: terminal.signal,
  });
  return terminal.observation.files.environmentRelativePath(handle, {
    environmentVariable: scope.environmentVariable,
    beneathRelative: scope.root,
    signal: terminal.signal,
  });
}

/** Validates OMP's fixed-width prefix and following logical session header. */
export async function extractOmpSessionHeader(terminal: AgentTerminalContext, journal: AgentFileHandle): Promise<{ readonly id: string } | undefined> {
  const bytes = await terminal.observation.files.read(journal, {
    maxBytes: MAX_HEADER_BYTES,
    signal: terminal.signal,
  });
  if (bytes.byteLength <= OMP_TITLE_SLOT_BYTES) return undefined;
  const line = new TextDecoder().decode(bytes.slice(OMP_TITLE_SLOT_BYTES)).split("\n", 1)[0];
  const record = parseJsonRecord(line);
  return record?.type === "session" && safeId(record.id) ? { id: safeId(record.id)! } : undefined;
}

async function isOmpRootJournal(terminal: AgentTerminalContext, journal: AgentFileHandle): Promise<boolean> {
  return (await extractOmpSessionHeader(terminal, journal)) !== undefined;
}

async function readOmpTitle(terminal: AgentTerminalContext, journal: AgentFileHandle): Promise<string | undefined> {
  const bytes = await terminal.observation.files.read(journal, {
    maxBytes: OMP_TITLE_SLOT_BYTES,
    signal: terminal.signal,
  });
  const record = parseJsonRecord(new TextDecoder().decode(bytes));
  return record?.type === "title" ? boundedString(record.title, 200) : undefined;
}

function parseBreadcrumb(bytes: Uint8Array): OmpBreadcrumb | undefined {
  if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 || bytes.includes(0)) return undefined;
  const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const lines = (value.endsWith("\n") ? value.slice(0, -1) : value).split("\n");
  if (lines.length < 2 || lines.length > 3) return undefined;
  const [, sessionFile, marker] = lines;
  if (!sessionFile || sessionFile.length > 4 * 1024 || (marker !== undefined && marker !== "fresh")) return undefined;
  return { sessionFile, fresh: marker === "fresh" };
}

/**
 * Projects only safe canonical lifecycle facts. It intentionally omits tool
 * arguments/results, assistant content, paths, and OMP's unrepresentable
 * permission state. `childAgentId` is passed by a future public multi-journal
 * observer when a child journal has exact writer evidence.
 */
export function createOmpRecordMapper(options: { title?: string; childAgentId?: string } = {}) {
  let emittedRootStart = false;
  let title = options.title;
  return async (record: unknown, session: AgentRecordContext): Promise<void> => {
    const envelope = asRecord(record);
    if (!envelope) return;
    const agentId = session.journal?.role === "child" ? session.journal.childId : options.childAgentId;
    const target = agentId ? { agentId } : {};
    const message = asRecord(envelope.message);

    // The mutable fixed-width title slot is replayed before the logical header
    // on initial read and after atomic replacement. It is metadata, never
    // identity or a turn. A replacement updates an already-started root
    // without resetting its lifecycle state.
    if (envelope.type === "title" && !agentId) {
      const nextTitle = boundedString(envelope.title, 200);
      if (nextTitle && nextTitle !== title) {
        title = nextTitle;
        if (emittedRootStart) await session.publish.metadataChanged({ title });
      }
      return;
    }
    if (envelope.type === "session") {
      const sessionId = safeId(envelope.id);
      if (agentId) {
        await session.publish.subagentStarted({ subagentId: agentId, parentAgentId: session.binding.providerSessionId });
      } else if (!emittedRootStart) {
        emittedRootStart = true;
        await session.publish.sessionStarted({ title });
      }
      // The journal's id is already checked during binding. Do not promote a
      // later arbitrary record into a replacement session identity.
      void sessionId;
      return;
    }
    if (envelope.type === "model_change") {
      const metadata = modelMetadata(envelope);
      if (metadata) await session.publish.metadataChanged({ ...target, model: metadata });
      return;
    }
    if (envelope.type === "message" && message) {
      if (message.role === "user" && message.synthetic !== true) {
        const turnId = safeId(envelope.id);
        const promptText = ompPromptText(message.content);
        if (turnId && promptText) await session.publish.turnStarted({ ...target, turnId, promptText });
      } else if (message.role === "toolResult") {
        const toolId = safeId(message.toolCallId);
        if (toolId) await session.publish.toolFinished({ ...target, toolId, outcome: message.isError === true ? "error" : "success" });
      } else if (message.role === "assistant") {
        for (const tool of ompAssistantToolCalls(message)) await session.publish.toolStarted({ ...target, toolId: tool.id, name: tool.name });
        const outcome = ompAssistantOutcome(message.stopReason);
        if (outcome) await session.publish.done({ ...target, outcome });
      }
      return;
    }
    if (envelope.type === "custom" && envelope.customType === "tool_execution_start") {
      const data = asRecord(envelope.data);
      const toolId = safeId(data?.toolCallId);
      const name = boundedString(data?.toolName, 200);
      if (toolId && name) await session.publish.toolStarted({ ...target, toolId, name });
      return;
    }
    if (envelope.type === "custom" && envelope.customType === "session_exit") {
      const data = asRecord(envelope.data);
      if (!data) return;
      if (agentId) await session.publish.subagentDone({ subagentId: agentId, outcome: ompExitOutcome(data) });
      else await session.publish.publish({ kind: "session.stopped", reason: hasPendingTools(data) ? "interrupted" : "session_exit" });
    }
  };
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}
function parseJsonRecord(value: string): JsonRecord | undefined {
  try { return asRecord(JSON.parse(value)); } catch { return undefined; }
}
function safeId(value: unknown): string | undefined { return boundedString(value, 512); }
function ompPromptText(content: unknown): string | undefined {
  if (typeof content === "string") return boundedString(content, 4_000);
  if (!Array.isArray(content)) return undefined;
  const value = content.map(asRecord)
    .filter((item): item is JsonRecord => item?.type === "text")
    .map((item) => boundedString(item.text, 4_000))
    .filter((item): item is string => item !== undefined)
    .join("").slice(0, 4_000);
  return value || undefined;
}
function modelMetadata(record: JsonRecord) {
  const id = boundedString(record.model, 200);
  return id ? { id, displayName: boundedString(record.model_display_name, 200), reasoningEffort: boundedString(record.effort ?? record.reasoning_effort, 100) } : undefined;
}
function ompAssistantToolCalls(message: JsonRecord): readonly { id: string; name: string }[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.map(asRecord).flatMap((item) => {
    const id = safeId(item?.id); const name = boundedString(item?.name, 200);
    return item?.type === "toolCall" && id && name ? [{ id, name }] : [];
  });
}
function ompAssistantOutcome(stopReason: unknown): "success" | "error" | "cancelled" | undefined {
  if (stopReason === "stop" || stopReason === "length") return "success";
  if (stopReason === "error") return "error";
  return stopReason === "aborted" ? "cancelled" : undefined;
}
function hasPendingTools(data: JsonRecord): boolean { return Array.isArray(data.pendingToolCalls) && data.pendingToolCalls.length > 0; }
function ompExitOutcome(data: JsonRecord): "success" | "error" | "cancelled" {
  if (hasPendingTools(data) || data.kind === "signal" || data.kind === "process_exit") return "cancelled";
  return data.kind === "fatal" ? "error" : "success";
}

/** Applies provider display bounds without treating a display string as identity. */
function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? safeAgentString(value.length <= maximum ? value : value.slice(0, maximum))
    : undefined;
}
