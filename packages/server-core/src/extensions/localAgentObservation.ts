import { spawn } from "node:child_process";
import { open, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { JsonValue } from "@terminay/extension-api";
import type { ExtensionAgentObservationOperation, ExtensionAgentTerminalContext } from "./types.js";

const MAX_PATH_LENGTH = 4_096;
const MAX_PROCESSES = 2_048;
/** Keep process/open-file snapshots bounded for the provider, not because they
 * cross host IPC. Local observation now runs inside the extension child. */
const MAX_OBSERVED_PROCESSES = 256;
const MAX_OBSERVED_OPEN_FILES = 128;
const MAX_WATCHERS_PER_TERMINAL = 32;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_FOLLOW_CHUNK_BYTES = 256 * 1024;
const MAX_DIRECTORY_LIST_DEPTH = 8;
const MAX_DIRECTORY_LIST_ENTRIES = 256;
const MAX_DIRECTORY_LIST_BYTES = 16 * 1024 * 1024;

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
  readDirectory(path: string, signal: AbortSignal): Promise<readonly ThisServerAgentDirectoryEntry[] | undefined>;
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
  /** Host-private stable file identity used only to reset a watcher safely. */
  readonly identity?: string;
}

export interface ThisServerAgentDirectoryEntry {
  readonly name: string;
  readonly kind: "file" | "directory" | "other";
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
interface DirectoryHandle { readonly id: string; path: string; }
interface Watcher { readonly id: string; readonly file: FileHandle; readonly maximumChunkBytes: number; path: string; offset: number; modifiedAt?: string; identity?: string; }
interface DirectoryWatcher { readonly id: string; readonly directory: DirectoryHandle; readonly options: JsonValue; signature: string; }
interface TerminalState { readonly processes: Map<string, ProcessHandle>; readonly files: Map<string, FileHandle>; readonly directories: Map<string, DirectoryHandle>; readonly watchers: Map<string, Watcher>; readonly directoryWatchers: Map<string, DirectoryWatcher>; nextId: number; homeDirectory?: string; }

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
    // A supplied directory is a test-only deterministic override. Production
    // resolution uses the admitted terminal shell's environment below.
    this.homeDirectory = options.homeDirectory === undefined ? undefined : safePath(options.homeDirectory);
    this.maximumReadBytes = positiveBound(options.maximumReadBytes, MAX_READ_BYTES);
    this.maximumFollowChunkBytes = positiveBound(options.maximumFollowChunkBytes, MAX_FOLLOW_CHUNK_BYTES);
  }

  async observe(terminal: ExtensionAgentTerminalContext, operation: ExtensionAgentObservationOperation, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const local = await this.requireLocalTerminal(terminal, signal);
    const state = this.stateFor(terminal.contextId);
    if (state.homeDirectory === undefined) state.homeDirectory = await this.homeDirectoryFor(local, signal);
    switch (operation) {
      case "process.foreground": return this.foreground(local, signal);
      case "process.descendants": return this.descendants(local, state, signal);
      case "process.open-files": return this.openFiles(state, payload, signal);
      case "process.environment": return this.environment(local, payload, signal);
      case "terminal.tty": return this.tty(local, signal);
      case "filesystem.resolve-home-directory": return this.resolveHomeDirectory(state, payload, signal);
      case "filesystem.resolve-directory-relative-to-environment": return this.resolveDirectoryRelativeToEnvironment(local, state, payload, signal);
      case "filesystem.list-directory": return this.listDirectory(state, payload, signal);
      case "filesystem.watch-directory": return this.watchDirectory(state, payload, signal);
      case "filesystem.unwatch-directory": return this.unwatchDirectory(state, payload);
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
    if (descendants.length > MAX_PROCESSES) return undefined;
    if (descendants.some((process) => !validPid(process.pid) || !safeText(process.executableName, 512))) return undefined;
    const processes = descendants.map((process) => process.pid).sort((left, right) => left - right);
    const files = selectObservedOpenFiles(await this.system.openFiles(processes, "writable", signal));
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
      state = { processes: new Map(), files: new Map(), directories: new Map(), watchers: new Map(), directoryWatchers: new Map(), nextId: 0 };
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
    const processes = (await this.system.descendants(requiredPid(terminal), signal)).slice(0, MAX_PROCESSES);
    const result = processes.flatMap((process) => {
      if (!validPid(process.pid) || !safeText(process.executableName, 512)) return [];
      const handle = this.registerProcess(state, process.pid);
      const startedAt = safeText(process.startedAt, 128) ? process.startedAt : undefined;
      const cwd = safePath(process.cwd);
      return [{
        handle: { id: handle.id }, executableName: process.executableName, pid: process.pid,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(cwd === undefined ? {} : { cwd }),
      }];
    });
    return result.slice(0, MAX_OBSERVED_PROCESSES);
  }

  private async openFiles(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const supplied = Array.isArray(request?.processes) ? request.processes : undefined;
    const options = record(request?.options); const access = options?.access;
    // A foreground transition can precede the kernel process-table update for
    // its descendant.  An empty, host-issued snapshot is therefore normal
    // discovery evidence: it means no process-bound journal yet, not a bad
    // extension request.  The runtime will make its bounded retry while the
    // same foreground incarnation remains current.
    if (supplied === undefined || supplied.length > MAX_PROCESSES || (access !== "writable" && access !== "readable")) throw new Error("agent open-file request is invalid");
    if (supplied.length === 0) return [];
    const pids = supplied.map((value) => this.processFor(state, value).pid);
    const files = selectObservedOpenFiles(await this.system.openFiles([...new Set(pids)], access, signal));
    const result = files.flatMap((file) => {
      const path = safePath(file.path);
      if (path === undefined || !isOpenAccess(file.access)) return [];
      const handle = this.registerFile(state, path);
      return [{ handle: { id: handle.id }, path, access: file.access }];
    });
    return result;
  }

  private async environment(terminal: ThisServerAgentTerminal, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const names = record(payload)?.names;
    if (!Array.isArray(names) || names.length === 0 || names.length > 16 || names.some((name) => !environmentName(name))) throw new Error("agent environment request is invalid");
    const safeNames = names as string[];
    const values = await this.system.environment(requiredPid(terminal), safeNames, signal);
    const entries: Array<[string, string]> = [];
    for (const name of safeNames) { const value = values[name]; if (safeText(value, 4_096)) entries.push([name, value]); }
    const result = Object.fromEntries(entries);
    return result;
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
    if (!this.matchesFileConstraint(canonical, options, state.homeDirectory)) return null;
    file.path = canonical;
    return { id: file.id };
  }

  private async resolveHomeDirectory(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const relativePath = request?.relativePath;
    if (typeof relativePath !== "string" || !safeRelativePath(relativePath)) return null;
    const homeDirectory = state.homeDirectory; if (homeDirectory === undefined) return null;
    const canonical = await this.system.realpath(resolve(homeDirectory, relativePath), signal);
    if (canonical === undefined || safePath(canonical) === undefined || !this.withinHomeConstraint(canonical, request, true, homeDirectory)) return null;
    if ((await this.system.stat(canonical, signal))?.kind !== "directory") return null;
    return { id: this.registerDirectory(state, canonical).id };
  }

  private async resolveDirectoryRelativeToEnvironment(terminal: ThisServerAgentTerminal, state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const relativePath = request?.relativePath;
    if (typeof relativePath !== "string" || !safeRelativePath(relativePath)) return null;
    const root = await this.environmentRoot(terminal, request?.environmentVariable, signal); if (root === undefined) return null;
    const canonical = await this.system.realpath(resolve(root, relativePath), signal);
    const beneath = typeof request?.beneathRelative === "string" && safeRelativePath(request.beneathRelative) ? resolve(root, request.beneathRelative) : root;
    if (canonical === undefined || safePath(canonical) === undefined || !contained(beneath, canonical)) return null;
    if ((await this.system.stat(canonical, signal))?.kind !== "directory") return null;
    return { id: this.registerDirectory(state, canonical).id };
  }

  private async listDirectory(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const root = this.directoryFor(state, request?.root); const options = record(request?.options);
    return this.directoryListing(state, root, options, signal);
  }

  private async watchDirectory(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload);
    if (typeof request?.watcherId === "string") {
      const watcher = state.directoryWatchers.get(request.watcherId);
      if (watcher === undefined) throw new Error("agent directory watcher is unavailable");
      const snapshot = await this.directoryListing(state, watcher.directory, record(watcher.options), signal);
      const signature = JSON.stringify(snapshot);
      if (signature === watcher.signature) return { closed: false };
      watcher.signature = signature; return { snapshot, closed: false };
    }
    if (state.directoryWatchers.size >= MAX_WATCHERS_PER_TERMINAL) throw new Error("agent directory watch exceeds its limit");
    const root = this.directoryFor(state, request?.root); const options = record(request?.options);
    const snapshot = await this.directoryListing(state, root, options, signal);
    const watcher: DirectoryWatcher = { id: `directory-watch-${++state.nextId}`, directory: root, options: structuredClone(options ?? {}), signature: JSON.stringify(snapshot) };
    state.directoryWatchers.set(watcher.id, watcher);
    return { watcherId: watcher.id, snapshot };
  }

  private unwatchDirectory(state: TerminalState, payload: JsonValue): JsonValue {
    const watcherId = record(payload)?.watcherId;
    if (typeof watcherId !== "string" || !state.directoryWatchers.delete(watcherId)) throw new Error("agent directory watcher is unavailable");
    return { stopped: true };
  }

  private async directoryListing(state: TerminalState, root: DirectoryHandle, options: Record<string, JsonValue> | undefined, signal: AbortSignal): Promise<JsonValue> {
    const extensions = Array.isArray(options?.extensions) && options.extensions.length > 0 && options.extensions.length <= 16
      && options.extensions.every((extension) => typeof extension === "string" && extension.length > 0 && extension.length <= 64 && extension.startsWith("."))
      ? options.extensions as string[] : undefined;
    const maxDepth = boundedInteger(options?.maxDepth, 0, MAX_DIRECTORY_LIST_DEPTH);
    const maxEntries = boundedInteger(options?.maxEntries, 1, MAX_DIRECTORY_LIST_ENTRIES);
    const maxBytes = boundedInteger(options?.maxBytes, 1, MAX_DIRECTORY_LIST_BYTES);
    if (!extensions || maxDepth === undefined || maxEntries === undefined || maxBytes === undefined) throw new Error("agent directory list request is invalid");
    const entries: JsonValue[] = []; let bytes = 0; let truncated = false;
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (truncated || signal.aborted) return;
      const children = await this.system.readDirectory(directory, signal);
      if (children === undefined) return;
      for (const child of [...children].sort((left, right) => left.name.localeCompare(right.name))) {
        if (truncated || signal.aborted) return;
        if (!safeDirectoryEntryName(child.name)) continue;
        const candidate = resolve(directory, child.name);
        if (child.kind === "directory") { if (depth < maxDepth) await visit(candidate, depth + 1); continue; }
        if (child.kind !== "file" || !extensions.some((extension) => child.name.endsWith(extension))) continue;
        const canonical = await this.system.realpath(candidate, signal);
        if (canonical === undefined || !contained(root.path, canonical)) continue;
        const details = await this.system.stat(canonical, signal);
        if (details?.kind !== "file" || details.size < 0 || !Number.isSafeInteger(details.size)) continue;
        if (entries.length >= maxEntries || bytes + details.size > maxBytes) { truncated = true; return; }
        const relativePath = relative(root.path, canonical);
        if (!safeRelativePath(relativePath)) continue;
        bytes += details.size;
        entries.push({ handle: { id: this.registerFile(state, canonical).id }, relativePath, size: details.size, ...(safeText(details.modifiedAt, 128) ? { modifiedAt: details.modifiedAt } : {}) });
      }
    };
    await visit(root.path, 0); throwIfAborted(signal);
    return { entries, truncated };
  }

  private async resolveHomeRelative(state: TerminalState, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = record(payload); const relativePath = request?.relativePath;
    if (typeof relativePath !== "string" || !safeRelativePath(relativePath)) return null;
    const homeDirectory = state.homeDirectory; if (homeDirectory === undefined) return null;
    const candidate = resolve(homeDirectory, relativePath);
    const canonical = await this.system.realpath(candidate, signal);
    if (canonical === undefined || safePath(canonical) === undefined || !this.withinHomeConstraint(canonical, request, true, homeDirectory)) return null;
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
    // The opaque file handle has already been terminal-scoped. Its original
    // admission terminal is encoded in adapter state; home is looked up from
    // that exact terminal before returning a fact.
    const homeDirectory = state.homeDirectory;
    if (canonical === undefined || safePath(canonical) === undefined || !this.withinHomeConstraint(canonical, request, false, homeDirectory)) return null;
    const details = await this.system.stat(canonical, signal);
    const beneath = record(request?.beneath); const homeRelative = beneath?.homeRelative;
    if (details?.kind !== "file" || typeof homeRelative !== "string" || homeDirectory === undefined || !safeRelativePath(homeRelative)) return null;
    const result = relative(resolve(homeDirectory, homeRelative), canonical);
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
    const beneath = typeof request?.beneathRelative === "string" && safeRelativePath(request.beneathRelative) ? request.beneathRelative : undefined;
    const containedRoot = root === undefined ? undefined : resolve(root, beneath ?? ".");
    const canonical = containedRoot === undefined ? undefined : await this.system.realpath(file.path, signal);
    if (root === undefined || containedRoot === undefined || canonical === undefined || !contained(containedRoot, canonical)) return null;
    if ((await this.system.stat(canonical, signal))?.kind !== "file") return null;
    const result = relative(containedRoot, canonical);
    return safeRelativePath(result) ? result : null;
  }

  private async environmentRoot(terminal: ThisServerAgentTerminal, name: JsonValue | undefined, signal: AbortSignal): Promise<string | undefined> {
    if (!environmentName(name)) return undefined;
    const value = (await this.system.environment(requiredPid(terminal), [name], signal))[name];
    const path = safePath(value); if (path === undefined) return undefined;
    const canonical = await this.system.realpath(path, signal);
    return canonical !== undefined && safePath(canonical) !== undefined && (await this.system.stat(canonical, signal))?.kind === "directory" ? canonical : undefined;
  }

  private withinHomeConstraint(path: string, request: Record<string, JsonValue> | undefined, defaultHome: boolean, homeDirectory = this.homeDirectory): boolean {
    const beneath = record(request?.beneath); const homeRelative = beneath?.homeRelative;
    if (homeRelative === undefined) return defaultHome && homeDirectory !== undefined && contained(resolve(homeDirectory), path);
    return this.matchesFileConstraint(path, request, homeDirectory);
  }

  private async homeDirectoryFor(terminal: ThisServerAgentTerminal, signal: AbortSignal): Promise<string | undefined> {
    if (this.homeDirectory !== undefined) return this.homeDirectory;
    const value = (await this.system.environment(requiredPid(terminal), ["HOME"], signal)).HOME;
    const path = safePath(value); if (path === undefined) return undefined;
    const canonical = await this.system.realpath(path, signal);
    return canonical !== undefined && (await this.system.stat(canonical, signal))?.kind === "directory" ? canonical : undefined;
  }

  private matchesFileConstraint(path: string, options: Record<string, JsonValue> | undefined, homeDirectory = this.homeDirectory): boolean {
    const extension = options?.extension;
    if (extension !== undefined && (typeof extension !== "string" || extension.length === 0 || extension.length > 64 || !path.endsWith(extension))) return false;
    const beneath = record(options?.beneath); const homeRelative = beneath?.homeRelative;
    if (homeRelative === undefined) return true;
    if (typeof homeRelative !== "string" || homeDirectory === undefined || !safeRelativePath(homeRelative)) return false;
    const root = resolve(homeDirectory, homeRelative);
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
    const changedIdentity = watcher.identity !== undefined && details.identity !== undefined && watcher.identity !== details.identity;
    const changedMetadata = watcher.modifiedAt !== undefined && details.modifiedAt !== undefined && watcher.modifiedAt !== details.modifiedAt;
    if (canonical !== watcher.path) { watcher.path = canonical; watcher.file.path = canonical; watcher.offset = 0; type = "replace"; }
    else if (details.size < watcher.offset) { watcher.offset = 0; type = "truncate"; }
    else if (details.size > watcher.offset) type = "append";
    // Atomic replacement and an in-place equal-size rewrite need not change
    // the pathname or length. mtime is only a conservative replacement fact:
    // reset and replay rather than risk silently missing metadata updates.
    else if (changedIdentity || changedMetadata) { watcher.offset = 0; type = "replace"; }
    watcher.modifiedAt = details.modifiedAt;
    watcher.identity = details.identity;
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
  private registerDirectory(state: TerminalState, path: string): DirectoryHandle {
    for (const handle of state.directories.values()) if (handle.path === path) return handle;
    const handle = { id: `directory-${++state.nextId}`, path };
    state.directories.set(handle.id, handle); return handle;
  }
  private directoryFor(state: TerminalState, value: JsonValue | undefined): DirectoryHandle {
    const source = record(value); const nested = record(source?.handle); const id = nested?.id ?? source?.id;
    const handle = typeof id === "string" ? state.directories.get(id) : undefined;
    if (handle === undefined) throw new Error("agent directory handle is unavailable");
    return handle;
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
  stat: async (path, signal) => { throwIfAborted(signal); const value = await stat(path).catch(() => undefined); if (value === undefined) return undefined; return { kind: value.isFile() ? "file" : value.isDirectory() ? "directory" : "other", size: value.size, modifiedAt: Number.isFinite(value.mtimeMs) ? new Date(value.mtimeMs).toISOString() : undefined, identity: fileIdentity(value) }; },
  readDirectory: async (path, signal) => { throwIfAborted(signal); const values = await readdir(path, { withFileTypes: true }).catch(() => undefined); throwIfAborted(signal); return values?.map((entry) => ({ name: entry.name, kind: entry.isFile() ? "file" as const : entry.isDirectory() ? "directory" as const : "other" as const })); },
  read: nodeRead,
};

function fileIdentity(value: object): string | undefined {
  const candidate = value as { readonly dev?: unknown; readonly ino?: unknown };
  return Number.isSafeInteger(candidate.dev) && Number.isSafeInteger(candidate.ino) ? `:` : undefined;
}

async function nodeDescendants(shellPid: number, signal: AbortSignal): Promise<readonly ThisServerAgentProcess[]> {
  throwIfAborted(signal);
  if (process.platform === "linux") return linuxDescendants(shellPid, signal);
  let output: string;
  try {
    output = await commandText(unixTool("ps"), ["-axo", "pid=,ppid=,comm="], 4 * 1024 * 1024, signal);
  } catch {
    return [{ pid: shellPid, executableName: "shell" }];
  }
  const children = new Map<number, number[]>(); const names = new Map<number, string>();
  for (const line of output.split(/\r?\n/u)) {
    const [pidText, parentText, ...command] = line.trim().split(/\s+/u); const pid = Number(pidText); const parent = Number(parentText);
    if (!validPid(pid) || !Number.isSafeInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]); names.set(pid, command.join(" "));
  }
  return sessionProcesses(shellPid, children, names);
}

async function linuxDescendants(shellPid: number, signal: AbortSignal): Promise<readonly ThisServerAgentProcess[]> {
  const entries = await commandText(unixTool("sh"), ["-c", "printf '%s\\n' /proc/[0-9]*"], 4 * 1024 * 1024, signal).catch(() => "");
  const children = new Map<number, number[]>(); const names = new Map<number, string>();
  for (const entry of entries.split(/\r?\n/u)) {
    const pid = Number(entry.slice("/proc/".length)); if (!validPid(pid)) continue;
    const raw = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => ""); const close = raw.lastIndexOf(")");
    const parent = Number(raw.slice(close + 2).split(/\s+/u)[1]); const name = raw.slice(raw.indexOf("(") + 1, close);
    if (!Number.isSafeInteger(parent) || !safeText(name, 512)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]); names.set(pid, name);
  }
  return sessionProcesses(shellPid, children, names);
}

async function nodeOpenFiles(processIds: readonly number[], access: "writable" | "readable", signal: AbortSignal): Promise<readonly ThisServerAgentOpenFile[]> {
  if (processIds.length === 0) return [];
  if (process.platform === "linux") return linuxOpenFiles(processIds, access, signal);
  let output: string;
  try {
    output = await commandText(unixTool("lsof"), ["-p", processIds.join(","), "-F", "pan"], 8 * 1024 * 1024, signal, true);
  } catch {
    return [];
  }
  const files = accumulateObservedOpenFiles(); let current: "readable" | "writable" | "read-write" | undefined;
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("p")) current = undefined;
    else if (line.startsWith("a")) current = lsofAccess(line.slice(1));
    else if (line.startsWith("n") && current !== undefined && (access === "readable" || current !== "readable")) {
      files.add({ path: line.slice(1), access: current });
    }
  }
  return files.snapshot();
}

async function linuxOpenFiles(processIds: readonly number[], access: "writable" | "readable", signal: AbortSignal): Promise<readonly ThisServerAgentOpenFile[]> {
  const result = accumulateObservedOpenFiles();
  for (const pid of processIds) {
    throwIfAborted(signal);
    const entries = await commandText(unixTool("sh"), ["-c", `printf '%s\\n' /proc/${pid}/fd/*`], 512 * 1024, signal).catch(() => "");
    for (const fd of entries.split(/\r?\n/u)) {
      if (!fd) continue;
      const path = await readlink(fd).catch(() => undefined); const safe = safePath(path); if (safe === undefined) continue;
      const flags = await readFile(`/proc/${pid}/fdinfo/${fd.slice(fd.lastIndexOf("/") + 1)}`, "utf8").catch(() => "");
      const octal = /^flags:\s*(0[0-7]+)/mu.exec(flags)?.[1]; const mode = octal === undefined ? undefined : Number.parseInt(octal, 8) & 3;
      const fileAccess = mode === 1 ? "writable" : mode === 2 ? "read-write" : mode === 0 ? "readable" : undefined;
      if (fileAccess !== undefined && (access === "readable" || fileAccess !== "readable")) result.add({ path: safe, access: fileAccess });
    }
  }
  return result.snapshot();
}

async function nodeTty(shellPid: number, signal: AbortSignal): Promise<string | undefined> {
  throwIfAborted(signal);
  if (process.platform === "linux") return readlink(`/proc/${shellPid}/fd/0`).catch(() => undefined);
  const output = await commandText(unixTool("lsof"), ["-a", "-p", String(shellPid), "-d", "0", "-Fn"], 64 * 1024, signal, true);
  return output.split(/\r?\n/u).find((line) => line.startsWith("n"))?.slice(1);
}

async function nodeForeground(shellPid: number, signal: AbortSignal): Promise<Readonly<{ executableName: string; arguments?: readonly string[] }> | undefined> {
  const output = await commandText(unixTool("ps"), ["-p", String(shellPid), "-o", "comm="], 64 * 1024, signal, true);
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
  const output = await commandText(unixTool("ps"), ["e", "-p", String(shellPid), "-o", "command="], 256 * 1024, signal, true);
  const values = new Map<string, string>();
  for (const token of output.split(/\s+/u)) { const equals = token.indexOf("="); if (equals > 0) values.set(token.slice(0, equals), token.slice(equals + 1)); }
  return Object.fromEntries(names.flatMap((name) => values.has(name) ? [[name, values.get(name)!]] : []));
}

async function nodeRead(path: string, position: number, maximum: number, signal: AbortSignal): Promise<Uint8Array | undefined> {
  throwIfAborted(signal);
  const file = await open(path, "r").catch(() => undefined); if (file === undefined) return undefined;
  try { const buffer = Buffer.alloc(maximum); const read = await file.read(buffer, 0, maximum, position); throwIfAborted(signal); return new Uint8Array(read.buffer.subarray(0, read.bytesRead)); } finally { await file.close().catch(() => undefined); }
}

function unixTool(name: "ps" | "lsof" | "sh"): string {
  if (process.platform === "darwin") return name === "lsof" ? "/usr/sbin/lsof" : `/bin/${name}`;
  if (process.platform === "linux") return name === "lsof" ? "/usr/bin/lsof" : `/bin/${name}`;
  return name;
}

function observationSpawnEnv(): NodeJS.ProcessEnv {
  const fallback = "/usr/sbin:/usr/bin:/bin:/sbin";
  const path = process.env.PATH;
  return { ...process.env, PATH: path && path.length > 0 ? `${path}:${fallback}` : fallback };
}

function commandText(command: string, args: readonly string[], maximum: number, signal: AbortSignal, allowNoMatches = false): Promise<string> {
  throwIfAborted(signal);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: observationSpawnEnv() }); let output = ""; let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); callback(); };
    const abort = () => { child.kill("SIGTERM"); finish(() => reject(new Error("agent observation cancelled"))); };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { if (Buffer.byteLength(output, "utf8") < maximum) output += chunk.toString(); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0 || (allowNoMatches && code === 1) ? resolvePromise(output) : reject(new Error(`${command} exited with ${code ?? "signal"}`))));
  });
}

function descend(root: number, children: ReadonlyMap<number, readonly number[]>): number[] { const found: number[] = []; const pending = [...(children.get(root) ?? [])]; while (pending.length > 0) { const pid = pending.shift(); if (pid === undefined || found.includes(pid) || found.length >= MAX_PROCESSES) continue; found.push(pid); pending.push(...(children.get(pid) ?? [])); } return found; }
function sessionProcesses(shellPid: number, children: ReadonlyMap<number, readonly number[]>, names: ReadonlyMap<number, string>): ThisServerAgentProcess[] {
  const pids = [shellPid, ...descend(shellPid, children).filter((pid) => pid !== shellPid)];
  return pids.flatMap((pid) => {
    const executableName = basenameSafe(names.get(pid) ?? (pid === shellPid ? "shell" : ""));
    return executableName.length > 0 ? [{ pid, executableName }] : [];
  });
}
function lsofAccess(value: string): "readable" | "writable" | "read-write" | undefined { const read = value.includes("r"); const write = value.includes("w") || value.includes("u"); return read && write ? "read-write" : write ? "writable" : read ? "readable" : undefined; }
function foregroundValue(value: Readonly<{ executableName: string; arguments?: readonly string[]; startedAt?: string }>): JsonValue { if (!safeText(value.executableName, 512)) throw new Error("agent foreground observation is malformed"); const argumentsSafe = value.arguments?.filter((item) => safeText(item, 4_096) !== undefined).slice(0, 64); const startedAt = safeText(value.startedAt, 128) ? value.startedAt : undefined; return { executableName: value.executableName, ...(argumentsSafe === undefined ? {} : { arguments: argumentsSafe }), ...(startedAt === undefined ? {} : { startedAt }) }; }
function requiredPid(terminal: ThisServerAgentTerminal): number { if (!validPid(terminal.shellPid)) throw new Error("agent terminal process observation is unavailable"); return terminal.shellPid; }
function validPid(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 4_194_304; }
function safeText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0"); }
function environmentName(value: unknown): value is string { return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value); }
function matchesExtension(path: string, extension: JsonValue | undefined): boolean { return extension === undefined || typeof extension === "string" && extension.length > 0 && extension.length <= 64 && path.endsWith(extension); }
function safePath(value: unknown): string | undefined { return safeText(value, MAX_PATH_LENGTH) && isAbsolute(value) ? value : undefined; }
function safeRelativePath(value: string): boolean { return value.length > 0 && value.length <= MAX_PATH_LENGTH && !value.includes("\0") && !isAbsolute(value) && !value.split(/[\\/]/u).includes(".."); }
function safeDirectoryEntryName(value: string): boolean { return safeRelativePath(value) && !value.includes("/") && !value.includes("\\") && value !== "." && value !== ".."; }
function contained(root: string, path: string): boolean { const candidate = relative(root, path); return candidate !== "" && candidate !== ".." && !candidate.startsWith(`..${pathSeparator()}`) && !isAbsolute(candidate); }
function record(value: unknown): Record<string, JsonValue> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined; }
function isOpenAccess(value: unknown): value is "readable" | "writable" | "read-write" { return value === "readable" || value === "writable" || value === "read-write"; }
function isAgentJournalPath(path: string): boolean { return path.endsWith(".jsonl") || path.includes("/sessions/"); }
function accumulateObservedOpenFiles(): { add(file: ThisServerAgentOpenFile): void; snapshot(): ThisServerAgentOpenFile[] } {
  const journals: ThisServerAgentOpenFile[] = [];
  const others: ThisServerAgentOpenFile[] = [];
  return {
    add(file) {
      const path = safePath(file.path);
      if (path === undefined || !isOpenAccess(file.access)) return;
      const entry = { path, access: file.access };
      if (isAgentJournalPath(path)) {
        if (journals.length < MAX_OBSERVED_OPEN_FILES) journals.push(entry);
      } else if (others.length < MAX_OBSERVED_OPEN_FILES) others.push(entry);
    },
    snapshot() { return journals.length > 0 ? journals : others; },
  };
}
function selectObservedOpenFiles(files: readonly ThisServerAgentOpenFile[]): ThisServerAgentOpenFile[] {
  const collected = accumulateObservedOpenFiles();
  for (const file of files) collected.add(file);
  return collected.snapshot();
}
function boundedBytes(value: unknown, maximum: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error("agent file byte limit is invalid"); return value; }
function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined; }
function positiveBound(value: number | undefined, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) throw new RangeError("invalid agent observation byte limit"); return value; }
function basenameSafe(path: string): string { const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")); return path.slice(slash + 1); }
function pathSeparator(): string { return process.platform === "win32" ? "\\" : "/"; }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new Error("agent observation cancelled"); }
