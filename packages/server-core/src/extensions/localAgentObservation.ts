import { spawn } from "node:child_process";
import { open, readFile, readlink, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { JsonValue } from "@terminay/extension-api";
import type { ExtensionAgentObservationOperation, ExtensionAgentTerminalContext } from "./types.js";

const MAX_PATH_LENGTH = 4_096;
const MAX_PROCESSES = 2_048;
const MAX_OPEN_FILES = 8_192;
const MAX_WATCHERS_PER_TERMINAL = 32;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_FOLLOW_CHUNK_BYTES = 256 * 1024;

/** A server-owned lookup for one admitted terminal.  This is intentionally
 * separate from the public terminal context: extensions never receive the
 * shell PID, local path, or a way to resolve another terminal. */
export interface ThisServerAgentTerminal {
  readonly environment: "this-server" | "remote";
  readonly shellPid?: number;
  readonly foreground?: Readonly<{ executableName: string; arguments?: readonly string[]; startedAt?: string }>;
  readonly ttyPath?: string;
}

export type ThisServerAgentTerminalResolver = (
  terminal: ExtensionAgentTerminalContext,
  signal: AbortSignal,
) => Promise<ThisServerAgentTerminal | undefined> | ThisServerAgentTerminal | undefined;

export interface ThisServerAgentObservationSystem {
  descendants(shellPid: number, signal: AbortSignal): Promise<readonly ThisServerAgentProcess[]>;
  openFiles(processIds: readonly number[], access: "writable" | "readable", signal: AbortSignal): Promise<readonly ThisServerAgentOpenFile[]>;
  tty(shellPid: number, signal: AbortSignal): Promise<string | undefined>;
  foreground(shellPid: number, signal: AbortSignal): Promise<Readonly<{ executableName: string; arguments?: readonly string[]; startedAt?: string }> | undefined>;
  environment(shellPid: number, names: readonly string[], signal: AbortSignal): Promise<Readonly<Record<string, string>>>;
  realpath(path: string, signal: AbortSignal): Promise<string | undefined>;
  stat(path: string, signal: AbortSignal): Promise<ThisServerAgentFileStat | undefined>;
  read(path: string, position: number, maximum: number, signal: AbortSignal): Promise<Uint8Array | undefined>;
}

export interface ThisServerAgentProcess {
  readonly pid: number;
  readonly executableName: string;
  readonly startedAt?: string;
  readonly cwd?: string;
}

export interface ThisServerAgentOpenFile {
  readonly path: string;
  readonly access: "readable" | "writable" | "read-write";
}

export interface ThisServerAgentFileStat {
  readonly kind: "file" | "directory" | "other";
  readonly size: number;
  readonly modifiedAt?: string;
}

export interface ThisServerAgentObservationAdapterOptions {
  readonly resolveTerminal: ThisServerAgentTerminalResolver;
  readonly system?: ThisServerAgentObservationSystem;
  /** Supplying this makes homeRelative checks deterministic in tests and on
   * service accounts whose HOME is intentionally unset. */
  readonly homeDirectory?: string;
  readonly maximumReadBytes?: number;
  readonly maximumFollowChunkBytes?: number;
}

interface ProcessHandle { readonly id: string; readonly pid: number; }
interface FileHandle { readonly id: string; path: string; }
interface Watcher { readonly id: string; readonly file: FileHandle; readonly maximumChunkBytes: number; path: string; offset: number; }
interface TerminalState { readonly processes: Map<string, ProcessHandle>; readonly files: Map<string, FileHandle>; readonly watchers: Map<string, Watcher>; nextId: number; }

/**
 * Adapter for exactly the local Terminay Server environment.  It is a narrow
 * broker primitive, not an extension sandbox.  In particular, a remote
 * terminal is rejected before any local PID, TTY, or path is touched.
 */
export class ThisServerAgentObservationAdapter {
  private readonly states = new Map<string, TerminalState>();
  private readonly system: ThisServerAgentObservationSystem;
  private readonly homeDirectory: string | undefined;
  private readonly maximumReadBytes: number;
  private readonly maximumFollowChunkBytes: number;

  constructor(private readonly options: ThisServerAgentObservationAdapterOptions) {
    this.system = options.system ?? nodeSystem;
    this.homeDirectory = options.homeDirectory === undefined ? process.env.HOME : safePath(options.homeDirectory);
    this.maximumReadBytes = positiveBound(options.maximumReadBytes, MAX_READ_BYTES);
    this.maximumFollowChunkBytes = positiveBound(options.maximumFollowChunkBytes, MAX_FOLLOW_CHUNK_BYTES);
  }

  async observe(terminal: ExtensionAgentTerminalContext, operation: ExtensionAgentObservationOperation, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const local = await this.requireLocalTerminal(terminal, signal);
    const state = this.stateFor(terminal.contextId);
    switch (operation) {
      case "process.foreground": return this.foreground(local, signal);
      case "process.descendants": return this.descendants(local, state, signal);
      case "process.open-files": return this.openFiles(state, payload, signal);
      case "process.environment": return this.environment(local, payload, signal);
      case "terminal.tty": return this.tty(local, signal);
      case "filesystem.resolve-home-relative": return this.resolveHomeRelative(state, payload, signal);
      case "filesystem.resolve-path-under-home": return this.resolvePathUnderHome(state, payload, signal);
      case "filesystem.home-relative-path": return this.homeRelativePath(state, payload, signal);
      case "filesystem.resolve-relative-to-environment": return this.resolveRelativeToEnvironment(local, state, payload, signal);
      case "filesystem.resolve-path-under-environment": return this.resolvePathUnderEnvironment(local, state, payload, signal);
      case "filesystem.environment-relative-path": return this.environmentRelativePath(local, state, payload, signal);
      case "filesystem.realpath": return this.canonicalFile(state, payload, signal);
      case "filesystem.stat": return this.fileStat(state, payload, signal);
      case "filesystem.read": return this.read(state, payload, signal);
      case "filesystem.follow": return this.follow(state, payload, signal);
      case "filesystem.unfollow": return this.unfollow(state, payload);
      default: throw new Error("agent observation operation is unavailable");
    }
  }

  /** A host-private topology fact for re-observation. It deliberately returns
   * only a stable signature: native process ids and open paths never cross
   * into the extension or public protocol. */
  async topologySignature(terminal: ExtensionAgentTerminalContext, signal: AbortSignal): Promise<string | undefined> {
    const local = await this.requireLocalTerminal(terminal, signal);
    const shellPid = requiredPid(local);
    const descendants = await this.system.descendants(shellPid, signal);
    if (descendants.length > MAX_PROCESSES || descendants.some((process) => !validPid(process.pid) || !safeText(process.executableName, 512))) return undefined;
    const processes = descendants.map((process) => process.pid).sort((left, right) => left - right);
    const files = await this.system.openFiles(processes, "writable", signal);
    if (files.length > MAX_OPEN_FILES) return undefined;
    const processFacts = descendants.map((process) => `${process.pid}:${process.executableName}`).sort();
    const fileFacts = files.map((file) => `${file.access}:${safePath(file.path) ?? ""}`).filter((value) => !value.endsWith(":")).sort();
    return JSON.stringify([processFacts, fileFacts]);
  }

  /** Terminal teardown must call this after cancelling its extension child.
   * It makes all opaque handles and watchers unusable immediately. */
  disposeTerminal(contextId: string): void { this.states.delete(contextId); }

  private async requireLocalTerminal(terminal: ExtensionAgentTerminalContext, signal: AbortSignal): Promise<ThisServerAgentTerminal> {
    throwIfAborted(signal);
    const resolved = await this.options.resolveTerminal(terminal, signal);
    throwIfAborted(signal);
    if (resolved === undefined) throw new Error("agent observation terminal is unavailable");
    if (resolved.environment !== "this-server") throw new Error("agent observation is unavailable for remote environment");
    return resolved;
  }

  private stateFor(contextId: string): TerminalState {
    let state = this.states.get(contextId);
    if (state === undefined) {
      state = { processes: new Map(), files: new Map(), watchers: new Map(), nextId: 0 };
      this.states.set(contextId, state);
    }
    return state;
  }

  private async foreground(terminal: ThisServerAgentTerminal, signal: AbortSignal): Promise<JsonValue> {
    if (terminal.foreground !== undefined) return foregroundValue(terminal.foreground);
    const shellPid = requiredPid(terminal);
    const foreground = await this.system.foreground(shellPid, signal);
    return foreground === undefined ? null : foregroundValue(foreground);
  }

  private async descendants(terminal: ThisServerAgentTerminal, state: TerminalState, signal: AbortSignal): Promise<JsonValue> {
    const processes = await this.system.descendants(requiredPid(terminal), signal);
    if (processes.length > MAX_PROCESSES) throw new Error("agent process observation exceeds its limit");
    return processes.map((process) => {
      if (!validPid(process.pid) || !safeText(process.executableName, 512)) throw new Error("agent process observation is malformed");
      const handle = this.registerProcess(state, process.pid);
      const startedAt = safeText(process.startedAt, 128) ? process.startedAt : undefined;
      const cwd = safePath(process.cwd);
      return {
        handle: { id: handle.id }, executableName: process.executableName,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(cwd === undefined ? {} : { cwd }),
      };
    });
  }

  private async openFiles(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const supplied = Array.isArray(request?.processes) ? request.processes : undefined;
    const options = record(request?.options); const access = options?.access;
    if (supplied === undefined || supplied.length === 0 || supplied.length > MAX_PROCESSES || (access !== "writable" && access !== "readable")) throw new Error("agent open-file request is invalid");
    const pids = supplied.map((value) => this.processFor(state, value).pid);
    const files = await this.system.openFiles([...new Set(pids)], access, signal);
    if (files.length > MAX_OPEN_FILES) throw new Error("agent open-file observation exceeds its limit");
    return files.flatMap((file) => {
      const path = safePath(file.path);
      if (path === undefined || !isOpenAccess(file.access)) return [];
      const handle = this.registerFile(state, path);
      return [{ handle: { id: handle.id }, path, access: file.access }];
    });
  }

  private async environment(terminal: ThisServerAgentTerminal, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const names = record(payload)?.names;
    if (!Array.isArray(names) || names.length === 0 || names.length > 16 || names.some((name) => !environmentName(name))) throw new Error("agent environment request is invalid");
    const safeNames = names as string[];
    const values = await this.system.environment(requiredPid(terminal), safeNames, signal);
    const entries: Array<[string, string]> = [];
    for (const name of safeNames) { const value = values[name]; if (safeText(value, 4_096)) entries.push([name, value]); }
    return Object.fromEntries(entries);
  }

  private async tty(terminal: ThisServerAgentTerminal, signal: AbortSignal): Promise<JsonValue> {
    const path = terminal.ttyPath ?? await this.system.tty(requiredPid(terminal), signal);
    if (path === undefined) return null;
    if (!safePath(path)?.startsWith("/dev/")) throw new Error("agent terminal TTY observation is malformed");
    return { path, terminalId: path.slice("/dev/".length).replaceAll("/", "-") };
  }

  private async canonicalFile(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const file = this.fileFor(state, request?.handle);
    const canonical = await this.system.realpath(file.path, signal);
    if (canonical === undefined || safePath(canonical) === undefined) return null;
    const options = record(request?.options);
    if (!this.matchesFileConstraint(canonical, options)) return null;
    file.path = canonical;
    return { id: file.id };
  }

  private async resolveHomeRelative(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const relativePath = request?.relativePath;
    if (typeof relativePath !== "string" || !safeRelativePath(relativePath) || this.homeDirectory === undefined) return null;
    const candidate = resolve(this.homeDirectory, relativePath);
    const canonical = await this.system.realpath(candidate, signal);
    if (canonical === undefined || safePath(canonical) === undefined || !this.withinHomeConstraint(canonical, request, true)) return null;
    const details = await this.system.stat(canonical, signal);
    if (details?.kind !== "file") return null;
    return { id: this.registerFile(state, canonical).id };
  }

  private async resolvePathUnderHome(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const providerPath = request?.providerPath;
    if (typeof providerPath !== "string" || safePath(providerPath) === undefined || record(request?.beneath)?.homeRelative === undefined) return null;
    const canonical = await this.system.realpath(providerPath, signal);
    if (canonical === undefined || safePath(canonical) === undefined || !this.withinHomeConstraint(canonical, request, false)) return null;
    const details = await this.system.stat(canonical, signal);
    if (details?.kind !== "file") return null;
    return { id: this.registerFile(state, canonical).id };
  }

  private async homeRelativePath(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const file = this.fileFor(state, request?.handle);
    const canonical = await this.system.realpath(file.path, signal);
    if (canonical === undefined || safePath(canonical) === undefined || !this.withinHomeConstraint(canonical, request, false)) return null;
    const details = await this.system.stat(canonical, signal);
    const beneath = record(request?.beneath); const homeRelative = beneath?.homeRelative;
    if (details?.kind !== "file" || typeof homeRelative !== "string" || this.homeDirectory === undefined || !safeRelativePath(homeRelative)) return null;
    const result = relative(resolve(this.homeDirectory, homeRelative), canonical);
    if (!safeRelativePath(result)) return null;
    return result;
  }

  private async resolveRelativeToEnvironment(terminal: ThisServerAgentTerminal, state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const relativePath = request?.relativePath;
    if (typeof relativePath !== "string" || !safeRelativePath(relativePath)) return null;
    const root = await this.environmentRoot(terminal, request?.environmentVariable, signal); if (root === undefined) return null;
    const canonical = await this.system.realpath(resolve(root, relativePath), signal);
    if (canonical === undefined || !contained(root, canonical) || !matchesExtension(canonical, request?.extension)) return null;
    if ((await this.system.stat(canonical, signal))?.kind !== "file") return null;
    return { id: this.registerFile(state, canonical).id };
  }

  private async resolvePathUnderEnvironment(terminal: ThisServerAgentTerminal, state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const providerPath = request?.providerPath;
    if (typeof providerPath !== "string" || safePath(providerPath) === undefined) return null;
    const root = await this.environmentRoot(terminal, request?.environmentVariable, signal); if (root === undefined) return null;
    const canonical = await this.system.realpath(providerPath, signal);
    if (canonical === undefined || !contained(resolve(root, typeof request?.beneathRelative === "string" && safeRelativePath(request.beneathRelative) ? request.beneathRelative : "."), canonical) || !matchesExtension(canonical, request?.extension)) return null;
    if ((await this.system.stat(canonical, signal))?.kind !== "file") return null;
    return { id: this.registerFile(state, canonical).id };
  }

  private async environmentRelativePath(terminal: ThisServerAgentTerminal, state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const file = this.fileFor(state, request?.handle); const root = await this.environmentRoot(terminal, request?.environmentVariable, signal);
    const canonical = root === undefined ? undefined : await this.system.realpath(file.path, signal);
    if (root === undefined || canonical === undefined || !contained(resolve(root, typeof request?.beneathRelative === "string" && safeRelativePath(request.beneathRelative) ? request.beneathRelative : "."), canonical)) return null;
    if ((await this.system.stat(canonical, signal))?.kind !== "file") return null;
    return relative(root, canonical);
  }

  private async environmentRoot(terminal: ThisServerAgentTerminal, name: JsonValue | undefined, signal: AbortSignal): Promise<string | undefined> {
    if (!environmentName(name)) return undefined;
    const value = (await this.system.environment(requiredPid(terminal), [name], signal))[name];
    const path = safePath(value); if (path === undefined) return undefined;
    const canonical = await this.system.realpath(path, signal);
    return canonical !== undefined && safePath(canonical) !== undefined && (await this.system.stat(canonical, signal))?.kind === "directory" ? canonical : undefined;
  }

  private withinHomeConstraint(path: string, request: Record<string, JsonValue> | undefined, defaultHome: boolean): boolean {
    const beneath = record(request?.beneath); const homeRelative = beneath?.homeRelative;
    if (homeRelative === undefined) return defaultHome && this.homeDirectory !== undefined && contained(resolve(this.homeDirectory), path);
    return this.matchesFileConstraint(path, request);
  }

  private matchesFileConstraint(path: string, options: Record<string, JsonValue> | undefined): boolean {
    const extension = options?.extension;
    if (extension !== undefined && (typeof extension !== "string" || extension.length === 0 || extension.length > 64 || !path.endsWith(extension))) return false;
    const beneath = record(options?.beneath); const homeRelative = beneath?.homeRelative;
    if (homeRelative === undefined) return true;
    if (typeof homeRelative !== "string" || this.homeDirectory === undefined || !safeRelativePath(homeRelative)) return false;
    const root = resolve(this.homeDirectory, homeRelative);
    const pathRelative = relative(root, path);
    return pathRelative !== "" && pathRelative !== ".." && !pathRelative.startsWith(`..${pathSeparator()}`) && !isAbsolute(pathRelative);
  }

  private async fileStat(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const file = this.fileFor(state, record(payload)?.handle);
    const value = await this.system.stat(file.path, signal);
    if (value === undefined || value.kind !== "file" || !Number.isSafeInteger(value.size) || value.size < 0) return null;
    const modifiedAt = safeText(value.modifiedAt, 128) ? value.modifiedAt : undefined;
    return { handle: { id: file.id }, kind: "file", size: value.size, ...(modifiedAt === undefined ? {} : { modifiedAt }) };
  }

  private async read(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const file = this.fileFor(state, request?.handle); const options = record(request?.options);
    const maximum = boundedBytes(options?.maxBytes, this.maximumReadBytes);
    const bytes = await this.system.read(file.path, 0, maximum, signal);
    return bytes === undefined ? [] : [...bytes];
  }

  private async follow(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload);
    if (typeof request?.watcherId === "string") return this.pollWatcher(state, request.watcherId, signal);
    const file = this.fileFor(state, request?.handle); const options = record(request?.options);
    if (state.watchers.size >= MAX_WATCHERS_PER_TERMINAL) throw new Error("agent file follow exceeds its limit");
    const maximumChunkBytes = boundedBytes(options?.maxChunkBytes, this.maximumFollowChunkBytes);
    const watcher: Watcher = { id: `watch-${++state.nextId}`, file, maximumChunkBytes, path: file.path, offset: 0 };
    state.watchers.set(watcher.id, watcher);
    return { watcherId: watcher.id };
  }

  private async pollWatcher(state: TerminalState, watcherId: string, signal: AbortSignal): Promise<JsonValue> {
    const watcher = state.watchers.get(watcherId);
    if (watcher === undefined) throw new Error("agent file watcher is unavailable");
    const canonical = await this.system.realpath(watcher.file.path, signal);
    if (canonical === undefined) return { events: [], closed: true };
    const details = await this.system.stat(canonical, signal);
    if (details === undefined || details.kind !== "file") return { events: [], closed: true };
    let type: "append" | "replace" | "truncate" | undefined;
    if (canonical !== watcher.path) { watcher.path = canonical; watcher.file.path = canonical; watcher.offset = 0; type = "replace"; }
    else if (details.size < watcher.offset) { watcher.offset = 0; type = "truncate"; }
    else if (details.size > watcher.offset) type = "append";
    if (type === undefined) return { events: [], closed: false };
    const bytes = await this.system.read(watcher.path, watcher.offset, watcher.maximumChunkBytes, signal) ?? new Uint8Array();
    watcher.offset += bytes.byteLength;
    return { events: bytes.byteLength === 0 ? [] : [{ type, bytes: [...bytes] }], closed: false };
  }

  private unfollow(state: TerminalState, payload: JsonValue): JsonValue {
    const watcherId = record(payload)?.watcherId;
    if (typeof watcherId !== "string" || !state.watchers.delete(watcherId)) throw new Error("agent file watcher is unavailable");
    return { stopped: true };
  }

  private registerProcess(state: TerminalState, pid: number): ProcessHandle {
    for (const handle of state.processes.values()) if (handle.pid === pid) return handle;
    const handle = { id: `process-${++state.nextId}`, pid };
    state.processes.set(handle.id, handle); return handle;
  }
  private processFor(state: TerminalState, value: JsonValue): ProcessHandle {
    const source = record(value); const nested = record(source?.handle);
    const id = nested?.id ?? source?.id; const handle = typeof id === "string" ? state.processes.get(id) : undefined;
    if (handle === undefined) throw new Error("agent process handle is unavailable");
    return handle;
  }
  private registerFile(state: TerminalState, path: string): FileHandle {
    for (const handle of state.files.values()) if (handle.path === path) return handle;
    const handle = { id: `file-${++state.nextId}`, path };
    state.files.set(handle.id, handle); return handle;
  }
  private fileFor(state: TerminalState, value: JsonValue | undefined): FileHandle {
    const id = record(value)?.id; const handle = typeof id === "string" ? state.files.get(id) : undefined;
    if (handle === undefined) throw new Error("agent file handle is unavailable");
    return handle;
  }
}

/** Convenience hook for a composed agent broker.  Publication deliberately
 * remains host-owned; this adapter only answers terminal-scoped observations. */
export function createThisServerAgentObservationAdapter(options: ThisServerAgentObservationAdapterOptions): ThisServerAgentObservationAdapter {
  return new ThisServerAgentObservationAdapter(options);
}

const nodeSystem: ThisServerAgentObservationSystem = {
  descendants: nodeDescendants,
  openFiles: nodeOpenFiles,
  tty: nodeTty,
  foreground: nodeForeground,
  environment: nodeEnvironment,
  realpath: async (path, signal) => { throwIfAborted(signal); return realpath(path).catch(() => undefined); },
  stat: async (path, signal) => { throwIfAborted(signal); const value = await stat(path).catch(() => undefined); if (value === undefined) return undefined; return { kind: value.isFile() ? "file" : value.isDirectory() ? "directory" : "other", size: value.size, modifiedAt: Number.isFinite(value.mtimeMs) ? new Date(value.mtimeMs).toISOString() : undefined }; },
  read: nodeRead,
};

async function nodeDescendants(shellPid: number, signal: AbortSignal): Promise<readonly ThisServerAgentProcess[]> {
  throwIfAborted(signal);
  if (process.platform === "linux") return linuxDescendants(shellPid, signal);
  const output = await commandText("ps", ["-axo", "pid=,ppid=,comm="], 4 * 1024 * 1024, signal);
  const children = new Map<number, number[]>(); const names = new Map<number, string>();
  for (const line of output.split(/\r?\n/u)) {
    const [pidText, parentText, ...command] = line.trim().split(/\s+/u); const pid = Number(pidText); const parent = Number(parentText);
    if (!validPid(pid) || !Number.isSafeInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]); names.set(pid, command.join(" "));
  }
  return descend(shellPid, children).map((pid) => ({ pid, executableName: basenameSafe(names.get(pid) ?? "") })).filter((item) => item.executableName.length > 0);
}

async function linuxDescendants(shellPid: number, signal: AbortSignal): Promise<readonly ThisServerAgentProcess[]> {
  const entries = await commandText("sh", ["-c", "printf '%s\\n' /proc/[0-9]*"], 4 * 1024 * 1024, signal).catch(() => "");
  const children = new Map<number, number[]>(); const names = new Map<number, string>();
  for (const entry of entries.split(/\r?\n/u)) {
    const pid = Number(entry.slice("/proc/".length)); if (!validPid(pid)) continue;
    const raw = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => ""); const close = raw.lastIndexOf(")");
    const parent = Number(raw.slice(close + 2).split(/\s+/u)[1]); const name = raw.slice(raw.indexOf("(") + 1, close);
    if (!Number.isSafeInteger(parent) || !safeText(name, 512)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]); names.set(pid, name);
  }
  return descend(shellPid, children).map((pid) => ({ pid, executableName: names.get(pid) ?? "" })).filter((item) => item.executableName.length > 0);
}

async function nodeOpenFiles(processIds: readonly number[], access: "writable" | "readable", signal: AbortSignal): Promise<readonly ThisServerAgentOpenFile[]> {
  if (processIds.length === 0) return [];
  if (process.platform === "linux") return linuxOpenFiles(processIds, access, signal);
  const output = await commandText("lsof", ["-p", processIds.join(","), "-F", "pan"], 8 * 1024 * 1024, signal, true);
  const files: ThisServerAgentOpenFile[] = []; let current: "readable" | "writable" | "read-write" | undefined;
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("p")) current = undefined;
    else if (line.startsWith("a")) current = lsofAccess(line.slice(1));
    else if (line.startsWith("n") && current !== undefined && (access === "readable" || current !== "readable")) files.push({ path: line.slice(1), access: current });
  }
  return files;
}

async function linuxOpenFiles(processIds: readonly number[], access: "writable" | "readable", signal: AbortSignal): Promise<readonly ThisServerAgentOpenFile[]> {
  const result: ThisServerAgentOpenFile[] = [];
  for (const pid of processIds) {
    throwIfAborted(signal);
    const entries = await commandText("sh", ["-c", `printf '%s\\n' /proc/${pid}/fd/*`], 512 * 1024, signal).catch(() => "");
    for (const fd of entries.split(/\r?\n/u)) {
      if (!fd) continue;
      const path = await readlink(fd).catch(() => undefined); const safe = safePath(path); if (safe === undefined) continue;
      const flags = await readFile(`/proc/${pid}/fdinfo/${fd.slice(fd.lastIndexOf("/") + 1)}`, "utf8").catch(() => "");
      const octal = /^flags:\s*(0[0-7]+)/mu.exec(flags)?.[1]; const mode = octal === undefined ? undefined : Number.parseInt(octal, 8) & 3;
      const fileAccess = mode === 1 ? "writable" : mode === 2 ? "read-write" : mode === 0 ? "readable" : undefined;
      if (fileAccess !== undefined && (access === "readable" || fileAccess !== "readable")) result.push({ path: safe, access: fileAccess });
    }
  }
  return result;
}

async function nodeTty(shellPid: number, signal: AbortSignal): Promise<string | undefined> {
  throwIfAborted(signal);
  if (process.platform === "linux") return readlink(`/proc/${shellPid}/fd/0`).catch(() => undefined);
  const output = await commandText("lsof", ["-a", "-p", String(shellPid), "-d", "0", "-Fn"], 64 * 1024, signal, true);
  return output.split(/\r?\n/u).find((line) => line.startsWith("n"))?.slice(1);
}

async function nodeForeground(shellPid: number, signal: AbortSignal): Promise<Readonly<{ executableName: string; arguments?: readonly string[] }> | undefined> {
  const output = await commandText("ps", ["-p", String(shellPid), "-o", "comm="], 64 * 1024, signal, true);
  const executableName = basenameSafe(output.trim()); return executableName ? { executableName } : undefined;
}

async function nodeEnvironment(shellPid: number, names: readonly string[], signal: AbortSignal): Promise<Readonly<Record<string, string>>> {
  throwIfAborted(signal);
  if (process.platform === "linux") {
    const raw = await readFile(`/proc/${shellPid}/environ`).catch(() => undefined);
    if (raw === undefined) return {};
    const values = new Map(raw.toString("utf8").split("\0").flatMap((entry) => {
      const equals = entry.indexOf("="); return equals <= 0 ? [] : [[entry.slice(0, equals), entry.slice(equals + 1)]];
    }));
    return Object.fromEntries(names.flatMap((name) => values.has(name) ? [[name, values.get(name)!]] : []));
  }
  const output = await commandText("ps", ["e", "-p", String(shellPid), "-o", "command="], 256 * 1024, signal, true);
  const values = new Map<string, string>();
  for (const token of output.split(/\s+/u)) { const equals = token.indexOf("="); if (equals > 0) values.set(token.slice(0, equals), token.slice(equals + 1)); }
  return Object.fromEntries(names.flatMap((name) => values.has(name) ? [[name, values.get(name)!]] : []));
}

async function nodeRead(path: string, position: number, maximum: number, signal: AbortSignal): Promise<Uint8Array | undefined> {
  throwIfAborted(signal);
  const file = await open(path, "r").catch(() => undefined); if (file === undefined) return undefined;
  try { const buffer = Buffer.alloc(maximum); const read = await file.read(buffer, 0, maximum, position); throwIfAborted(signal); return new Uint8Array(read.buffer.subarray(0, read.bytesRead)); } finally { await file.close().catch(() => undefined); }
}

function commandText(command: string, args: readonly string[], maximum: number, signal: AbortSignal, allowNoMatches = false): Promise<string> {
  throwIfAborted(signal);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }); let output = ""; let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); callback(); };
    const abort = () => { child.kill("SIGTERM"); finish(() => reject(new Error("agent observation cancelled"))); };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { if (Buffer.byteLength(output, "utf8") < maximum) output += chunk.toString(); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0 || (allowNoMatches && code === 1) ? resolvePromise(output) : reject(new Error(`${command} exited with ${code ?? "signal"}`))));
  });
}

function descend(root: number, children: ReadonlyMap<number, readonly number[]>): number[] { const found: number[] = []; const pending = [...(children.get(root) ?? [])]; while (pending.length > 0) { const pid = pending.shift(); if (pid === undefined || found.includes(pid) || found.length >= MAX_PROCESSES) continue; found.push(pid); pending.push(...(children.get(pid) ?? [])); } return found; }
function lsofAccess(value: string): "readable" | "writable" | "read-write" | undefined { const read = value.includes("r"); const write = value.includes("w") || value.includes("u"); return read && write ? "read-write" : write ? "writable" : read ? "readable" : undefined; }
function foregroundValue(value: Readonly<{ executableName: string; arguments?: readonly string[]; startedAt?: string }>): JsonValue { if (!safeText(value.executableName, 512)) throw new Error("agent foreground observation is malformed"); const argumentsSafe = value.arguments?.filter((item) => safeText(item, 4_096) !== undefined).slice(0, 64); const startedAt = safeText(value.startedAt, 128) ? value.startedAt : undefined; return { executableName: value.executableName, ...(argumentsSafe === undefined ? {} : { arguments: argumentsSafe }), ...(startedAt === undefined ? {} : { startedAt }) }; }
function requiredPid(terminal: ThisServerAgentTerminal): number { if (!validPid(terminal.shellPid)) throw new Error("agent terminal process observation is unavailable"); return terminal.shellPid; }
function validPid(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 4_194_304; }
function safeText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0"); }
function environmentName(value: unknown): value is string { return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value); }
function matchesExtension(path: string, extension: JsonValue | undefined): boolean { return extension === undefined || typeof extension === "string" && extension.length > 0 && extension.length <= 64 && path.endsWith(extension); }
function safePath(value: unknown): string | undefined { return safeText(value, MAX_PATH_LENGTH) && isAbsolute(value) ? value : undefined; }
function safeRelativePath(value: string): boolean { return value.length > 0 && value.length <= MAX_PATH_LENGTH && !value.includes("\0") && !isAbsolute(value) && !value.split(/[\\/]/u).includes(".."); }
function contained(root: string, path: string): boolean { const candidate = relative(root, path); return candidate !== "" && candidate !== ".." && !candidate.startsWith(`..${pathSeparator()}`) && !isAbsolute(candidate); }
function record(value: unknown): Record<string, JsonValue> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined; }
function isOpenAccess(value: unknown): value is "readable" | "writable" | "read-write" { return value === "readable" || value === "writable" || value === "read-write"; }
function boundedBytes(value: unknown, maximum: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error("agent file byte limit is invalid"); return value; }
function positiveBound(value: number | undefined, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) throw new RangeError("invalid agent observation byte limit"); return value; }
function basenameSafe(path: string): string { const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")); return path.slice(slash + 1); }
function pathSeparator(): string { return process.platform === "win32" ? "\\" : "/"; }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new Error("agent observation cancelled"); }
