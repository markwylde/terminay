import { createJsonlRecordDecoder } from "./agent.js";
import type {
  AgentFileHandle, AgentFileWatcher, AgentForegroundProcess, AgentLifecycleEvent, AgentLifecyclePublisher,
  AgentObservationCapability, AgentProcessHandle, AgentProcessSnapshot, AgentProjectHandle, AgentProviderRegistration,
  AgentProviderRuntime, AgentRecordContext, AgentSessionBinding, AgentSessionBindingRequest, AgentTerminalContext,
  AgentTerminalHandle, AgentTerminalTtyFact, CancellationSignal, ExtensionContext, TerminayExtension,
} from "./types.js";

export interface FixtureTerminalOptions {
  foregroundExecutable: string;
  arguments?: string[];
  /** Safe PTY fact for testing terminal-scoped breadcrumb discovery. */
  tty?: AgentTerminalTtyFact;
  /** Bounded foreground/descendant CWD fact; never filesystem authority. */
  cwd?: string;
  /** Values exposed only through `processes.environment(requestedNames)`. */
  environment?: Record<string, string>;
  capabilities?: AgentObservationCapability[];
  files?: Record<string, unknown[]>;
}

const notCancelled: CancellationSignal = Object.freeze({ aborted: false, throwIfAborted(): void {} });

/** Creates one terminal-scoped in-memory observation context for public extension tests. */
export function fixtureTerminal(options: FixtureTerminalOptions): AgentTerminalContext {
  const files = new Map<string, Uint8Array>();
  for (const [path, records] of Object.entries(options.files ?? {})) files.set(path, new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "")));
  const fileHandle = (path: string): AgentFileHandle => ({ id: path } as unknown as AgentFileHandle);
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
        async descendants(): Promise<AgentProcessSnapshot[]> { return [{ handle: process, executableName: foreground.executableName, cwd: options.cwd }]; },
        async openFiles(): Promise<any[]> { return [...files.keys()].map((path) => ({ handle: fileHandle(path), path, access: "writable" })); },
        async environment(names: readonly string[]): Promise<Record<string, string>> {
          const values = options.environment ?? {};
          return Object.fromEntries(names.flatMap((name) => values[name] === undefined ? [] : [[name, values[name]] as const]));
        },
      },
      files: {
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
  const context: ExtensionContext = { extensionId: "test.extension", apiVersion: "1.1.0", paths: { configuration: "/fixture/config", data: "/fixture/data", cache: "/fixture/cache" }, registerProjectEnvironmentProvider(): void {}, agents: { registerProvider(providerId, runtime) { if (registrations.has(providerId)) throw new Error(`Duplicate agent provider: ${providerId}`); registrations.set(providerId, runtime); return { providerId, dispose(): void { registrations.delete(providerId); } }; } }, subscriptions: { add(subscription) { subscriptions.push(subscription as AgentProviderRegistration); return subscription; } } };
  await extension.activate(context); const emitted: AgentLifecycleEvent[] = [];
  return { async observe(terminal) { for (const runtime of registrations.values()) { if (!runtime.matchesForeground(terminal.foreground)) continue; const result = await runtime.observe(terminal); if (result.state !== "bound" || !("source" in result)) continue; const publish = fixturePublisher(emitted); await replaySource(result.source, { binding: result.binding, journal: { role: "root" }, publish, signal: terminal.signal }, result.mapRecord); for (const child of result.childSources ?? []) await replaySource(child.source, { binding: result.binding, journal: { role: "child", childId: child.childId }, publish, signal: terminal.signal }, result.mapRecord); } }, events: () => emitted.slice(), async dispose() { for (const subscription of subscriptions) await subscription.dispose(); await extension.deactivate?.(); } };
}
async function replaySource(source: AgentFileWatcher | Promise<AgentFileWatcher>, context: AgentRecordContext, mapRecord: (record: unknown, context: AgentRecordContext) => void | Promise<void>): Promise<void> { const watcher = await source; const decoder = createJsonlRecordDecoder(); try { for await (const chunk of watcher) for (const record of decoder.push(chunk.bytes, chunk.type !== "append")) await mapRecord(record, context); } finally { await watcher.dispose(); } }
function fixturePublisher(events: AgentLifecycleEvent[]): AgentLifecyclePublisher { const emit = (event: AgentLifecycleEvent): void => { events.push(event); }; return { publish: emit, sessionStarted: (event) => emit({ kind: "session.started", ...event }), metadataChanged: (event) => emit({ kind: "agent.metadata", ...event }), turnStarted: (event) => emit({ kind: "turn.started", ...event }), toolStarted: (event) => emit({ kind: "tool.started", ...event }), toolFinished: (event) => emit({ kind: "tool.finished", ...event }), waitStarted: (event) => emit({ kind: "wait.started", ...event }), waitFinished: (event) => emit({ kind: "wait.finished", ...event }), done: (event) => emit({ kind: "agent.done", ...event }), exited: (event) => emit({ kind: "agent.exited", ...event }), subagentStarted: (event) => emit({ kind: "subagent.started", ...event }), subagentDone: (event) => emit({ kind: "subagent.done", ...event }) }; }
