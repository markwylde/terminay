import { spawn } from "node:child_process";
import { open, readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
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
  tail?: JournalTail;
}

interface JournalTail { provider: AgentProvider; path: string; offset: number; partial: string; timer: ReturnType<typeof setInterval>; busy: boolean }

export interface NodeAgentJournalSourceOptions {
  readonly claudeHome?: string;
  readonly codexHome?: string;
  readonly discoveryAttemptLimit?: number;
  readonly platform?: NodeJS.Platform;
  readonly pollMs?: number;
}

/**
 * Finds rollout files only when their open writer is a descendant of the
 * exact PTY shell PID. CWD, filename time, and "newest file" heuristics are
 * intentionally never used as identity evidence.
 */
export class NodeAgentJournalSource implements AgentJournalSource {
  private readonly terminals = new Map<string, WatchedTerminal>();
  private readonly claudeRoot: string;
  private readonly codexRoot: string;
  private readonly platform: NodeJS.Platform;
  private readonly pollMs: number;
  private readonly discoveryAttemptLimit: number;
  private listener: AgentJournalListener | undefined;
  private enabled = true;

  constructor(options: NodeAgentJournalSourceOptions = {}) {
    this.claudeRoot = resolve(options.claudeHome ?? join(homedir(), ".claude"));
    this.codexRoot = resolve(options.codexHome ?? (process.env.CODEX_HOME?.trim() || join(homedir(), ".codex")));
    this.platform = options.platform ?? process.platform;
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
        const journal = await findProcessBoundAgentJournal(terminal.shellPid, {
          claudeProjectsRoot: join(this.claudeRoot, "projects"),
          codexSessionsRoot: join(this.codexRoot, "sessions"),
          platform: this.platform,
          provider: terminal.provider,
        }).catch(() => undefined);
        if (!journal) {
          if (!terminal.discoveryPersistent && (terminal.discoveryAttempts ?? 0) >= this.discoveryAttemptLimit && terminal.discovery !== undefined) {
            clearInterval(terminal.discovery); terminal.discovery = undefined;
          }
          return;
        }
        if (terminal.tail?.path === journal.path && terminal.tail.provider === journal.provider) return;
        this.stopTail(terminal);
        if (!terminal.discoveryPersistent) {
          if (terminal.discovery !== undefined) clearInterval(terminal.discovery);
          terminal.discovery = undefined;
        }
        await this.startTail(terminal, journal.provider, journal.path).catch(() => undefined);
      } finally {
        terminal.discoveryBusy = false;
      }
    };
    terminal.discovery = setInterval(() => void discover(), this.pollMs);
    terminal.discovery.unref?.();
    void discover();
  }

  private async startTail(terminal: WatchedTerminal, provider: AgentProvider, path: string): Promise<void> {
    const root = provider === "codex" ? join(this.codexRoot, "sessions") : join(this.claudeRoot, "projects");
    const safePath = await safeJournalPath(path, root);
    if (!safePath || terminal.tail !== undefined) return;
    const metadata = await stat(safePath);
    if (!metadata.isFile()) return;
    const initialOffset = Math.max(0, metadata.size - MAX_INITIAL_BYTES);
    const tail: JournalTail = { provider, path: safePath, offset: initialOffset, partial: "", timer: undefined as never, busy: false };
    terminal.tail = tail;
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
      const newline = bytes.subarray(0, bytesRead).indexOf(10);
      if (newline >= 0) this.emitLine(terminal, tail.provider, bytes.subarray(0, newline).toString("utf8"));
    } finally { await handle.close(); }
  }

  private async readAvailable(terminal: WatchedTerminal, tail: JournalTail, discardFirstPartial: boolean): Promise<void> {
    if (tail.busy || terminal.tail !== tail) return;
    tail.busy = true;
    try {
      const root = tail.provider === "codex" ? join(this.codexRoot, "sessions") : join(this.claudeRoot, "projects");
      const stillSafe = await safeJournalPath(tail.path, root);
      if (stillSafe !== tail.path) { this.stopTail(terminal); return; }
      const metadata = await stat(tail.path);
      if (metadata.size < tail.offset) { tail.offset = 0; tail.partial = ""; }
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
        for (const line of lines) this.emitLine(terminal, tail.provider, line);
      } finally { await handle.close(); }
    } catch {
      // A disappearing or temporarily unreadable provider journal is not a
      // terminal failure. Foreground changes will establish a new binding.
    } finally { tail.busy = false; }
  }

  private emitLine(terminal: WatchedTerminal, provider: AgentProvider, line: string): void {
    if (!line || Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES || !this.listener) return;
    try {
      const record = JSON.parse(line) as unknown;
      if (typeof record !== "object" || record === null || Array.isArray(record)) return;
      void this.listener({ identity: terminal.identity, provider, record: record as Readonly<Record<string, unknown>> });
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
    terminal.tail = undefined;
  }
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

interface ProcessBoundAgentJournalOptions {
  readonly claudeProjectsRoot?: string;
  readonly codexSessionsRoot?: string;
  readonly platform: NodeJS.Platform;
  readonly provider: AgentProvider | null;
}

async function findProcessBoundAgentJournal(shellPid: number, options: ProcessBoundAgentJournalOptions): Promise<{ readonly provider: AgentProvider; readonly path: string } | undefined> {
  const { platform } = options;
  if (platform !== "darwin" && platform !== "linux") return undefined;
  const descendants = platform === "linux" ? await linuxDescendants(shellPid) : await psDescendants(shellPid);
  if (descendants.length === 0) return undefined;
  if ((options.provider === null || options.provider === "claude-code") && options.claudeProjectsRoot) {
    const claude = await findClaudeJournalFromProcess(descendants, options.claudeProjectsRoot, platform);
    if (claude) return { provider: "claude-code", path: claude };
  }
  const paths = platform === "linux" ? await linuxWritableFiles(descendants) : await lsofWritableFiles(descendants);
  const matches: Array<{ provider: AgentProvider; path: string; modified: number }> = [];
  for (const path of paths) {
    if ((options.provider === null || options.provider === "codex") && options.codexSessionsRoot) {
      const safe = await safeJournalPath(path, options.codexSessionsRoot).catch(() => undefined);
      if (safe && basename(safe).startsWith("rollout-") && await isCodexRootRollout(safe)) {
        const metadata = await stat(safe).catch(() => undefined);
        if (metadata?.isFile()) matches.push({ provider: "codex", path: safe, modified: metadata.mtimeMs });
      }
    }
    if ((options.provider === null || options.provider === "claude-code") && options.claudeProjectsRoot) {
      const safe = await safeJournalPath(path, options.claudeProjectsRoot).catch(() => undefined);
      if (safe && !relative(options.claudeProjectsRoot, safe).split(/[\\/]/u).includes("subagents") && await isClaudeRootJournal(safe)) {
        const metadata = await stat(safe).catch(() => undefined);
        if (metadata?.isFile()) matches.push({ provider: "claude-code", path: safe, modified: metadata.mtimeMs });
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
  const matches = new Set<string>();
  for (const { details: process } of candidates) {
    const resumed = /(?:^|\s)(?:--resume|-r)\s+([0-9a-f-]{36})(?:\s|$)/u.exec(process.command)?.[1];
    const projectDir = process.cwd ? join(projectsRoot, process.cwd.replace(/[/.]/gu, "-")) : undefined;
    if (resumed && projectDir) {
      const path = await safeJournalPath(join(projectDir, `${resumed}.jsonl`), projectsRoot).catch(() => undefined);
      if (path && await isClaudeRootJournal(path)) matches.add(path);
      continue;
    }
    if (!projectDir || process.startedAt === undefined) continue;
    for (const entry of await readdir(projectDir).catch(() => [])) {
      if (!/^[0-9a-f-]{36}\.jsonl$/u.test(entry)) continue;
      const path = await safeJournalPath(join(projectDir, entry), projectsRoot).catch(() => undefined);
      const metadata = path ? await stat(path).catch(() => undefined) : undefined;
      const createdAt = metadata?.mtimeMs;
      if (path && createdAt !== undefined && createdAt >= process.startedAt - 2_000 && await isClaudeRootJournal(path)) matches.add(path);
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

export async function findProcessBoundClaudeSession(shellPid: number, projectsRoot: string, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  if (platform !== "darwin" && platform !== "linux") return undefined;
  const descendants = platform === "linux" ? await linuxDescendants(shellPid) : await psDescendants(shellPid);
  return findClaudeJournalFromProcess(descendants, projectsRoot, platform);
}

async function processDetails(pid: number, platform: NodeJS.Platform): Promise<AgentProcessDetails | undefined> {
  if (platform === "linux") {
    const [command, cwd] = await Promise.all([
      readFile(join("/proc", String(pid), "cmdline"), "utf8").then((value) => value.replaceAll("\0", " ").trim()).catch(() => ""),
      realpath(join("/proc", String(pid), "cwd")).catch(() => undefined),
    ]);
    return command ? { command, ...(cwd ? { cwd } : {}) } : undefined;
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
