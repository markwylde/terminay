import { spawn } from "node:child_process";
import { open, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentProvider } from "./agentTypes.js";
import type { ActivitySessionIdentity } from "./service.js";

const MAX_INITIAL_BYTES = 8 * 1024 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_SESSION_META_BYTES = 64 * 1024;
const POLL_MS = 250;

export interface AgentJournalObservation {
  readonly identity: ActivitySessionIdentity;
  readonly provider: AgentProvider;
  readonly record: Readonly<Record<string, unknown>>;
  /** Root records establish a provider binding. Child records are reduced
   * against their already-bound root and can never replace it. */
  readonly journalRole?: "root" | "child";
  readonly childAgentId?: string;
  /** Stable identity proven by a provider-owned path when the transcript has no header. */
  readonly providerSessionId?: string;
  readonly providerVersion?: string;
  readonly providerDisplayName?: string;
  readonly providerModelId?: string;
}

export type AgentJournalListener = (observation: AgentJournalObservation) => void | Promise<void>;

export interface AgentJournalSource {
  start(listener: AgentJournalListener): Promise<void>;
  stop(): Promise<void>;
  registerTerminal(identity: ActivitySessionIdentity): void;
  terminalStarted(identity: ActivitySessionIdentity, shellPid: number): void;
  foregroundProcessChanged(identity: ActivitySessionIdentity, provider: AgentProvider | null, shellForeground: boolean): void;
  unregisterTerminal(identity: ActivitySessionIdentity): void;
  setEnabled(enabled: boolean): void;
}

interface WatchedTerminal {
  identity: ActivitySessionIdentity;
  shellPid?: number;
  provider: AgentProvider | null;
  discovery?: ReturnType<typeof setInterval>;
  discoveryAttempts?: number;
  discoveryBusy?: boolean;
  discoveryPersistent?: boolean;
  /** Resolved from the shell's PTY, using OMP's own terminal-id format. */
  ompTerminalId?: string | null;
  tail?: JournalTail;
  childTails?: Map<string, JournalTail>;
}

interface JournalTail {
  provider: AgentProvider; path: string; root: string; offset: number; partial: string;
  inode?: number; device?: number;
  timer: ReturnType<typeof setInterval>; busy: boolean; journalRole: "root" | "child"; childAgentId?: string; providerSessionId?: string; providerDisplayName?: string; providerModelId?: string; providerMetadataPath?: string; providerStorePath?: string;
}

export interface NodeAgentJournalSourceOptions {
  readonly claudeHome?: string;
  readonly codexHome?: string;
  readonly cursorHome?: string;
  /** OMP's config root (the directory which normally contains `agent/`). */
  readonly ompHome?: string;
  readonly discoveryAttemptLimit?: number;
  readonly platform?: NodeJS.Platform;
  readonly pollMs?: number;
  /** Test seam for the PTY-to-OMP terminal identifier resolver. */
  readonly resolveOmpTerminalId?: (shellPid: number, platform: NodeJS.Platform) => Promise<string | undefined>;
  /** Test seam for recognising an OMP Bun wrapper below the exact PTY. */
  readonly hasOmpProcess?: (shellPid: number, platform: NodeJS.Platform) => Promise<boolean>;
  /** Test seam for recognising Cursor's Node worker below the exact PTY. */
  readonly hasCursorProcess?: (shellPid: number, platform: NodeJS.Platform) => Promise<boolean>;
}

interface OmpJournalRoot {
  readonly sessions: string;
  readonly terminalSessions: string;
}

/**
 * Binds journals to the exact PTY. Codex and Claude use process evidence;
 * OMP publishes an exact terminal-to-session breadcrumb and is not assumed to
 * keep a writer FD open. CWD, filename time, and "newest file" heuristics are
 * intentionally never used as identity evidence.
 */
export class NodeAgentJournalSource implements AgentJournalSource {
  private readonly terminals = new Map<string, WatchedTerminal>();
  private readonly claudeRoot: string;
  private readonly codexRoot: string;
  private readonly cursorChatsRoot: string;
  private readonly cursorProjectsRoot: string;
  private readonly ompRoots: readonly OmpJournalRoot[];
  private readonly ompSessionsRoots: readonly string[];
  private readonly resolveOmpTerminalId: (shellPid: number, platform: NodeJS.Platform) => Promise<string | undefined>;
  private readonly hasOmpProcess: (shellPid: number, platform: NodeJS.Platform) => Promise<boolean>;
  private readonly hasCursorProcess: (shellPid: number, platform: NodeJS.Platform) => Promise<boolean>;
  private readonly platform: NodeJS.Platform;
  private readonly pollMs: number;
  private readonly discoveryAttemptLimit: number;
  private listener: AgentJournalListener | undefined;
  private enabled = true;

  constructor(options: NodeAgentJournalSourceOptions = {}) {
    this.claudeRoot = resolve(options.claudeHome ?? join(homedir(), ".claude"));
    this.codexRoot = resolve(options.codexHome ?? (process.env.CODEX_HOME?.trim() || join(homedir(), ".codex")));
    const cursorRoot = resolve(options.cursorHome ?? join(homedir(), ".cursor"));
    this.cursorChatsRoot = join(cursorRoot, "chats");
    this.cursorProjectsRoot = join(cursorRoot, "projects");
    this.platform = options.platform ?? process.platform;
    this.ompRoots = ompJournalRoots(options.ompHome, this.platform);
    this.ompSessionsRoots = this.ompRoots.map((root) => root.sessions);
    this.resolveOmpTerminalId = options.resolveOmpTerminalId ?? ompTerminalIdForShell;
    this.hasOmpProcess = options.hasOmpProcess ?? hasOmpProcessBelowPty;
    this.hasCursorProcess = options.hasCursorProcess ?? hasCursorProcessBelowPty;
    this.pollMs = Math.max(50, options.pollMs ?? POLL_MS);
    this.discoveryAttemptLimit = Math.max(1, Math.floor(options.discoveryAttemptLimit ?? 80));
  }

  async start(listener: AgentJournalListener): Promise<void> { this.listener = listener; }

  async stop(): Promise<void> {
    for (const terminal of this.terminals.values()) this.stopWatching(terminal);
    this.terminals.clear();
    this.listener = undefined;
  }

  registerTerminal(identity: ActivitySessionIdentity): void {
    if (!this.enabled) return;
    this.terminals.set(identity.sessionId, { identity: Object.freeze({ ...identity }), provider: null });
  }

  terminalStarted(identity: ActivitySessionIdentity, shellPid: number): void {
    const terminal = this.exactTerminal(identity);
    if (!terminal || !Number.isSafeInteger(shellPid) || shellPid <= 0) return;
    terminal.shellPid = shellPid;
    // A short initial scan also covers hosts which cannot report foreground
    // process transitions and live terminals re-registered after enable.
    this.startDiscovery(terminal);
  }

  foregroundProcessChanged(identity: ActivitySessionIdentity, provider: AgentProvider | null, shellForeground: boolean): void {
    const terminal = this.exactTerminal(identity);
    if (!terminal) return;
    terminal.provider = provider;
    if (provider !== null) this.startDiscovery(terminal, true);
    else if (shellForeground) this.stopWatching(terminal);
    else this.startDiscovery(terminal);
  }

  unregisterTerminal(identity: ActivitySessionIdentity): void {
    const terminal = this.exactTerminal(identity);
    if (!terminal) return;
    this.stopWatching(terminal);
    this.terminals.delete(identity.sessionId);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const terminal of this.terminals.values()) this.stopWatching(terminal);
      this.terminals.clear();
    }
  }

  private exactTerminal(identity: ActivitySessionIdentity): WatchedTerminal | undefined {
    const terminal = this.terminals.get(identity.sessionId);
    return terminal?.identity.serverId === identity.serverId && terminal.identity.projectId === identity.projectId ? terminal : undefined;
  }

  private startDiscovery(terminal: WatchedTerminal, persistent = false): void {
    if (persistent) terminal.discoveryPersistent = true;
    if (!this.enabled || terminal.shellPid === undefined || terminal.discovery !== undefined) return;
    terminal.discoveryAttempts = 0;
    const discover = async () => {
      if (terminal.shellPid === undefined || terminal.discoveryBusy) return;
      terminal.discoveryBusy = true;
      try {
        terminal.discoveryAttempts = (terminal.discoveryAttempts ?? 0) + 1;
        const ompForeground = terminal.provider === "omp"
          || terminal.provider === null && await this.hasOmpProcess(terminal.shellPid, this.platform).catch(() => false);
        const cursorForeground = terminal.provider === "cursor"
          || terminal.provider === null && await this.hasCursorProcess(terminal.shellPid, this.platform).catch(() => false);
        if (ompForeground || cursorForeground) terminal.discoveryPersistent = true;
        const journal = ompForeground
          ? await this.findOmpBreadcrumbJournal(terminal)
            ?? await findProcessBoundAgentJournal(terminal.shellPid, {
              ompSessionsRoots: this.ompSessionsRoots,
              platform: this.platform,
              provider: "omp",
            }).catch(() => undefined)
          : await findProcessBoundAgentJournal(terminal.shellPid, {
            claudeProjectsRoot: join(this.claudeRoot, "projects"),
            codexSessionsRoot: join(this.codexRoot, "sessions"),
            cursorChatsRoot: this.cursorChatsRoot,
            cursorProjectsRoot: this.cursorProjectsRoot,
            ompSessionsRoots: this.ompSessionsRoots,
            platform: this.platform,
            provider: terminal.provider,
          }).catch(() => undefined);
        if (!journal) {
          if (!terminal.discoveryPersistent && (terminal.discoveryAttempts ?? 0) >= this.discoveryAttemptLimit && terminal.discovery !== undefined) {
            clearInterval(terminal.discovery); terminal.discovery = undefined;
          }
          return;
        }
        if (terminal.tail?.path === journal.path && terminal.tail.provider === journal.provider) {
          if (journal.provider === "omp") await this.refreshOmpChildTails(terminal);
          return;
        }
        this.stopTail(terminal);
        if (!terminal.discoveryPersistent) {
          if (terminal.discovery !== undefined) clearInterval(terminal.discovery);
          terminal.discovery = undefined;
        }
        await this.startTail(terminal, journal.provider, journal.path, journal.root, "providerSessionId" in journal ? journal.providerSessionId : undefined, "providerDisplayName" in journal ? journal.providerDisplayName : undefined, "providerMetadataPath" in journal ? journal.providerMetadataPath : undefined, "providerModelId" in journal ? journal.providerModelId : undefined, "providerStorePath" in journal ? journal.providerStorePath : undefined).catch(() => undefined);
        if (journal.provider === "omp") await this.refreshOmpChildTails(terminal);
      } finally {
        terminal.discoveryBusy = false;
      }
    };
    terminal.discovery = setInterval(() => void discover(), this.pollMs);
    terminal.discovery.unref?.();
    void discover();
  }

  /**
   * OMP owns this breadcrumb and writes it for its --continue/concurrency
   * semantics. Its terminal id derives from the controlling TTY, so it binds
   * directly to the terminal session rather than to a process-lifetime race.
   */
  private async findOmpBreadcrumbJournal(terminal: WatchedTerminal): Promise<{ readonly provider: "omp"; readonly path: string; readonly root: string } | undefined> {
    if (terminal.shellPid === undefined) return undefined;
    if (terminal.ompTerminalId === undefined) {
      terminal.ompTerminalId = await this.resolveOmpTerminalId(terminal.shellPid, this.platform).catch(() => undefined) ?? null;
    }
    const terminalId = terminal.ompTerminalId;
    if (!terminalId || !isSafeOmpTerminalId(terminalId)) return undefined;
    for (const root of this.ompRoots) {
      const breadcrumb = await readOmpBreadcrumb(join(root.terminalSessions, terminalId), root.terminalSessions);
      if (!breadcrumb) continue;
      const path = await safeJournalPath(breadcrumb.sessionFile, root.sessions).catch(() => undefined);
      if (!path || !await isOmpRootJournal(path, root.sessions)) continue;
      return { provider: "omp", path, root: root.sessions };
    }
    return undefined;
  }

  private async startTail(terminal: WatchedTerminal, provider: AgentProvider, path: string, root: string, providerSessionId?: string, providerDisplayName?: string, providerMetadataPath?: string, providerModelId?: string, providerStorePath?: string): Promise<void> {
    const safePath = await safeJournalPath(path, root);
    if (!safePath || terminal.tail !== undefined) return;
    const metadata = await stat(safePath);
    if (!metadata.isFile()) return;
    const initialOffset = Math.max(0, metadata.size - MAX_INITIAL_BYTES);
    const identity = journalFileIdentity(metadata);
    const tail: JournalTail = { provider, path: safePath, root, offset: initialOffset, partial: "", ...identity, timer: undefined as never, busy: false, journalRole: "root", providerSessionId, providerDisplayName, providerMetadataPath, providerModelId, providerStorePath };
    terminal.tail = tail;
    if (initialOffset > 0) await this.emitFirstRecord(terminal, tail, safePath);
    await this.readAvailable(terminal, tail, initialOffset > 0);
    tail.timer = setInterval(() => void this.readAvailable(terminal, tail, false), this.pollMs);
    tail.timer.unref?.();
  }

  private async refreshOmpChildTails(terminal: WatchedTerminal): Promise<void> {
    const rootTail = terminal.tail;
    if (rootTail?.provider !== "omp" || terminal.shellPid === undefined) return;
    const parent = join(dirname(rootTail.path), basename(rootTail.path, ".jsonl"));
    const paths = await processWritableFiles(terminal.shellPid, this.platform).catch(() => []);
    const known = terminal.childTails ?? new Map<string, JournalTail>();
    terminal.childTails = known;
    for (const path of paths) {
      const safe = await safeJournalPath(path, rootTail.root).catch(() => undefined);
      if (!safe || known.has(safe) || !await isOmpChildJournal(safe, parent)) continue;
      await this.startChildTail(terminal, safe, rootTail.root, basename(safe, ".jsonl"));
    }
  }

  private async startChildTail(terminal: WatchedTerminal, path: string, root: string, childAgentId: string): Promise<void> {
    const safePath = await safeJournalPath(path, root);
    const children = terminal.childTails;
    if (!safePath || !children || children.has(safePath)) return;
    const metadata = await stat(safePath);
    if (!metadata.isFile()) return;
    const initialOffset = Math.max(0, metadata.size - MAX_INITIAL_BYTES);
    const identity = journalFileIdentity(metadata);
    const tail: JournalTail = { provider: "omp", path: safePath, root, offset: initialOffset, partial: "", ...identity, timer: undefined as never, busy: false, journalRole: "child", childAgentId };
    children.set(safePath, tail);
    if (initialOffset > 0) await this.emitFirstRecord(terminal, tail, safePath);
    await this.readAvailable(terminal, tail, initialOffset > 0);
    tail.timer = setInterval(() => void this.readAvailable(terminal, tail, false), this.pollMs);
    tail.timer.unref?.();
  }

  private async emitFirstRecord(terminal: WatchedTerminal, tail: JournalTail, path: string): Promise<void> {
    const handle = await open(path, "r");
    try {
      const bytes = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const first = tail.provider === "omp" ? bytes.subarray(256, bytesRead) : bytes.subarray(0, bytesRead);
      const newline = first.indexOf(10);
      if (newline >= 0) this.emitLine(terminal, tail.provider, first.subarray(0, newline).toString("utf8"), tail.journalRole, tail.childAgentId, tail.providerSessionId, tail.providerDisplayName);
    } finally { await handle.close(); }
  }

  private async readAvailable(terminal: WatchedTerminal, tail: JournalTail, discardFirstPartial: boolean): Promise<void> {
    if (tail.busy || (terminal.tail !== tail && terminal.childTails?.get(tail.path) !== tail)) return;
    tail.busy = true;
    try {
      await this.refreshCursorTitle(terminal, tail);
      const stillSafe = await safeJournalPath(tail.path, tail.root);
      if (stillSafe !== tail.path) { this.stopTailInstance(terminal, tail); return; }
      const metadata = await stat(tail.path);
      const identity = journalFileIdentity(metadata);
      if (metadata.size < tail.offset || identity.inode !== tail.inode || identity.device !== tail.device) {
        tail.offset = 0; tail.partial = ""; tail.inode = identity.inode; tail.device = identity.device;
      }
      if (metadata.size === tail.offset) return;
      const length = Math.min(metadata.size - tail.offset, MAX_INITIAL_BYTES);
      const handle = await open(tail.path, "r");
      try {
        const bytes = Buffer.alloc(length);
        const result = await handle.read(bytes, 0, length, tail.offset);
        tail.offset += result.bytesRead;
        let text = tail.partial + bytes.subarray(0, result.bytesRead).toString("utf8");
        tail.partial = "";
        if (discardFirstPartial && tail.offset - result.bytesRead > 0) {
          const newline = text.indexOf("\n");
          text = newline < 0 ? "" : text.slice(newline + 1);
        }
        const lines = text.split(/\n/u);
        tail.partial = lines.pop() ?? "";
        if (Buffer.byteLength(tail.partial, "utf8") > MAX_RECORD_BYTES) tail.partial = "";
        for (const line of lines) this.emitLine(terminal, tail.provider, line, tail.journalRole, tail.childAgentId, tail.providerSessionId, tail.providerDisplayName);
      } finally { await handle.close(); }
    } catch {
      // A disappearing or temporarily unreadable provider journal is not a
      // terminal failure. Foreground changes will establish a new binding.
    } finally { tail.busy = false; }
  }

  private async refreshCursorTitle(terminal: WatchedTerminal, tail: JournalTail): Promise<void> {
    if (tail.provider !== "cursor" || !tail.providerMetadataPath || !this.listener) return;
    const title = await readCursorTitle(tail.providerMetadataPath, this.cursorChatsRoot);
    const modelId = tail.providerStorePath ? await readCursorModelId(tail.providerStorePath, this.cursorChatsRoot) : undefined;
    if ((!title || title === tail.providerDisplayName) && (!modelId || modelId === tail.providerModelId)) return;
    if (title) tail.providerDisplayName = title;
    if (modelId) tail.providerModelId = modelId;
    void this.listener({
      identity: terminal.identity,
      provider: "cursor",
      record: { type: "terminay.session_metadata" },
      journalRole: tail.journalRole,
      ...(tail.providerSessionId ? { providerSessionId: tail.providerSessionId } : {}),
      ...(tail.providerDisplayName ? { providerDisplayName: tail.providerDisplayName } : {}),
      ...(tail.providerModelId ? { providerModelId: tail.providerModelId } : {}),
    });
  }

  private emitLine(terminal: WatchedTerminal, provider: AgentProvider, line: string, journalRole: "root" | "child" = "root", childAgentId?: string, providerSessionId?: string, providerDisplayName?: string): void {
    if (!line || Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES || !this.listener) return;
    try {
      const record = JSON.parse(line) as unknown;
      if (typeof record !== "object" || record === null || Array.isArray(record)) return;
      const tail = journalRole === "root" ? terminal.tail : terminal.childTails?.get(childAgentId ?? "");
      void this.listener({ identity: terminal.identity, provider, record: record as Readonly<Record<string, unknown>>, journalRole, ...(childAgentId ? { childAgentId } : {}), ...(providerSessionId ? { providerSessionId } : {}), ...(providerDisplayName ? { providerDisplayName } : {}), ...(tail?.providerModelId ? { providerModelId: tail.providerModelId } : {}) });
    } catch { /* Ignore incomplete or invalid provider records. */ }
  }

  private stopWatching(terminal: WatchedTerminal): void {
    if (terminal.discovery !== undefined) clearInterval(terminal.discovery);
    this.stopTail(terminal);
    terminal.discovery = undefined;
    terminal.discoveryAttempts = undefined;
    terminal.discoveryBusy = undefined;
    terminal.discoveryPersistent = undefined;
  }

  private stopTail(terminal: WatchedTerminal): void {
    if (terminal.tail !== undefined) clearInterval(terminal.tail.timer);
    for (const tail of terminal.childTails?.values() ?? []) clearInterval(tail.timer);
    terminal.tail = undefined;
    terminal.childTails = undefined;
  }

  private stopTailInstance(terminal: WatchedTerminal, tail: JournalTail): void {
    clearInterval(tail.timer);
    if (terminal.tail === tail) this.stopTail(terminal);
    else terminal.childTails?.delete(tail.path);
  }
}

function journalFileIdentity(metadata: object): { readonly inode?: number; readonly device?: number } {
  const value = metadata as { ino?: unknown; dev?: unknown };
  return {
    ...(typeof value.ino === "number" ? { inode: value.ino } : {}),
    ...(typeof value.dev === "number" ? { device: value.dev } : {}),
  };
}

async function safeJournalPath(path: string, sessionsRoot: string): Promise<string | undefined> {
  if (!isAbsolute(path) || !path.endsWith(".jsonl")) return undefined;
  const [candidate, root] = await Promise.all([realpath(path), realpath(sessionsRoot)]);
  const rel = relative(root, candidate);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? candidate : undefined;
}

export async function findProcessBoundCodexRollout(shellPid: number, sessionsRoot: string, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  return (await findProcessBoundAgentJournal(shellPid, { codexSessionsRoot: sessionsRoot, platform, provider: "codex" }))?.path;
}

/** Find only an omp root session whose open writer is below this PTY tree. */
export async function findProcessBoundOmpSession(shellPid: number, sessionsRoot: string, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  return (await findProcessBoundAgentJournal(shellPid, { ompSessionsRoots: [sessionsRoot], platform, provider: "omp" }))?.path;
}

export async function findProcessBoundCursorTranscript(
  shellPid: number,
  cursorHome: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  return (await findProcessBoundAgentJournal(shellPid, {
    cursorChatsRoot: join(cursorHome, "chats"), cursorProjectsRoot: join(cursorHome, "projects"), platform, provider: "cursor",
  }))?.path;
}

async function readCursorTitle(path: string, chatsRoot: string): Promise<string | undefined> {
  if (!isAbsolute(path) || basename(path) !== "meta.json") return undefined;
  const [safe, root] = await Promise.all([realpath(path), realpath(chatsRoot)]).catch(() => [] as string[]);
  if (!safe || !root) return undefined;
  const rel = relative(root, safe);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const bytes = await readFile(safe).catch(() => undefined);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_SESSION_META_BYTES) return undefined;
  try {
    const title = (JSON.parse(bytes.toString("utf8")) as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : undefined;
  } catch { return undefined; }
}

async function readCursorModelId(path: string, chatsRoot: string): Promise<string | undefined> {
  const safe = await safeCursorChatFile(path, chatsRoot, "store.db");
  if (!safe) return undefined;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(safe, { readOnly: true });
    const row = database.prepare("SELECT value FROM meta WHERE key = ? LIMIT 1").get("0") as { value?: unknown } | undefined;
    if (typeof row?.value !== "string" || row.value.length === 0 || row.value.length > MAX_SESSION_META_BYTES * 2) return undefined;
    const json = /^[0-9a-f]+$/iu.test(row.value) && row.value.length % 2 === 0 ? Buffer.from(row.value, "hex").toString("utf8") : row.value;
    const modelId = (JSON.parse(json) as { lastUsedModel?: unknown }).lastUsedModel;
    return typeof modelId === "string" && modelId.trim() ? modelId.trim().slice(0, 200) : undefined;
  } catch { return undefined; } finally { database?.close(); }
}

async function safeCursorChatFile(path: string, chatsRoot: string, expectedName: string): Promise<string | undefined> {
  if (!isAbsolute(path) || basename(path) !== expectedName) return undefined;
  const resolved = await Promise.all([realpath(path), realpath(chatsRoot)]).catch(() => undefined);
  if (!resolved) return undefined;
  const [candidate, root] = resolved;
  const rel = relative(root, candidate);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? candidate : undefined;
}

async function findCursorTranscriptFromWritableFiles(
  paths: readonly string[],
  chatsRoot: string,
  projectsRoot: string,
): Promise<{ readonly path: string; readonly root: string; readonly providerSessionId: string; readonly providerDisplayName?: string; readonly providerMetadataPath: string; readonly providerModelId?: string; readonly providerStorePath: string } | undefined> {
  const canonicalChats = await realpath(chatsRoot).catch(() => undefined);
  const canonicalProjects = await realpath(projectsRoot).catch(() => undefined);
  if (!canonicalChats || !canonicalProjects) return undefined;
  for (const candidate of paths) {
    if (basename(candidate) !== "store.db") continue;
    const store = await realpath(candidate).catch(() => undefined);
    if (!store) continue;
    const rel = relative(canonicalChats, store);
    const parts = rel.split(/[\\/]/u);
    if (rel.startsWith("..") || isAbsolute(rel) || parts.length !== 3 || parts[2] !== "store.db") continue;
    const sessionId = parts[1];
    if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(sessionId)) continue;
    const providerMetadataPath = join(dirname(store), "meta.json");
    const metaBytes = await readFile(providerMetadataPath).catch(() => undefined);
    if (!metaBytes || metaBytes.length === 0 || metaBytes.length > MAX_SESSION_META_BYTES) continue;
    let cwd: unknown; let title: unknown;
    try { const meta = JSON.parse(metaBytes.toString("utf8")) as { cwd?: unknown; title?: unknown }; cwd = meta.cwd; title = meta.title; } catch { continue; }
    if (typeof cwd !== "string" || !isAbsolute(cwd)) continue;
    const canonicalCwd = await realpath(cwd).catch(() => undefined);
    if (!canonicalCwd) continue;
    const projectKey = canonicalCwd.replace(/^\/+/, "").replaceAll("/", "-");
    if (!projectKey || projectKey.includes("..")) continue;
    const transcript = join(canonicalProjects, projectKey, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
    const safe = await safeJournalPath(transcript, canonicalProjects).catch(() => undefined);
    const providerModelId = await readCursorModelId(store, canonicalChats);
    if (safe) return { path: safe, root: canonicalProjects, providerSessionId: sessionId, providerMetadataPath, providerStorePath: store, ...(typeof title === "string" && title.trim() ? { providerDisplayName: title.trim() } : {}), ...(providerModelId ? { providerModelId } : {}) };
  }
  return undefined;
}

interface ProcessBoundAgentJournalOptions {
  readonly claudeProjectsRoot?: string;
  readonly codexSessionsRoot?: string;
  readonly cursorChatsRoot?: string;
  readonly cursorProjectsRoot?: string;
  readonly ompSessionsRoots?: readonly string[];
  readonly platform: NodeJS.Platform;
  readonly provider: AgentProvider | null;
}

async function findProcessBoundAgentJournal(shellPid: number, options: ProcessBoundAgentJournalOptions): Promise<{ readonly provider: AgentProvider; readonly path: string; readonly root: string; readonly providerSessionId?: string; readonly providerDisplayName?: string; readonly providerMetadataPath?: string; readonly providerModelId?: string; readonly providerStorePath?: string } | undefined> {
  const { platform } = options;
  if (platform !== "darwin" && platform !== "linux") return undefined;
  const descendants = platform === "linux" ? await linuxDescendants(shellPid) : await psDescendants(shellPid);
  if (descendants.length === 0) return undefined;
  if ((options.provider === null || options.provider === "claude-code") && options.claudeProjectsRoot) {
    const claude = await findClaudeJournalFromProcess(descendants, options.claudeProjectsRoot, platform);
    if (claude) return { provider: "claude-code", path: claude, root: options.claudeProjectsRoot };
  }
  const paths = platform === "linux" ? await linuxWritableFiles(descendants) : await lsofWritableFiles(descendants);
  if ((options.provider === null || options.provider === "cursor") && options.cursorChatsRoot && options.cursorProjectsRoot) {
    const cursor = await findCursorTranscriptFromWritableFiles(paths, options.cursorChatsRoot, options.cursorProjectsRoot);
    if (cursor) return { provider: "cursor", ...cursor };
  }
  const matches: Array<{ provider: AgentProvider; path: string; root: string; modified: number }> = [];
  for (const path of paths) {
    if ((options.provider === null || options.provider === "codex") && options.codexSessionsRoot) {
      const safe = await safeJournalPath(path, options.codexSessionsRoot).catch(() => undefined);
      if (safe && basename(safe).startsWith("rollout-") && await isCodexRootRollout(safe)) {
        const metadata = await stat(safe).catch(() => undefined);
        if (metadata?.isFile()) matches.push({ provider: "codex", path: safe, root: options.codexSessionsRoot, modified: metadata.mtimeMs });
      }
    }
    if ((options.provider === null || options.provider === "claude-code") && options.claudeProjectsRoot) {
      const safe = await safeJournalPath(path, options.claudeProjectsRoot).catch(() => undefined);
      if (safe && !relative(options.claudeProjectsRoot, safe).split(/[\\/]/u).includes("subagents") && await isClaudeRootJournal(safe)) {
        const metadata = await stat(safe).catch(() => undefined);
        if (metadata?.isFile()) matches.push({ provider: "claude-code", path: safe, root: options.claudeProjectsRoot, modified: metadata.mtimeMs });
      }
    }
    if ((options.provider === null || options.provider === "omp") && options.ompSessionsRoots) {
      for (const sessionsRoot of options.ompSessionsRoots) {
        const safe = await safeJournalPath(path, sessionsRoot).catch(() => undefined);
        if (safe && await isOmpRootJournal(safe, sessionsRoot)) {
          const metadata = await stat(safe).catch(() => undefined);
          if (metadata?.isFile()) matches.push({ provider: "omp", path: safe, root: sessionsRoot, modified: metadata.mtimeMs });
        }
      }
    }
  }
  return matches.sort((left, right) => right.modified - left.modified)[0];
}

interface AgentProcessDetails { readonly command: string; readonly cwd?: string; readonly startedAt?: number }

async function findClaudeJournalFromProcess(pids: readonly number[], projectsRoot: string, platform: NodeJS.Platform): Promise<string | undefined> {
  const details = await Promise.all(pids.map(async (pid) => ({ pid, details: await processDetails(pid, platform) })));
  const candidates = details.filter((entry): entry is { pid: number; details: AgentProcessDetails } => entry.details !== undefined)
    .filter(({ details }) => /(?:^|[\\/])claude(?:\s|$)/u.test(details.command));
  const matches = new Map<string, number>();
  for (const { details: process } of candidates) {
    const resumed = /(?:^|\s)(?:--resume|-r)\s+([0-9a-f-]{36})(?:\s|$)/u.exec(process.command)?.[1];
    const projectDir = process.cwd ? join(projectsRoot, process.cwd.replace(/[/.]/gu, "-")) : undefined;
    if (resumed && projectDir) {
      const path = await safeJournalPath(join(projectDir, `${resumed}.jsonl`), projectsRoot).catch(() => undefined);
      const metadata = path ? await stat(path).catch(() => undefined) : undefined;
      if (path && metadata?.isFile() && await isClaudeRootJournal(path)) matches.set(path, metadata.mtimeMs);
    }
    if (!projectDir || process.startedAt === undefined) continue;
    for (const entry of await readdir(projectDir).catch(() => [])) {
      if (!/^[0-9a-f-]{36}\.jsonl$/u.test(entry)) continue;
      const path = await safeJournalPath(join(projectDir, entry), projectsRoot).catch(() => undefined);
      const metadata = path ? await stat(path).catch(() => undefined) : undefined;
      const activityAt = metadata?.mtimeMs;
      if (path && activityAt !== undefined && activityAt >= process.startedAt - 2_000 && await isClaudeRootJournal(path)) matches.set(path, activityAt);
    }
  }
  const ordered = [...matches.entries()].sort((left, right) => right[1] - left[1]);
  return ordered[0] && ordered[0][1] !== ordered[1]?.[1] ? ordered[0][0] : undefined;
}

export async function findProcessBoundClaudeSession(shellPid: number, projectsRoot: string, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  if (platform !== "darwin" && platform !== "linux") return undefined;
  const descendants = platform === "linux" ? await linuxDescendants(shellPid) : await psDescendants(shellPid);
  return findClaudeJournalFromProcess(descendants, projectsRoot, platform);
}

async function processDetails(pid: number, platform: NodeJS.Platform): Promise<AgentProcessDetails | undefined> {
  if (platform === "linux") {
    const [command, cwd, startedText] = await Promise.all([
      readFile(join("/proc", String(pid), "cmdline"), "utf8").then((value) => value.replaceAll("\0", " ").trim()).catch(() => ""),
      realpath(join("/proc", String(pid), "cwd")).catch(() => undefined),
      execFileText("ps", ["-p", String(pid), "-o", "lstart="], 64 * 1024, true).then((value) => value.trim()),
    ]);
    const startedAt = Date.parse(startedText);
    return command ? { command, ...(cwd ? { cwd } : {}), ...(Number.isFinite(startedAt) ? { startedAt } : {}) } : undefined;
  }
  const output = await execFileText("ps", ["-p", String(pid), "-o", "lstart=,command="], 64 * 1024, true);
  const line = output.trim();
  if (!line) return undefined;
  const startedText = line.slice(0, 24); const command = line.slice(24).trim();
  const cwdOutput = await execFileText("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], 64 * 1024, true);
  const cwd = cwdOutput.split(/\r?\n/u).find((value) => value.startsWith("n"))?.slice(1);
  const startedAt = Date.parse(startedText);
  return command ? { command, ...(cwd ? { cwd } : {}), ...(Number.isFinite(startedAt) ? { startedAt } : {}) } : undefined;
}

async function isCodexRootRollout(path: string): Promise<boolean> {
  const handle = await open(path, "r").catch(() => undefined);
  if (handle === undefined) return false;
  try {
    const bytes = Buffer.alloc(MAX_SESSION_META_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const newline = bytes.subarray(0, bytesRead).indexOf(10);
    if (newline < 0) return false;
    const record = JSON.parse(bytes.subarray(0, newline).toString("utf8")) as unknown;
    if (typeof record !== "object" || record === null || Array.isArray(record)) return false;
    const envelope = record as Record<string, unknown>;
    const payload = envelope.payload;
    if (envelope.type !== "session_meta" || typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
    const metadata = payload as Record<string, unknown>;
    const sessionId = typeof metadata.id === "string" ? metadata.id : metadata.session_id;
    return typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= 512
      && metadata.originator === "codex-tui" && metadata.source === "cli";
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

async function isClaudeRootJournal(path: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}\.jsonl$/u.test(basename(path))) return false;
  const handle = await open(path, "r").catch(() => undefined);
  if (handle === undefined) return false;
  try {
    const bytes = Buffer.alloc(MAX_SESSION_META_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const expected = basename(path, ".jsonl");
    for (const line of bytes.subarray(0, bytesRead).toString("utf8").split("\n").slice(0, -1)) {
      const record = JSON.parse(line) as unknown;
      if (typeof record !== "object" || record === null || Array.isArray(record)) continue;
      const value = record as Record<string, unknown>;
      if (value.sessionId === expected && value.isSidechain !== true) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

/**
 * OMP reserves the first 256 bytes for a mutable title slot. It is expressly
 * not an identity record: only the following logical `session` header proves
 * this is an eligible root journal.
 */
async function isOmpRootJournal(path: string, sessionsRoot: string): Promise<boolean> {
  const root = await realpath(sessionsRoot).catch(() => undefined);
  if (!root) return false;
  const rel = relative(root, path).split(/[\\/]/u);
  if (rel.length !== 2 || rel.some((part) => !part || part === "." || part === "..") || !rel[1]?.endsWith(".jsonl")) return false;
  const handle = await open(path, "r").catch(() => undefined);
  if (handle === undefined) return false;
  try {
    const bytes = Buffer.alloc(MAX_SESSION_META_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead <= 256) return false;
    const logical = bytes.subarray(256, bytesRead);
    const newline = logical.indexOf(10);
    if (newline < 0) return false;
    const record = JSON.parse(logical.subarray(0, newline).toString("utf8")) as unknown;
    if (typeof record !== "object" || record === null || Array.isArray(record)) return false;
    const envelope = record as Record<string, unknown>;
    return envelope.type === "session" && typeof envelope.id === "string" && envelope.id.length > 0 && envelope.id.length <= 512;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

async function isOmpChildJournal(path: string, parent: string): Promise<boolean> {
  const [candidate, expectedParent] = await Promise.all([realpath(path), realpath(parent).catch(() => undefined)]);
  if (!expectedParent || !candidate.endsWith(".jsonl")) return false;
  const rel = relative(expectedParent, candidate).split(/[\\/]/u);
  return rel.length === 1 && Boolean(rel[0]) && rel[0] !== "." && rel[0] !== "..";
}

/** Resolve OMP's paired data and terminal-state roots without touching them. */
function ompJournalRoots(ompHome: string | undefined, platform: NodeJS.Platform): readonly OmpJournalRoot[] {
  const agentRoot = (path: string): OmpJournalRoot => ({ sessions: resolve(path, "sessions"), terminalSessions: resolve(path, "terminal-sessions") });
  if (ompHome) return [agentRoot(resolve(ompHome, "agent"))];
  const profile = process.env.OMP_PROFILE !== undefined ? process.env.OMP_PROFILE : process.env.PI_PROFILE;
  if (profile?.trim()) return [agentRoot(resolve(homedir(), ".omp", "profiles", profile.trim(), "agent"))];
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDir) return [agentRoot(resolve(agentDir))];
  const roots = [agentRoot(resolve(homedir(), ".omp", "agent"))];
  if (platform === "linux") {
    const data = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
    const state = process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
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

interface OmpBreadcrumb { readonly sessionFile: string; readonly fresh: boolean; }

async function readOmpBreadcrumb(path: string, terminalSessionsRoot: string): Promise<OmpBreadcrumb | undefined> {
  const [candidate, root] = await Promise.all([realpath(path).catch(() => undefined), realpath(terminalSessionsRoot).catch(() => undefined)]);
  if (!candidate || !root || relative(root, candidate) !== basename(path)) return undefined;
  const metadata = await stat(candidate).catch(() => undefined);
  if (!metadata?.isFile()) return undefined;
  const bytes = await readFile(candidate).catch(() => undefined);
  if (!bytes || bytes.length === 0 || bytes.length > 8 * 1024 || bytes.includes(0)) return undefined;
  const value = bytes.toString("utf8");
  if (value.includes("\uFFFD")) return undefined;
  const lines = value.endsWith("\n") ? value.slice(0, -1).split("\n") : value.split("\n");
  if (lines.length < 2 || lines.length > 3) return undefined;
  const [cwd, sessionFile, marker] = lines;
  if (!cwd || !sessionFile || cwd.length > 4 * 1024 || sessionFile.length > 4 * 1024 || !isAbsolute(cwd) || !isAbsolute(sessionFile)) return undefined;
  if (marker !== undefined && marker !== "fresh") return undefined;
  return { sessionFile, fresh: marker === "fresh" };
}

function isSafeOmpTerminalId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,256}$/u.test(value);
}

/** Reproduces OMP's getTerminalId() primary TTY path without env fallbacks. */
async function ompTerminalIdForShell(shellPid: number, platform: NodeJS.Platform): Promise<string | undefined> {
  let tty: string | undefined;
  if (platform === "linux") tty = await readlink(join("/proc", String(shellPid), "fd", "0")).catch(() => undefined);
  else if (platform === "darwin") {
    const output = await execFileText("lsof", ["-a", "-p", String(shellPid), "-d", "0", "-Fn"], 64 * 1024, true);
    tty = output.split(/\r?\n/u).find((line) => line.startsWith("n"))?.slice(1);
  }
  if (!tty?.startsWith("/dev/")) return undefined;
  const terminalId = tty.slice("/dev/".length).replaceAll("/", "-");
  return isSafeOmpTerminalId(terminalId) ? terminalId : undefined;
}

async function psDescendants(shellPid: number): Promise<number[]> {
  const stdout = await execFileText("ps", ["-axo", "pid=,ppid="], 4 * 1024 * 1024);
  const children = new Map<number, number[]>();
  for (const line of stdout.split(/\r?\n/u)) {
    const [pidText, parentText] = line.trim().split(/\s+/u);
    const pid = Number(pidText); const parent = Number(parentText);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  return descendantsOf(shellPid, children);
}

async function processWritableFiles(shellPid: number, platform: NodeJS.Platform): Promise<string[]> {
  if (platform !== "darwin" && platform !== "linux") return [];
  const descendants = platform === "linux" ? await linuxDescendants(shellPid) : await psDescendants(shellPid);
  return platform === "linux" ? linuxWritableFiles(descendants) : lsofWritableFiles(descendants);
}

/**
 * macOS may report OMP's shebang launcher merely as `bun`. Require the full
 * descendant command shape before treating that generic runtime as OMP.
 */
async function hasOmpProcessBelowPty(shellPid: number, platform: NodeJS.Platform): Promise<boolean> {
  if (platform !== "darwin" && platform !== "linux") return false;
  const descendants = platform === "linux" ? await linuxDescendants(shellPid) : await psDescendants(shellPid);
  if (descendants.length === 0) return false;
  const command = await execFileText("ps", ["-p", descendants.join(","), "-o", "command="], 512 * 1024, true);
  return command.split(/\r?\n/u).some((line) =>
    /(?:^|\s)(?:omp|oh-my-pi)(?:\s|$)/u.test(line)
    || /(?:^|\s)bun\s+\S*(?:^|\/)omp(?:\s|$)/u.test(line),
  );
}

/** Cursor's launcher may report its bundled Node executable as foreground. */
async function hasCursorProcessBelowPty(shellPid: number, platform: NodeJS.Platform): Promise<boolean> {
  if (platform !== "darwin" && platform !== "linux") return false;
  const descendants = platform === "linux" ? await linuxDescendants(shellPid) : await psDescendants(shellPid);
  if (descendants.length === 0) return false;
  const command = await execFileText("ps", ["-p", descendants.join(","), "-o", "command="], 512 * 1024, true);
  return command.split(/\r?\n/u).some((line) =>
    /(?:^|\s)(?:agent|cursor-agent)(?:\s|$)/u.test(line)
    || /cursor-agent\/versions\/[^/\s]+\/(?:node\s+)?[^\s]*index\.js(?:\s|$)/u.test(line),
  );
}

async function linuxDescendants(shellPid: number): Promise<number[]> {
  const children = new Map<number, number[]>();
  // Process directories can disappear at any point. Reading names avoids the
  // implicit lstat that `withFileTypes` may perform on procfs entries, while
  // the guarded stat read below handles the normal exit race per process.
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    const pid = Number(entry);
    const value = await readFile(join("/proc", entry, "stat"), "utf8").catch(() => "");
    const closing = value.lastIndexOf(")");
    const parent = Number(value.slice(closing + 2).split(/\s+/u)[1]);
    if (Number.isSafeInteger(parent)) children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  return descendantsOf(shellPid, children);
}

function descendantsOf(rootPid: number, children: ReadonlyMap<number, readonly number[]>): number[] {
  const result: number[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.shift();
    if (pid === undefined || result.includes(pid)) continue;
    result.push(pid); pending.push(...(children.get(pid) ?? []));
  }
  return result;
}

async function lsofWritableFiles(pids: readonly number[]): Promise<string[]> {
  if (pids.length === 0) return [];
  const stdout = await execFileText("lsof", ["-p", pids.join(","), "-F", "pan"], 8 * 1024 * 1024, true);
  const result: string[] = [];
  let writable = false;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.startsWith("p")) writable = false;
    else if (line.startsWith("a")) writable = line.slice(1).includes("w") || line.slice(1).includes("u");
    else if (writable && line.startsWith("n")) result.push(line.slice(1));
  }
  return result;
}

function execFileText(command: string, args: readonly string[], maxBuffer: number, allowNoMatches = false): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout, "utf8") < maxBuffer) stdout += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (exitCode) => exitCode === 0 || (allowNoMatches && exitCode === 1) ? resolvePromise(stdout) : reject(new Error(`${command} exited with ${exitCode ?? "signal"}`)));
  });
}

async function linuxWritableFiles(pids: readonly number[]): Promise<string[]> {
  const result: string[] = [];
  for (const pid of pids) {
    const fdRoot = join("/proc", String(pid), "fd");
    for (const entry of await readdir(fdRoot).catch(() => [])) {
      const flagsText = await readFile(join("/proc", String(pid), "fdinfo", entry), "utf8").catch(() => "");
      const flags = Number.parseInt(/^flags:\s+(\d+)/mu.exec(flagsText)?.[1] ?? "0", 8);
      if ((flags & 3) === 0) continue;
      const path = await readlink(join(fdRoot, entry)).catch(() => "");
      if (path) result.push(path.replace(/ \(deleted\)$/u, ""));
    }
  }
  return result;
}
