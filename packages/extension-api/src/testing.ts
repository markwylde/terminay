import { createAgentLifecyclePublisher, createJsonlRecordDecoder } from "./agent.js";
import { EXTENSION_API_VERSION } from "./constants.js";
import {
  ExtensionSchemaError,
  validateProviderDependencyHandler,
  validateProviderDependencyResult,
  validateProviderDependencyTargetContext,
  validateProviderDependencyTargetRequest,
  validateProviderVaultPutRequest,
  validateProviderVaultRemoveRequest,
  validateProviderVaultWithSecretRequest,
} from "./validation.js";
import type {
  AgentDirectoryHandle,
  AgentDirectoryListOptions,
  AgentDiscoveredFile,
  AgentFileHandle,
  AgentFileWatcher,
  AgentForegroundProcess,
  AgentLifecycleEvent,
  AgentModelMetadata,
  AgentObservationCapability,
  AgentObservationResult,
  AgentOpenFile,
  AgentProcessHandle,
  AgentProcessSnapshot,
  AgentProjectHandle,
  AgentProviderRegistration,
  AgentProviderRuntime,
  AgentRecordContext,
  AgentSessionBinding,
  AgentSessionBindingRequest,
  AgentTerminalContext,
  AgentTerminalHandle,
  AgentTerminalTtyFact,
  CancellationSignal,
  Disposable,
  ExtensionContext,
  TerminayExtension,
  TerminayExtensionManifest,
} from "./types.js";
import type {
  JsonValue,
  ProviderDependencyHandler,
  ProviderDependencyTargetContext,
  ProviderDependencyTargetRequest,
  ProviderVaultBinding,
  ProviderVaultBroker,
} from "./types.js";

export type FixtureEnvironmentKind = "this-server" | "ssh";
export type ObservationCancelReason = "process-exit" | "terminal-close" | "environment-change" | "extension-disable";
export type ExtensionReleaseReason = "disabled" | "updated" | "shutdown" | "extension-host-failure";

export interface FixtureTerminalOptions {
  foregroundExecutable: string;
  arguments?: string[];
  /** Safe PTY fact for testing terminal-scoped breadcrumb discovery. */
  tty?: AgentTerminalTtyFact;
  /** Bounded foreground/descendant CWD fact; never filesystem authority. */
  cwd?: string;
  /** Optional OS pid fact for provider live-session registries. */
  pid?: number;
  /** Values exposed only through `processes.environment(requestedNames)`. */
  environment?: Record<string, string>;
  capabilities?: AgentObservationCapability[];
  files?: Record<string, unknown[]>;
  /** Opaque handle namespace; two fixtures never share provenance. */
  terminalId?: string;
  /**
   * Routes observation the same way the host does: **This server** is backed by
   * the server account, SSH by the environment's advertised capability. Files
   * exist only inside this broker — never on the Node filesystem.
   */
  environmentKind?: FixtureEnvironmentKind;
  signal?: CancellationSignal;
}

export interface ObservationCancellation {
  readonly signal: CancellationSignal;
  cancel(reason: ObservationCancelReason): void;
}

/** Cancellation signal that fires for each observation-lifetime trigger. */
export function createObservationCancellation(): ObservationCancellation {
  let aborted = false;
  let message = "cancelled";
  const signal: CancellationSignal = {
    get aborted() { return aborted; },
    throwIfAborted() { if (aborted) throw new Error(message); },
  };
  return {
    signal,
    cancel(reason) {
      aborted = true;
      message = reason;
    },
  };
}

const notCancelled: CancellationSignal = Object.freeze({ aborted: false, throwIfAborted(): void {} });

export interface ProviderDependencyTargetHarness {
  /** Validates and invokes a public dependency target as the host would. */
  call(request: ProviderDependencyTargetRequest, context?: Partial<Omit<ProviderDependencyTargetContext, "signal" | "vault">> & { signal?: CancellationSignal; vault?: ProviderVaultBroker }): Promise<JsonValue>;
}

/**
 * Creates an in-memory target-side dependency boundary for public extension
 * tests. It deliberately does not emulate authorization; hosts authorize the
 * caller manifest dependency and target contribution before this boundary.
 */
export function createProviderDependencyTargetHarness(handler: ProviderDependencyHandler): ProviderDependencyTargetHarness {
  assertValid(validateProviderDependencyHandler(handler), "Invalid provider dependency handler");
  const vault = createProviderVaultHarness();
  return {
    async call(request, overrides = {}): Promise<JsonValue> {
      assertValid(validateProviderDependencyTargetRequest(request), "Invalid provider dependency target request");
      const context: ProviderDependencyTargetContext = {
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        signal: notCancelled,
        vault,
        ...overrides,
      };
      assertValid(validateProviderDependencyTargetContext(context), "Invalid provider dependency target context");
      const result = await handler.call(request, context);
      assertValid(validateProviderDependencyResult(result), "Invalid provider dependency result");
      return result;
    },
  };
}

interface FixtureVaultEntry {
  binding: ProviderVaultBinding;
  bindingKey: string;
  purpose: string;
  value: Uint8Array;
  revision: number;
  state: "active" | "pending" | "deleted";
  activeUses: number;
  putResults: Map<string, { binding: ProviderVaultBinding; revision: number }>;
  removeResults: Map<string, { state: "deleted" | "pending" }>;
}

/**
 * Creates a one-scope in-memory vault broker for extension tests. It validates
 * the public contract, models callback lifetime/zeroization and pending
 * removal, but deliberately does not pretend to enforce cross-extension or
 * installation security. Production hosts must enforce that boundary.
 */
export function createProviderVaultHarness(): ProviderVaultBroker {
  const entriesByKey = new Map<string, FixtureVaultEntry>();
  const entriesByBinding = new Map<string, FixtureVaultEntry>();
  const unavailable = (): never => { throw new Error("Vault binding unavailable"); };
  const dispose = (entry: FixtureVaultEntry): void => {
    entry.value.fill(0);
    entry.state = "deleted";
    entriesByKey.delete(entry.bindingKey);
  };
  const entryFor = (binding: ProviderVaultBinding): FixtureVaultEntry => {
    const entry = entriesByBinding.get(binding.bindingRef);
    if (entry?.state !== "active") return unavailable();
    return entry;
  };

  return {
    async put(request) {
      assertValid(validateProviderVaultPutRequest(request), "Invalid provider vault put request");
      const existing = entriesByKey.get(request.bindingKey);
      if (existing?.state === "active") {
        const repeated = existing.putResults.get(request.idempotencyKey);
        if (repeated) return repeated;
        if (request.expectedRevision !== undefined && request.expectedRevision !== existing.revision) throw new Error("Vault revision conflict");
        const received = request.value.slice();
        const stored = received.slice();
        received.fill(0);
        existing.value.fill(0);
        existing.value = stored;
        existing.purpose = request.purpose;
        existing.revision += 1;
        const result = { binding: existing.binding, revision: existing.revision };
        existing.putResults.set(request.idempotencyKey, result);
        return result;
      }
      if (request.expectedRevision !== undefined) throw new Error("Vault revision conflict");
      const received = request.value.slice();
      const stored = received.slice();
      received.fill(0);
      const binding = Object.freeze({ bindingRef: fixtureBindingRef() });
      const entry: FixtureVaultEntry = {
        binding, bindingKey: request.bindingKey, purpose: request.purpose, value: stored, revision: 0,
        state: "active", activeUses: 0, putResults: new Map(), removeResults: new Map(),
      };
      entriesByKey.set(entry.bindingKey, entry);
      entriesByBinding.set(binding.bindingRef, entry);
      const result = { binding, revision: entry.revision };
      entry.putResults.set(request.idempotencyKey, result);
      return result;
    },
    async withSecret(request, use) {
      assertValid(validateProviderVaultWithSecretRequest(request), "Invalid provider vault secret request");
      if (typeof use !== "function") throw new ExtensionSchemaError("Invalid provider vault callback", [{ path: "$.use", code: "invalid_type", message: "Expected a local callback function" }]);
      const entry = entryFor(request.binding);
      if (entry.purpose !== request.purpose) return unavailable();
      entry.activeUses += 1;
      const parentCopy = entry.value.slice();
      const childCopy = parentCopy.slice();
      parentCopy.fill(0);
      try {
        return await use(childCopy);
      } finally {
        childCopy.fill(0);
        entry.activeUses -= 1;
        if (entry.state === "pending" && entry.activeUses === 0) dispose(entry);
      }
    },
    async remove(request) {
      assertValid(validateProviderVaultRemoveRequest(request), "Invalid provider vault remove request");
      const entry = entriesByBinding.get(request.binding.bindingRef);
      if (!entry || entry.state === "deleted") return unavailable();
      const repeated = entry.removeResults.get(request.idempotencyKey);
      if (repeated) return repeated;
      if (request.expectedRevision !== undefined && request.expectedRevision !== entry.revision) throw new Error("Vault revision conflict");
      const result = { state: entry.activeUses > 0 ? "pending" as const : "deleted" as const };
      entry.removeResults.set(request.idempotencyKey, result);
      if (result.state === "pending") entry.state = "pending";
      else dispose(entry);
      return result;
    },
  };
}

let fixtureBindingSequence = 0;
function fixtureBindingRef(): string { return `fixture_vault_ref_${(++fixtureBindingSequence).toString(36).padStart(16, "0")}`; }

function assertValid<T>(result: { ok: true; value: T } | { ok: false; issues: readonly { path: string; code: string; message: string }[] }, message: string): T {
  if (!result.ok) throw new ExtensionSchemaError(message, [...result.issues]);
  return result.value;
}

let fixtureTerminalSequence = 0;

function createIdempotentWatcher<T>(items: readonly T[], signal: CancellationSignal): AsyncIterable<T> & Disposable {
  let closed = false;
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        signal.throwIfAborted();
        if (closed) return;
        yield item;
      }
    },
    async dispose() { closed = true; },
  };
}

/** Creates one terminal-scoped in-memory observation context for public extension tests. */
export function fixtureTerminal(options: FixtureTerminalOptions): AgentTerminalContext {
  const files = new Map<string, Uint8Array>();
  for (const [path, records] of Object.entries(options.files ?? {})) {
    files.set(path, new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "")));
  }
  const scope = options.terminalId ?? `fixture-terminal-${(++fixtureTerminalSequence).toString(36)}`;
  const capabilities = new Set<AgentObservationCapability>(options.capabilities ?? ["process-observation", "filesystem-observation", "agent-journal"]);
  const signal = options.signal ?? notCancelled;
  const issue = <T>(kind: string, path: string): T => Object.freeze({ id: `${scope}:${kind}:${path}` }) as T;
  const pathOf = (handle: { id: string }, kind: string, label: string): string => {
    const prefix = `${scope}:${kind}:`;
    if (typeof handle?.id !== "string" || !handle.id.startsWith(prefix)) throw new Error(`${label} is unavailable`);
    return handle.id.slice(prefix.length);
  };
  const fileHandle = (path: string): AgentFileHandle => issue("file", path);
  const directoryHandle = (path: string): AgentDirectoryHandle => issue("dir", path);
  const process = issue<AgentProcessHandle>("process", "foreground");
  const foreground: AgentForegroundProcess = { executableName: options.foregroundExecutable, arguments: options.arguments };
  const requireCapability = (capability: AgentObservationCapability): void => {
    if (!capabilities.has(capability)) throw new Error(`agent observation is unavailable: ${capability} is not advertised`);
  };
  const lookup = (handle: AgentFileHandle): Uint8Array => files.get(pathOf(handle, "file", "agent file handle")) ?? new Uint8Array();
  const processHandleOf = (value: AgentProcessSnapshot | AgentProcessHandle): AgentProcessHandle =>
    "handle" in value && value.handle !== undefined ? value.handle : value as AgentProcessHandle;

  return {
    terminal: issue<AgentTerminalHandle>("terminal", scope),
    project: { id: "fixture-project" } as unknown as AgentProjectHandle,
    environment: { id: options.environmentKind === "ssh" ? "ssh-environment" : "this-server" } as AgentTerminalContext["environment"],
    process, foreground, tty: options.tty, capabilities, signal,
    async bindSession(request: AgentSessionBindingRequest): Promise<AgentSessionBinding> {
      if (request.journal) pathOf(request.journal, "file", "agent file handle");
      if (request.fingerprint.file) pathOf(request.fingerprint.file, "file", "agent file handle");
      if (request.fingerprint.process) pathOf(request.fingerprint.process, "process", "agent process handle");
      return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal } as unknown as AgentSessionBinding;
    },
    observation: {
      processes: {
        async descendants(): Promise<AgentProcessSnapshot[]> {
          requireCapability("process-observation");
          signal.throwIfAborted();
          return [{ handle: process, executableName: foreground.executableName, cwd: options.cwd, pid: options.pid ?? 4242 }];
        },
        async openFiles(processes, request): Promise<AgentOpenFile[]> {
          requireCapability("process-observation");
          signal.throwIfAborted();
          for (const item of processes) pathOf(processHandleOf(item), "process", "agent process handle");
          const access = request.access;
          return [...files.keys()].map((path) => ({ handle: fileHandle(path), path, access }));
        },
        async environment(names: readonly string[]): Promise<Record<string, string>> {
          requireCapability("process-observation");
          signal.throwIfAborted();
          const values = options.environment ?? {};
          return Object.fromEntries(names.flatMap((name) => values[name] === undefined ? [] : [[name, values[name]] as const]));
        },
      },
      files: {
        async resolveHomeDirectory(relativePath: string) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const root = `/home/test/${relativePath.replace(/\/$/, "")}`;
          return [...files.keys()].some((path) => path.startsWith(`${root}/`) || path === root) ? directoryHandle(root) : undefined;
        },
        async resolveDirectoryRelativeToEnvironment(relativePath: string, request: { environmentVariable: string }) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const environmentRoot = options.environment?.[request.environmentVariable]?.replace(/\/$/, "");
          const root = environmentRoot ? `${environmentRoot}/${relativePath.replace(/\/$/, "")}` : undefined;
          return root && [...files.keys()].some((path) => path.startsWith(`${root}/`) || path === root) ? directoryHandle(root) : undefined;
        },
        async listDirectory(root: AgentDirectoryHandle, request: AgentDirectoryListOptions) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const prefix = `${pathOf(root, "dir", "agent directory handle").replace(/\/$/, "")}/`;
          let bytes = 0; let truncated = false;
          const entries: AgentDiscoveredFile[] = [];
          for (const path of [...files.keys()].sort()) {
            const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
            if (!relativePath || relativePath.split("/").length - 1 > request.maxDepth || !request.extensions.some((extension) => relativePath.endsWith(extension))) continue;
            const data = files.get(path)!;
            if (entries.length >= request.maxEntries || bytes + data.byteLength > request.maxBytes) { truncated = true; break; }
            bytes += data.byteLength; entries.push({ handle: fileHandle(path), relativePath, size: data.byteLength });
          }
          return { entries, truncated };
        },
        async watchDirectory(root: AgentDirectoryHandle, request: AgentDirectoryListOptions) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const listing = await this.listDirectory(root, request);
          return createIdempotentWatcher([listing], signal);
        },
        async resolveRelativeToEnvironment(relativePath: string, request: { environmentVariable: string }) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const root = request.environmentVariable && options.environment?.[request.environmentVariable];
          const exact = root === undefined ? undefined : `${root.replace(/\/$/, "")}/${relativePath}`;
          return exact !== undefined && files.has(exact) ? fileHandle(exact) : undefined;
        },
        async resolvePathUnderEnvironment(providerPath: string, request: { environmentVariable: string; beneathRelative?: string }) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const root = request.environmentVariable && options.environment?.[request.environmentVariable];
          const prefix = root === undefined ? undefined : `${root.replace(/\/$/, "")}/${request.beneathRelative ? `${request.beneathRelative}/` : ""}`;
          return prefix !== undefined && providerPath.startsWith(prefix) && files.has(providerPath) ? fileHandle(providerPath) : undefined;
        },
        async environmentRelativePath(handle: AgentFileHandle, request: { environmentVariable: string; beneathRelative?: string }) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const path = pathOf(handle, "file", "agent file handle");
          const root = request.environmentVariable && options.environment?.[request.environmentVariable];
          const prefix = root === undefined ? undefined : `${root.replace(/\/$/, "")}/${request.beneathRelative ? `${request.beneathRelative}/` : ""}`;
          return prefix !== undefined && path.startsWith(prefix) && files.has(path) ? path.slice(prefix.length) : undefined;
        },
        async resolveHomeRelative(relativePath: string) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const exact = `/home/test/${relativePath}`;
          return files.has(exact) ? fileHandle(exact) : files.has(relativePath) ? fileHandle(relativePath) : undefined;
        },
        async resolvePathUnderHome(providerPath: string, request: { beneath: { homeRelative: string } }) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const allowedPrefix = `/home/test/${request.beneath.homeRelative}/`;
          return providerPath.startsWith(allowedPrefix) && files.has(providerPath) ? fileHandle(providerPath) : undefined;
        },
        async homeRelativePath(handle: AgentFileHandle, request: { beneath: { homeRelative: string } }) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const path = pathOf(handle, "file", "agent file handle");
          const allowedPrefix = `/home/test/${request.beneath.homeRelative}/`;
          return path.startsWith(allowedPrefix) && files.has(path) ? path.slice(allowedPrefix.length) : undefined;
        },
        async canonicalFile(handle: AgentFileHandle) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const path = pathOf(handle, "file", "agent file handle");
          return files.has(path) ? handle : undefined;
        },
        async realpath(handle: AgentFileHandle) {
          return this.canonicalFile(handle);
        },
        async stat(handle: AgentFileHandle) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          const path = pathOf(handle, "file", "agent file handle");
          return files.has(path) ? { handle, kind: "file" as const, size: lookup(handle).byteLength } : undefined;
        },
        async read(handle: AgentFileHandle, request: { maxBytes: number }) {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          return lookup(handle).slice(0, request.maxBytes);
        },
        async readJson<T>(handle: AgentFileHandle, request: { maxBytes: number }): Promise<T | undefined> {
          requireCapability("filesystem-observation");
          signal.throwIfAborted();
          try { return JSON.parse(new TextDecoder().decode(lookup(handle).slice(0, request.maxBytes))) as T; } catch { return undefined; }
        },
        async readJsonLine<T>(handle: AgentFileHandle, request: { maxBytes: number; position: "first" | "last" }): Promise<T | undefined> {
          requireCapability("agent-journal");
          signal.throwIfAborted();
          const lines = new TextDecoder().decode(lookup(handle).slice(0, request.maxBytes)).split("\n").filter(Boolean);
          try { return JSON.parse(request.position === "first" ? lines[0]! : lines.at(-1)!) as T; } catch { return undefined; }
        },
        async follow(handle: AgentFileHandle): Promise<AgentFileWatcher> {
          requireCapability("agent-journal");
          signal.throwIfAborted();
          const bytes = lookup(handle).slice();
          return createIdempotentWatcher(bytes.byteLength ? [{ type: "append" as const, bytes }] : [], signal);
        },
      },
    },
  };
}

export interface HarnessLifecycleProjection {
  sessionStarted: boolean;
  working: boolean;
  waiting: boolean;
  done: boolean;
  activeToolIds: readonly string[];
  title?: string;
  model?: AgentModelMetadata;
}

export interface AgentExtensionHarness {
  observe(terminal: AgentTerminalContext): Promise<void>;
  events(): readonly AgentLifecycleEvent[];
  observation(): AgentObservationResult | undefined;
  projection(): HarnessLifecycleProjection;
  dispose(): Promise<void>;
  release(reason: ExtensionReleaseReason): Promise<void>;
}

export interface AgentExtensionHarnessOptions {
  manifest?: TerminayExtensionManifest;
}

function applyLifecycle(projection: {
  sessionStarted: boolean;
  working: boolean;
  waiting: boolean;
  done: boolean;
  activeToolIds: string[];
  title?: string;
  model?: AgentModelMetadata;
}, event: AgentLifecycleEvent): void {
  switch (event.kind) {
    case "session.started":
      if (projection.sessionStarted) throw new Error("lifecycle: session already started");
      projection.sessionStarted = true;
      projection.working = false;
      projection.waiting = false;
      projection.done = false;
      projection.activeToolIds = [];
      projection.title = event.title;
      projection.model = event.model;
      return;
    case "agent.metadata":
      if (!projection.sessionStarted) throw new Error("lifecycle: metadata change is not a new session");
      if (event.title !== undefined) projection.title = event.title;
      if (event.model !== undefined) projection.model = event.model;
      return;
    case "turn.started":
      if (!projection.sessionStarted) throw new Error("lifecycle: turn requires a session");
      projection.working = true;
      projection.waiting = false;
      projection.done = false;
      return;
    case "tool.started":
      if (!projection.sessionStarted) throw new Error("lifecycle: tool requires a session");
      projection.working = true;
      projection.activeToolIds.push(event.toolId);
      return;
    case "tool.finished":
      projection.activeToolIds = projection.activeToolIds.filter((id) => id !== event.toolId);
      return;
    case "wait.started":
      projection.waiting = true;
      projection.working = false;
      return;
    case "wait.finished":
      projection.waiting = false;
      projection.working = true;
      return;
    case "agent.done":
      projection.done = true;
      projection.working = false;
      projection.waiting = false;
      projection.activeToolIds = [];
      return;
    case "session.stopped":
    case "agent.exited":
      projection.sessionStarted = false;
      projection.done = true;
      projection.working = false;
      projection.waiting = false;
      projection.activeToolIds = [];
      return;
    case "subagent.started":
    case "subagent.done":
      if (!projection.sessionStarted) throw new Error("lifecycle: subagent requires a session");
      return;
  }
}

/** Activates an extension in-memory and captures its validated lifecycle events. */
export async function createAgentExtensionHarness(
  extension: TerminayExtension,
  options: AgentExtensionHarnessOptions = {},
): Promise<AgentExtensionHarness> {
  const registrations = new Map<string, AgentProviderRuntime>();
  const subscriptions: AgentProviderRegistration[] = [];
  const declared = new Set(options.manifest?.contributes.agentProviders?.map((provider) => provider.id) ?? []);
  const requiredCapabilities = options.manifest?.contributes.agentProviders?.flatMap((provider) => provider.requiredEnvironmentCapabilities) ?? [];
  const context: ExtensionContext = {
    extensionId: options.manifest?.id ?? "test.extension",
    apiVersion: EXTENSION_API_VERSION,
    paths: { configuration: "/fixture/config", data: "/fixture/data", cache: "/fixture/cache" },
    registerProjectEnvironmentProvider(): void {},
    agents: {
      registerProvider(providerId, runtime) {
        if (options.manifest && !declared.has(providerId)) throw new Error("agent provider registration is undeclared or invalid");
        if (registrations.has(providerId)) throw new Error(`Duplicate agent provider: ${providerId}`);
        registrations.set(providerId, runtime);
        return { providerId, dispose(): void { registrations.delete(providerId); } };
      },
    },
    subscriptions: {
      add(subscription) {
        subscriptions.push(subscription as AgentProviderRegistration);
        return subscription;
      },
    },
  };
  await extension.activate(context);
  const emitted: AgentLifecycleEvent[] = [];
  const projectionState = {
    sessionStarted: false,
    working: false,
    waiting: false,
    done: false,
    activeToolIds: [] as string[],
    title: undefined as string | undefined,
    model: undefined as AgentModelMetadata | undefined,
  };
  let lastObservation: AgentObservationResult | undefined;
  const publish = createAgentLifecyclePublisher((event) => {
    applyLifecycle(projectionState, event);
    emitted.push(event);
  });
  async function release(reason: ExtensionReleaseReason): Promise<void> {
    void reason;
    const owned = subscriptions.splice(0, subscriptions.length);
    for (const subscription of owned.reverse()) await subscription.dispose();
    registrations.clear();
  }
  return {
    async observe(terminal) {
      // Topology replacement re-observes a new writer on the same harness.
      projectionState.sessionStarted = false;
      projectionState.working = false;
      projectionState.waiting = false;
      projectionState.done = false;
      projectionState.activeToolIds = [];
      projectionState.title = undefined;
      projectionState.model = undefined;
      const missing = requiredCapabilities.filter((capability) => !terminal.capabilities.has(capability));
      for (const runtime of registrations.values()) {
        if (!runtime.matchesForeground(terminal.foreground)) continue;
        const result = await runtime.observe(terminal);
        lastObservation = result;
        if (result.state !== "bound" || !("source" in result)) continue;
        await replaySource(result.source, { binding: result.binding, journal: { role: "root" }, publish, signal: terminal.signal }, result.mapRecord);
        for (const child of result.childSources ?? []) {
          await replaySource(child.source, { binding: result.binding, journal: { role: "child", childId: child.childId }, publish, signal: terminal.signal }, result.mapRecord);
        }
        const discovery = result.childSourceDiscovery === undefined ? undefined : await Promise.resolve(result.childSourceDiscovery);
        if (discovery) {
          for await (const child of discovery) {
            await replaySource(child.source, { binding: result.binding, journal: { role: "child", childId: child.childId }, publish, signal: terminal.signal }, result.mapRecord);
          }
        }
      }
      if (missing.length > 0 && emitted.length > 0) {
        throw new Error("harness: mapping produced events without required environment capabilities");
      }
    },
    events() { return emitted; },
    observation() { return lastObservation; },
    projection() {
      return {
        sessionStarted: projectionState.sessionStarted,
        working: projectionState.working,
        waiting: projectionState.waiting,
        done: projectionState.done,
        activeToolIds: [...projectionState.activeToolIds],
        title: projectionState.title,
        model: projectionState.model,
      };
    },
    async dispose() { await release("shutdown"); },
    release,
  };
}

async function replaySource(source: AgentFileWatcher | Promise<AgentFileWatcher>, context: AgentRecordContext, mapRecord: (record: unknown, context: AgentRecordContext) => void | Promise<void>): Promise<void> {
  context.signal.throwIfAborted();
  const watcher = await source;
  const decoder = createJsonlRecordDecoder();
  try {
    for await (const chunk of watcher) {
      context.signal.throwIfAborted();
      for (const record of decoder.push(chunk.bytes, chunk.type !== "append")) {
        context.signal.throwIfAborted();
        await mapRecord(record, context);
      }
    }
  } finally { await watcher.dispose(); }
}
