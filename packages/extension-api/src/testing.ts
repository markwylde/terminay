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
  AgentFileHandle, AgentFileWatcher, AgentForegroundProcess, AgentLifecycleEvent, AgentLifecyclePublisher,
  AgentObservationCapability, AgentProcessHandle, AgentProcessSnapshot, AgentProjectHandle, AgentProviderRegistration,
  AgentProviderRuntime, AgentRecordContext, AgentSessionBinding, AgentSessionBindingRequest, AgentTerminalContext,
  AgentTerminalHandle, AgentTerminalTtyFact, CancellationSignal, ExtensionContext, TerminayExtension,
} from "./types.js";
import type {
  JsonValue,
  ProviderDependencyHandler,
  ProviderDependencyTargetContext,
  ProviderDependencyTargetRequest,
  ProviderVaultBinding,
  ProviderVaultBroker,
} from "./types.js";

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
    if (!entry || entry.state !== "active") return unavailable();
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

/** Creates one terminal-scoped in-memory observation context for public extension tests. */
export function fixtureTerminal(options: FixtureTerminalOptions): AgentTerminalContext {
  const files = new Map<string, Uint8Array>();
  for (const [path, records] of Object.entries(options.files ?? {})) files.set(path, new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "")));
  const fileHandle = (path: string): AgentFileHandle => ({ id: path } as unknown as AgentFileHandle);
  const directoryHandle = (path: string): import("./types.js").AgentDirectoryHandle => ({ id: path } as unknown as import("./types.js").AgentDirectoryHandle);
  const process = { id: "fixture-process" } as unknown as AgentProcessHandle;
  const foreground: AgentForegroundProcess = { executableName: options.foregroundExecutable, arguments: options.arguments };
  const lookup = (handle: AgentFileHandle): Uint8Array => files.get(handle.id) ?? new Uint8Array();
  return {
    terminal: { id: "fixture-terminal" } as unknown as AgentTerminalHandle,
    project: { id: "fixture-project" } as unknown as AgentProjectHandle,
    environment: { id: "fixture-environment" } as any, process, foreground, tty: options.tty,
    capabilities: new Set(options.capabilities ?? ["process-observation", "filesystem-observation", "agent-journal"]), signal: notCancelled,
    async bindSession(request: AgentSessionBindingRequest): Promise<AgentSessionBinding> { return { providerSessionId: request.providerSessionId, mappingVersion: request.mappingVersion, journal: request.journal } as unknown as AgentSessionBinding; },
    observation: {
      processes: {
        async descendants(): Promise<AgentProcessSnapshot[]> { return [{ handle: process, executableName: foreground.executableName, cwd: options.cwd, pid: options.pid ?? 4242 }]; },
        async openFiles(): Promise<any[]> { return [...files.keys()].map((path) => ({ handle: fileHandle(path), path, access: "writable" })); },
        async environment(names: readonly string[]): Promise<Record<string, string>> {
          const values = options.environment ?? {};
          return Object.fromEntries(names.flatMap((name) => values[name] === undefined ? [] : [[name, values[name]] as const]));
        },
      },
      files: {
        async resolveHomeDirectory(relativePath: string) {
          const root = `/home/test/${relativePath.replace(/\/$/, "")}`;
          return [...files.keys()].some((path) => path.startsWith(`${root}/`)) ? directoryHandle(root) : undefined;
        },
        async resolveDirectoryRelativeToEnvironment(relativePath: string, request: { environmentVariable: string }) {
          const environmentRoot = options.environment?.[request.environmentVariable]?.replace(/\/$/, "");
          const root = environmentRoot ? `${environmentRoot}/${relativePath.replace(/\/$/, "")}` : undefined;
          return root && [...files.keys()].some((path) => path.startsWith(`${root}/`)) ? directoryHandle(root) : undefined;
        },
        async listDirectory(root: import("./types.js").AgentDirectoryHandle, request: import("./types.js").AgentDirectoryListOptions) {
          const prefix = `${root.id.replace(/\/$/, "")}/`;
          let bytes = 0; let truncated = false;
          const entries: import("./types.js").AgentDiscoveredFile[] = [];
          for (const path of [...files.keys()].sort()) {
            const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
            if (!relativePath || relativePath.split("/").length - 1 > request.maxDepth || !request.extensions.some((extension) => relativePath.endsWith(extension))) continue;
            const data = files.get(path)!;
            if (entries.length >= request.maxEntries || bytes + data.byteLength > request.maxBytes) { truncated = true; break; }
            bytes += data.byteLength; entries.push({ handle: fileHandle(path), relativePath, size: data.byteLength });
          }
          return { entries, truncated };
        },
        async watchDirectory(root: import("./types.js").AgentDirectoryHandle, request: import("./types.js").AgentDirectoryListOptions) {
          const prefix = `${root.id.replace(/\/$/, "")}/`; let bytes = 0;
          const entries: import("./types.js").AgentDiscoveredFile[] = [];
          for (const path of [...files.keys()].sort()) {
            const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
            if (!relativePath || relativePath.split("/").length - 1 > request.maxDepth || !request.extensions.some((extension) => relativePath.endsWith(extension))) continue;
            const data = files.get(path)!; if (entries.length >= request.maxEntries || bytes + data.byteLength > request.maxBytes) break;
            bytes += data.byteLength; entries.push({ handle: fileHandle(path), relativePath, size: data.byteLength });
          }
          const snapshot = { entries, truncated: entries.length >= request.maxEntries };
          return { async *[Symbol.asyncIterator]() { yield snapshot; }, dispose(): void {} };
        },
        async resolveRelativeToEnvironment(relativePath: string, request: { environmentVariable: string }) {
          const root = request.environmentVariable && options.environment?.[request.environmentVariable];
          const exact = root === undefined ? undefined : `${root.replace(/\/$/, "")}/${relativePath}`;
          return exact !== undefined && files.has(exact) ? fileHandle(exact) : undefined;
        },
        async resolvePathUnderEnvironment(providerPath: string, request: { environmentVariable: string; beneathRelative?: string }) {
          const root = request.environmentVariable && options.environment?.[request.environmentVariable];
          const prefix = root === undefined ? undefined : `${root.replace(/\/$/, "")}/${request.beneathRelative ? `${request.beneathRelative}/` : ""}`;
          return prefix !== undefined && providerPath.startsWith(prefix) && files.has(providerPath) ? fileHandle(providerPath) : undefined;
        },
        async environmentRelativePath(handle: AgentFileHandle, request: { environmentVariable: string; beneathRelative?: string }) {
          const root = request.environmentVariable && options.environment?.[request.environmentVariable];
          const prefix = root === undefined ? undefined : `${root.replace(/\/$/, "")}/${request.beneathRelative ? `${request.beneathRelative}/` : ""}`;
          return prefix !== undefined && handle.id.startsWith(prefix) && files.has(handle.id) ? handle.id.slice(prefix.length) : undefined;
        },
        async resolveHomeRelative(relativePath: string) {
          const exact = `/home/test/${relativePath}`;
          return files.has(exact) ? fileHandle(exact) : files.has(relativePath) ? fileHandle(relativePath) : undefined;
        },
        async resolvePathUnderHome(providerPath: string, options: { beneath: { homeRelative: string } }) {
          const allowedPrefix = `/home/test/${options.beneath.homeRelative}/`;
          return providerPath.startsWith(allowedPrefix) && files.has(providerPath) ? fileHandle(providerPath) : undefined;
        },
        async homeRelativePath(handle: AgentFileHandle, options: { beneath: { homeRelative: string } }) {
          const allowedPrefix = `/home/test/${options.beneath.homeRelative}/`;
          return handle.id.startsWith(allowedPrefix) && files.has(handle.id) ? handle.id.slice(allowedPrefix.length) : undefined;
        },
        async canonicalFile(handle: AgentFileHandle) { return files.has(handle.id) ? handle : undefined; },
        async realpath(handle: AgentFileHandle) { return files.has(handle.id) ? handle : undefined; },
        async stat(handle: AgentFileHandle) { return files.has(handle.id) ? { handle, kind: "file" as const, size: lookup(handle).byteLength } : undefined; },
        async read(handle: AgentFileHandle, request: { maxBytes: number }) { return lookup(handle).slice(0, request.maxBytes); },
        async readJson<T>(handle: AgentFileHandle, request: { maxBytes: number }): Promise<T | undefined> { try { return JSON.parse(new TextDecoder().decode(lookup(handle).slice(0, request.maxBytes))) as T; } catch { return undefined; } },
        async readJsonLine<T>(handle: AgentFileHandle, request: { maxBytes: number; position: "first" | "last" }): Promise<T | undefined> { const lines = new TextDecoder().decode(lookup(handle).slice(0, request.maxBytes)).split("\n").filter(Boolean); try { return JSON.parse(request.position === "first" ? lines[0]! : lines.at(-1)!) as T; } catch { return undefined; } },
        async follow(handle: AgentFileHandle): Promise<AgentFileWatcher> { const bytes = lookup(handle).slice(); return { async *[Symbol.asyncIterator]() { if (bytes.byteLength) yield { type: "append" as const, bytes }; }, dispose(): void {} }; },
      },
    },
  };
}

export interface AgentExtensionHarness { observe(terminal: AgentTerminalContext): Promise<void>; events(): readonly AgentLifecycleEvent[]; dispose(): Promise<void>; }

/** Activates an extension in-memory and captures its validated lifecycle events. */
export async function createAgentExtensionHarness(extension: TerminayExtension): Promise<AgentExtensionHarness> {
  const registrations = new Map<string, AgentProviderRuntime>(); const subscriptions: AgentProviderRegistration[] = [];
  const context: ExtensionContext = { extensionId: "test.extension", apiVersion: EXTENSION_API_VERSION, paths: { configuration: "/fixture/config", data: "/fixture/data", cache: "/fixture/cache" }, registerProjectEnvironmentProvider(): void {}, agents: { registerProvider(providerId, runtime) { if (registrations.has(providerId)) throw new Error(`Duplicate agent provider: ${providerId}`); registrations.set(providerId, runtime); return { providerId, dispose(): void { registrations.delete(providerId); } }; } }, subscriptions: { add(subscription) { subscriptions.push(subscription as AgentProviderRegistration); return subscription; } } };
  await extension.activate(context); const emitted: AgentLifecycleEvent[] = [];
  return { async observe(terminal) { for (const runtime of registrations.values()) { if (!runtime.matchesForeground(terminal.foreground)) continue; const result = await runtime.observe(terminal); if (result.state !== "bound" || !("source" in result)) continue; const publish = fixturePublisher(emitted); await replaySource(result.source, { binding: result.binding, journal: { role: "root" }, publish, signal: terminal.signal }, result.mapRecord); for (const child of result.childSources ?? []) await replaySource(child.source, { binding: result.binding, journal: { role: "child", childId: child.childId }, publish, signal: terminal.signal }, result.mapRecord); const discovery = result.childSourceDiscovery === undefined ? undefined : await Promise.resolve(result.childSourceDiscovery); if (discovery) for await (const child of discovery) await replaySource(child.source, { binding: result.binding, journal: { role: "child", childId: child.childId }, publish, signal: terminal.signal }, result.mapRecord); } }, events: () => emitted.slice(), async dispose() { for (const subscription of subscriptions) await subscription.dispose(); await extension.deactivate?.(); } };
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
function fixturePublisher(events: AgentLifecycleEvent[]): AgentLifecyclePublisher { return createAgentLifecyclePublisher((event) => { events.push(event); }); }
