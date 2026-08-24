import { pathToFileURL } from "node:url";
import { EXTENSION_API_VERSION, validateAgentChildJournalSources, validateAgentProviderDefinition } from "@terminay/extension-api";
import { EXTENSION_HOST_PROTOCOL_VERSION, frameByteLength, type HostFrame, type ChildFrame } from "./protocol.js";

const MAX_MESSAGE_BYTES = 256 * 1024;
const invocations = new Map<string, AbortController>();
const brokerCalls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let deactivate: (() => unknown | Promise<unknown>) | undefined;
let callbacks: Record<string, (input: unknown, context: { signal: AbortSignal }) => unknown | Promise<unknown>> = {};
const providerRuntimes = new Map<string, Record<string, unknown>>();
const dependencyRuntimes = new Map<string, { call(request: unknown, context: unknown): Promise<unknown> }>();
const agentRuntimes = new Map<string, Record<string, unknown>>();
const agentTerminals = new Map<string, { readonly providerId: string; readonly controller: AbortController; readonly context: Record<string, unknown> }>();
let subscriptions: Array<{ dispose(): unknown | Promise<unknown> }> = [];
let sequence = 0;

process.on("message", (message: unknown) => { void receive(message); });
process.on("disconnect", () => process.exit(0));
process.on("uncaughtException", () => process.exit(70));
process.on("unhandledRejection", () => process.exit(71));

async function receive(message: unknown): Promise<void> {
  if (!isHostFrame(message) || frameByteLength(message) > MAX_MESSAGE_BYTES) process.exit(72);
  if (message.kind === "cancel") { invocations.get(message.id)?.abort(); return; }
  if (message.kind === "broker.result") {
    const pending = brokerCalls.get(message.id); if (pending === undefined) return;
    brokerCalls.delete(message.id);
    const payload = object(message.payload);
    payload?.ok === true ? pending.resolve(payload.value) : pending.reject(new Error(typeof payload?.failure === "string" ? payload.failure : "broker request failed"));
    return;
  }
  if (message.kind === "agent.observation.result") {
    const pending = brokerCalls.get(message.id); if (pending === undefined) return;
    brokerCalls.delete(message.id);
    const payload = object(message.payload);
    payload?.ok === true ? pending.resolve(payload.value) : pending.reject(new Error(typeof payload?.failure === "string" ? payload.failure : "agent observation failed"));
    return;
  }
  if (message.kind === "agent.lifecycle.ack") {
    const pending = brokerCalls.get(message.id); if (pending === undefined) return;
    brokerCalls.delete(message.id);
    const payload = object(message.payload);
    payload?.acceptedEventCount !== undefined ? pending.resolve(payload) : pending.reject(new Error(typeof payload?.failure === "string" ? payload.failure : "agent lifecycle publication rejected"));
    return;
  }
  if (message.kind === "agent.lifecycle.backpressure") return;
  if (message.kind === "activate") { await activateExtension(message); return; }
  if (message.kind === "deactivate") {
    for (const controller of invocations.values()) controller.abort();
    for (const terminal of agentTerminals.values()) terminal.controller.abort();
    agentTerminals.clear();
    try {
      try { await deactivate?.(); }
      finally { await disposeSubscriptions(); }
      send({ protocolVersion: 1, kind: "deactivated", id: message.id });
    }
    catch (error) { failure(message.id, error); }
    return;
  }
  if (message.kind === "invoke") await invoke(message);
  if (message.kind === "agent.terminal.admit") await admitAgentTerminal(message);
  if (message.kind === "agent.terminal.cancel") await cancelAgentTerminal(message);
  if (message.kind === "agent.drain") await drainAgentTerminals(message);
}

async function activateExtension(frame: HostFrame): Promise<void> {
  try {
    const payload = object(frame.payload);
    if (typeof payload?.entrypoint !== "string" || typeof payload.extensionId !== "string") throw new Error("invalid activation payload");
    const imported = await import(pathToFileURL(payload.entrypoint).href);
    const extension = object(imported.default);
    const activate = extension?.activate ?? imported.activate ?? imported.default;
    if (typeof activate !== "function") throw new Error("extension must export activate(context)");
    const providers: unknown[] = [];
    const agentProviders: string[] = [];
    providerRuntimes.clear();
    dependencyRuntimes.clear();
    agentRuntimes.clear();
    subscriptions = [];
    for (const terminal of agentTerminals.values()) terminal.controller.abort();
    agentTerminals.clear();
    const declaredAgentProviders = new Set(Array.isArray(payload.agentProviders)
      ? payload.agentProviders.map((entry) => object(entry)?.id).filter((id): id is string => typeof id === "string")
      : []);
    const result = await activate(Object.freeze({
      extensionId: payload.extensionId,
      apiVersion: typeof payload.apiVersion === "string" ? payload.apiVersion : EXTENSION_API_VERSION,
      paths: Object.freeze({ configuration: payload.configDirectory, data: payload.dataDirectory, cache: payload.cacheDirectory }),
      registerProjectEnvironmentProvider(registration: unknown) {
        const value = object(registration);
        const definition = object(value?.definition) ?? value;
        const runtime = object(value?.runtime);
        if (definition === undefined) throw new Error("invalid provider registration");
        providers.push(structuredClone(definition));
        if (runtime !== undefined && typeof definition.providerId === "string") providerRuntimes.set(definition.providerId, runtime);
        const dependencyOperations = object(value?.dependencyOperations);
        if (dependencyOperations !== undefined && typeof dependencyOperations.call === "function" && typeof definition.providerId === "string") dependencyRuntimes.set(definition.providerId, dependencyOperations as unknown as { call(request: unknown, context: unknown): Promise<unknown> });
      },
      agents: Object.freeze({
        registerProvider(providerId: string, runtime: unknown) {
          if (typeof providerId !== "string" || !declaredAgentProviders.has(providerId) || agentRuntimes.has(providerId) || !validateAgentProviderDefinition(runtime).ok) {
            throw new Error("agent provider registration is undeclared or invalid");
          }
          agentRuntimes.set(providerId, runtime as Record<string, unknown>);
          agentProviders.push(providerId);
          let disposed = false;
          return Object.freeze({ providerId, dispose() {
            if (disposed) return;
            disposed = true;
            agentRuntimes.delete(providerId);
            for (const [contextId, terminal] of agentTerminals) {
              if (terminal.providerId !== providerId) continue;
              terminal.controller.abort(); agentTerminals.delete(contextId);
            }
            send({ protocolVersion: 1, kind: "agent.provider.disposed", id: `agent-dispose:${++sequence}`, payload: { providerId } });
          }});
        },
      }),
      subscriptions: Object.freeze({
        add(subscription: unknown) {
          const value = object(subscription);
          if (value === undefined || typeof value.dispose !== "function") throw new Error("extension subscription must be disposable");
          subscriptions.push(value as { dispose(): unknown | Promise<unknown> });
          return subscription;
        },
      }),
      // Private broker capabilities are host-injected. They are deliberately
      // not application protocol handlers or raw transports.
      directories: Object.freeze({ config: payload.configDirectory, data: payload.dataDirectory, cache: payload.cacheDirectory }),
      permissions: Object.freeze(Array.isArray(payload.permissions) ? [...payload.permissions] : []),
      broker: Object.freeze({ request: brokerRequest }),
    }));
    const definition = object(result) ?? {};
    const methods = object(definition.methods) ?? {};
    callbacks = {};
    for (const [name, callback] of Object.entries(methods)) {
      if (typeof callback !== "function" || name.length === 0 || name.length > 200) throw new Error("extension returned an invalid method definition");
      callbacks[name] = callback as typeof callbacks[string];
    }
    callbacks["provider.invoke"] = invokeProvider;
    callbacks["dependency.invoke"] = invokeDependency;
    if (definition.deactivate !== undefined && typeof definition.deactivate !== "function") throw new Error("extension returned an invalid deactivate callback");
    deactivate = (extension?.deactivate ?? definition.deactivate) as typeof deactivate;
    send({ protocolVersion: 1, kind: "ready", id: frame.id, payload: { methods: Object.keys(callbacks).sort(), providers, agentProviders, dependencyProviders: [...dependencyRuntimes.keys()].sort() } });
  } catch (error) { failure(frame.id, error); }
}

async function disposeSubscriptions(): Promise<void> {
  const owned = subscriptions;
  subscriptions = [];
  for (const subscription of owned.reverse()) await subscription.dispose();
}

async function admitAgentTerminal(frame: HostFrame): Promise<void> {
  const payload = object(frame.payload);
  const context = object(payload?.context);
  const providerId = typeof context?.providerId === "string" ? context.providerId : "";
  const contextId = typeof context?.contextId === "string" ? context.contextId : "";
  const runtime = agentRuntimes.get(providerId);
  if (!context || !contextId || !runtime || typeof runtime.observe !== "function" || agentTerminals.has(contextId)) {
    failure(frame.id, new Error("agent terminal admission is invalid")); return;
  }
  const controller = new AbortController();
  const bridge = createAgentTerminalContext(context, Array.isArray(payload?.observationCapabilities) ? payload.observationCapabilities : [], controller.signal);
  agentTerminals.set(contextId, { providerId, controller, context });
  try {
    const result = await (runtime.observe as (value: unknown) => Promise<unknown>).call(runtime, bridge.terminal);
    void consumeAgentSession(result, bridge.publisher, controller.signal);
    const state = object(result)?.state;
    if (!send({ protocolVersion: 1, kind: "agent.terminal.admitted", id: frame.id, payload: { contextId, state: typeof state === "string" ? state : "unknown" } })) process.exit(73);
  } catch (error) {
    agentTerminals.delete(contextId);
    failure(frame.id, error);
  }
}

async function cancelAgentTerminal(frame: HostFrame): Promise<void> {
  const payload = object(frame.payload); const contextId = typeof payload?.contextId === "string" ? payload.contextId : "";
  const terminal = agentTerminals.get(contextId);
  if (terminal === undefined) { if (!send({ protocolVersion: 1, kind: "agent.terminal.cancelled", id: frame.id, payload: { contextId, alreadyCancelled: true } })) process.exit(73); return; }
  terminal.controller.abort(); agentTerminals.delete(contextId);
  if (!send({ protocolVersion: 1, kind: "agent.terminal.cancelled", id: frame.id, payload: { contextId } })) process.exit(73);
}

async function drainAgentTerminals(frame: HostFrame): Promise<void> {
  for (const terminal of agentTerminals.values()) terminal.controller.abort();
  agentTerminals.clear();
  if (!send({ protocolVersion: 1, kind: "agent.drain.completed", id: frame.id, payload: { drained: true } })) process.exit(73);
}

function createAgentTerminalContext(context: Record<string, unknown>, capabilities: unknown[], signal: AbortSignal): { readonly terminal: Record<string, unknown>; readonly publisher: Record<string, (event: unknown) => Promise<unknown>> } {
  const contextId = String(context.contextId); const providerId = String(context.providerId);
  const request = (operation: string, payload: unknown) => agentRequest("agent.observation.request", {
    contextId, providerId, operation, payload,
  });
  const publish = (binding: unknown, events: unknown[]) => agentRequest("agent.lifecycle.publish", {
    contextId, providerId, publicationId: `${contextId}:${++sequence}`, mappingVersion: typeof binding === "object" && binding !== null && typeof (binding as Record<string, unknown>).mappingVersion === "string" ? (binding as Record<string, unknown>).mappingVersion : "0.1", binding, events,
  });
  const publisher = Object.freeze({
    publish(event: unknown) { return publish(undefined, [event]); },
    sessionStarted(event: unknown) { return publish(undefined, [{ kind: "session.started", ...(object(event) ?? {}) }]); },
    metadataChanged(event: unknown) { return publish(undefined, [{ kind: "agent.metadata", ...(object(event) ?? {}) }]); },
    turnStarted(event: unknown) { return publish(undefined, [{ kind: "turn.started", ...(object(event) ?? {}) }]); },
    toolStarted(event: unknown) { return publish(undefined, [{ kind: "tool.started", ...(object(event) ?? {}) }]); },
    toolFinished(event: unknown) { return publish(undefined, [{ kind: "tool.finished", ...(object(event) ?? {}) }]); },
    waitStarted(event: unknown) { return publish(undefined, [{ kind: "wait.started", ...(object(event) ?? {}) }]); },
    waitFinished(event: unknown) { return publish(undefined, [{ kind: "wait.finished", ...(object(event) ?? {}) }]); },
    done(event: unknown) { return publish(undefined, [{ kind: "agent.done", ...(object(event) ?? {}) }]); },
    exited(event: unknown) { return publish(undefined, [{ kind: "agent.exited", ...(object(event) ?? {}) }]); },
    subagentStarted(event: unknown) { return publish(undefined, [{ kind: "subagent.started", ...(object(event) ?? {}) }]); },
    subagentDone(event: unknown) { return publish(undefined, [{ kind: "subagent.done", ...(object(event) ?? {}) }]); },
  });
  const observation = Object.freeze({
    processes: Object.freeze({ descendants: (options: unknown = {}) => request("process.descendants", options), openFiles: (processes: unknown, options: unknown = {}) => request("process.open-files", { processes, options }), environment: (names: unknown, options: unknown = {}) => request("process.environment", { names, ...object(options) }) }),
    files: Object.freeze({
      resolveHomeDirectory: (relativePath: unknown, options: unknown = {}) => request("filesystem.resolve-home-directory", { relativePath, ...object(options) }),
      resolveDirectoryRelativeToEnvironment: (relativePath: unknown, options: unknown) => request("filesystem.resolve-directory-relative-to-environment", { relativePath, ...object(options) }),
      listDirectory: (root: unknown, options: unknown) => request("filesystem.list-directory", { root, options: object(options) }),
      watchDirectory: async (root: unknown, options: unknown) => pollingDirectoryWatcher(request, root, options, signal),
      resolveHomeRelative: (relativePath: unknown, options: unknown = {}) => request("filesystem.resolve-home-relative", { relativePath, ...object(options) }),
      resolvePathUnderHome: (providerPath: unknown, options: unknown) => request("filesystem.resolve-path-under-home", { providerPath, ...object(options) }),
      homeRelativePath: (handle: unknown, options: unknown) => request("filesystem.home-relative-path", { handle, ...object(options) }),
      resolveRelativeToEnvironment: (relativePath: unknown, options: unknown) => request("filesystem.resolve-relative-to-environment", { relativePath, ...object(options) }),
      resolvePathUnderEnvironment: (providerPath: unknown, options: unknown) => request("filesystem.resolve-path-under-environment", { providerPath, ...object(options) }),
      environmentRelativePath: (handle: unknown, options: unknown) => request("filesystem.environment-relative-path", { handle, ...object(options) }),
      canonicalFile: (handle: unknown, options: unknown = {}) => request("filesystem.realpath", { handle, options }),
      realpath: (handle: unknown, options: unknown = {}) => request("filesystem.realpath", { handle, options }),
      stat: (handle: unknown, options: unknown = {}) => request("filesystem.stat", { handle, options }),
      read: async (handle: unknown, options: unknown) => decodeAgentObservationBytes(await request("filesystem.read", { handle, options })),
      readJson: async (handle: unknown, options: unknown) => parseObservedJson(
        decodeAgentObservationBytes(await request("filesystem.read", { handle, options: { ...object(options), encoding: "json" } })),
      ),
      readJsonLine: async (handle: unknown, options: unknown) => parseObservedJsonLine(
        decodeAgentObservationBytes(await request("filesystem.read", { handle, options: { ...object(options), encoding: "jsonl" } })),
        object(options)?.position,
      ),
      follow: async (handle: unknown, options: unknown = {}) => pollingWatcher(request, handle, options, signal),
    }),
  });
  const terminal = Object.freeze({
    terminal: Object.freeze({ id: context.terminalSessionId }), project: Object.freeze({ id: context.projectId }), environment: Object.freeze({ id: context.projectEnvironmentId }), process: Object.freeze({ id: context.contextId }), foreground: Object.freeze({ executableName: "" }), capabilities: new Set(capabilities.filter((value): value is string => typeof value === "string")), observation, signal,
    async bindSession(binding: unknown) { await publish(binding, []); return Object.freeze(structuredClone(binding)); },
  });
  return Object.freeze({ terminal, publisher });
}

/** File bytes cross the host IPC as JSON-safe integer arrays. Keep that
 * transport detail inside the private bridge so public extension methods keep
 * their documented `Uint8Array` / parsed-JSON contracts. */
export function decodeAgentObservationBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.byteLength > 4 * 1024 * 1024) throw new Error("agent file observation exceeds its byte limit");
    return value;
  }
  if (Array.isArray(value) && value.length > 4 * 1024 * 1024) {
    throw new Error("agent file observation exceeds its byte limit");
  }
  if (!Array.isArray(value) || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error("agent file observation returned invalid bytes");
  }
  return new Uint8Array(value);
}

export function parseObservedJson(bytes: Uint8Array): unknown | undefined {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

export function parseObservedJsonLine(bytes: Uint8Array, position: unknown): unknown | undefined {
  const lines = new TextDecoder().decode(bytes).split("\n").filter(Boolean);
  const line = position === "last" ? lines.at(-1) : lines[0];
  if (!line) return undefined;
  try { return JSON.parse(line); } catch { return undefined; }
}

async function consumeAgentSession(result: unknown, publisher: Record<string, (event: unknown) => Promise<unknown>>, signal: AbortSignal): Promise<void> {
  const session = object(result);
  if (session?.state !== "bound" || typeof session.mapRecord !== "function" || !("source" in session) || !session.binding || typeof session.binding !== "object") return;
  const mapping = session.mapRecord as (record: unknown, context: unknown) => unknown | Promise<unknown>;
  let releaseRootFirstRecord: (() => void) | undefined;
  const rootFirstRecord = new Promise<void>((resolve) => { releaseRootFirstRecord = resolve; });
  const consume = async (sourceValue: unknown, journal: Record<string, unknown>): Promise<void> => {
    try {
    const source = await Promise.resolve(sourceValue) as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown>; dispose?: () => unknown | Promise<unknown> };
    if (typeof source?.[Symbol.asyncIterator] !== "function") return;
    for await (const chunk of source as AsyncIterable<unknown>) {
      if (signal.aborted) return;
      const bytes = object(chunk)?.bytes;
      if (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) continue;
      const text = new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as number[]));
      for (const line of text.split("\n")) {
        if (!line) continue;
        try { await mapping(JSON.parse(line), Object.freeze({ binding: session.binding, journal, publish: publisher, signal })); } catch { /* Provider parsing failures remain local. */ }
        if (journal.role === "root") releaseRootFirstRecord?.();
      }
    }
    await source.dispose?.();
    } catch { /* Observation disappearance/cancellation is provider-local fallback. */ }
    finally { if (journal.role === "root") releaseRootFirstRecord?.(); }
  };
  const childSources = Array.isArray(session.childSources) ? session.childSources : [];
  const consumedChildIds = new Set<string>();
  const consumeChild = (child: unknown): Promise<void> | undefined => {
    const source = object(child); const childId = typeof source?.childId === "string" ? source.childId : undefined;
    if (!childId || source === undefined || !("source" in source) || consumedChildIds.has(childId) || !validateAgentChildJournalSources([source]).ok) return undefined;
    consumedChildIds.add(childId);
    return consume(source.source, Object.freeze({ role: "child", childId }));
  };
  const root = consume(session.source, Object.freeze({ role: "root" }));
  // A child source cannot legitimately precede its owning root session. Wait
  // until the root mapper has seen its first journal record so concurrent
  // initial replay cannot race lifecycle validation in the host.
  const children = (async () => {
    await rootFirstRecord;
    const staticChildren = childSources.flatMap((child) => {
      const task = consumeChild(child); return task === undefined ? [] : [task];
    });
    const discovery = async (): Promise<void> => {
      const stream = session.childSourceDiscovery === undefined ? undefined : await Promise.resolve(session.childSourceDiscovery) as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> };
      if (!stream || typeof stream[Symbol.asyncIterator] !== "function") return;
      for await (const child of stream as AsyncIterable<unknown>) {
        if (signal.aborted) return;
        // Do not await the child stream: a long-lived JSONL watcher must not
        // block discovery of its siblings. The source has its own cancellation
        // path via the admitted terminal controller.
        void consumeChild(child);
      }
    };
    await Promise.all([...staticChildren, discovery()]);
  })();
  await Promise.all([root, children]);
}

async function pollingWatcher(request: (operation: string, payload: unknown) => Promise<unknown>, handle: unknown, options: unknown, signal: AbortSignal): Promise<{ [Symbol.asyncIterator](): AsyncIterator<unknown>; dispose(): Promise<void> }> {
  const opened = object(await request("filesystem.follow", { handle, options }));
  const watcherId = typeof opened?.watcherId === "string" ? opened.watcherId : undefined;
  if (!watcherId) throw new Error("agent file follow is unavailable");
  return Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
      while (!signal.aborted) {
        const next = object(await request("filesystem.follow", { watcherId }));
        const events = Array.isArray(next?.events) ? next.events : [];
        for (const event of events) yield event;
        if (next?.closed === true) return;
        if (events.length === 0) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    async dispose(): Promise<void> { await request("filesystem.unfollow", { watcherId }); },
  });
}

async function pollingDirectoryWatcher(request: (operation: string, payload: unknown) => Promise<unknown>, root: unknown, options: unknown, signal: AbortSignal): Promise<{ [Symbol.asyncIterator](): AsyncIterator<unknown>; dispose(): Promise<void> }> {
  const opened = object(await request("filesystem.watch-directory", { root, options: object(options) }));
  const watcherId = typeof opened?.watcherId === "string" ? opened.watcherId : undefined;
  if (!watcherId) throw new Error("agent directory watcher is unavailable");
  const initial = object(opened?.snapshot);
  return Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
      if (initial) yield initial;
      while (!signal.aborted) {
        const next = object(await request("filesystem.watch-directory", { watcherId }));
        const snapshot = object(next?.snapshot);
        if (snapshot) yield snapshot;
        if (next?.closed === true) return;
        if (!snapshot) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    async dispose(): Promise<void> { await request("filesystem.unwatch-directory", { watcherId }); },
  });
}

async function invokeProvider(input: unknown, invocationContext: { signal: AbortSignal }): Promise<unknown> {
  const payload = object(input);
  const providerId = typeof payload?.providerId === "string" ? payload.providerId : "";
  const callback = typeof payload?.method === "string" ? payload.method : "";
  const callId = typeof payload?.callId === "string" ? payload.callId : "";
  const runtime = providerRuntimes.get(providerId);
  const method = runtime?.[callback];
  if (typeof method !== "function") throw new Error("provider callback is unavailable");
  const deadlineAt = typeof payload?.deadlineAt === "string" ? payload.deadlineAt : "";
  if (!Number.isFinite(Date.parse(deadlineAt)) || Date.parse(deadlineAt) <= Date.now()) throw new Error("provider callback deadline expired");
  const context = Object.freeze({
    deadlineAt,
    signal: invocationContext.signal,
    ...(typeof payload?.idempotencyKey === "string" ? { idempotencyKey: payload.idempotencyKey } : {}),
    ...(Number.isSafeInteger(payload?.expectedRevision) ? { expectedRevision: payload?.expectedRevision } : {}),
    dependencies: Object.freeze({
      call(request: unknown, dependencyContext: unknown) {
        const requested = object(dependencyContext);
        const requestedDeadline = typeof requested?.deadlineAt === "string" ? requested.deadlineAt : deadlineAt;
        const boundedDeadline = Date.parse(requestedDeadline) < Date.parse(deadlineAt) ? requestedDeadline : deadlineAt;
        return brokerRequest("provider.call", { callerProviderId: providerId, request, context: {
          deadlineAt: boundedDeadline,
          ...(typeof requested?.idempotencyKey === "string" ? { idempotencyKey: requested.idempotencyKey } : {}),
          ...(Number.isSafeInteger(requested?.expectedRevision) ? { expectedRevision: requested?.expectedRevision } : {}),
        } }, invocationContext.signal);
      },
    }),
    profiles: Object.freeze({
      get(profileId: string) { return brokerRequest("profile.get", { providerId, profileId }); },
    }),
    secrets: Object.freeze({
      async withValue<T>(request: { profileId: string; fieldId: string; purpose: string }, use: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
        const raw = await brokerRequest("secret.resolve", request);
        if (!Array.isArray(raw) || raw.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error("secret broker returned invalid bytes");
        const secret = new Uint8Array(raw);
        try { return await use(secret); } finally { secret.fill(0); }
      },
    }),
    sshAgent: Object.freeze({
      listIdentities(request: { profileId: string; purpose: "ssh-user-authentication" }) { return brokerRequest("agent.list", request); },
      sign(request: { profileId: string; purpose: "ssh-user-authentication"; identityId: string; algorithm: string; challenge: Uint8Array }) { return brokerRequest("agent.sign", { ...request, challenge: [...request.challenge] }); },
    }),
  });
  const result = await (method as (request: unknown, context: unknown) => unknown).call(runtime, payload?.request, context);
  return { callId, ok: true, result };
}

async function invokeDependency(input: unknown, invocationContext: { signal: AbortSignal }): Promise<unknown> {
  const payload = object(input); const providerId = typeof payload?.providerId === "string" ? payload.providerId : "";
  const runtime = dependencyRuntimes.get(providerId); const callToken = typeof payload?.callToken === "string" ? payload.callToken : "";
  if (runtime === undefined || !callToken) throw new Error("dependency target is unavailable");
  const timing = object(payload?.context); const deadlineAt = typeof timing?.deadlineAt === "string" ? timing.deadlineAt : "";
  const vault = Object.freeze({
    put(request: unknown) { const value = object(request); const bytes = value?.value; return brokerRequest("vault.put", { callToken, request: { ...value, ...(bytes instanceof Uint8Array ? { value: [...bytes] } : {}) } }); },
    async withSecret<T>(request: unknown, use: (copy: Uint8Array) => T | Promise<T>): Promise<T> {
      if (typeof use !== "function") throw new Error("provider vault callback is required");
      const raw = await brokerRequest("vault.withSecret", { callToken, request });
      if (!Array.isArray(raw) || raw.length > 1024 * 1024 || raw.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error("provider vault returned invalid bytes");
      const copy = new Uint8Array(raw);
      try { return await use(copy); } finally { copy.fill(0); raw.fill(0); }
    },
    remove(request: unknown) { return brokerRequest("vault.remove", { callToken, request }); },
  });
  const context = Object.freeze({ deadlineAt, signal: invocationContext.signal, ...(typeof timing?.idempotencyKey === "string" ? { idempotencyKey: timing.idempotencyKey } : {}), ...(Number.isSafeInteger(timing?.expectedRevision) ? { expectedRevision: timing?.expectedRevision } : {}), vault });
  return runtime.call(payload?.request, context);
}

async function invoke(frame: HostFrame): Promise<void> {
  const payload = object(frame.payload);
  const method = typeof payload?.method === "string" ? callbacks[payload.method] : undefined;
  if (method === undefined) { failure(frame.id, new Error("unknown extension method")); return; }
  const controller = new AbortController(); invocations.set(frame.id, controller);
  try {
    const result = await method(payload?.input, { signal: controller.signal });
    if (!send({ protocolVersion: 1, kind: "result", id: frame.id, payload: result })) process.exit(73);
  }
  catch (error) { failure(frame.id, error); }
  finally { invocations.delete(frame.id); }
}

function brokerRequest(operation: "log" | "secret.resolve" | "profile.get" | "agent.list" | "agent.sign" | "provider.call" | "vault.put" | "vault.withSecret" | "vault.remove", payload: unknown, signal?: AbortSignal): Promise<unknown> {
  if (operation !== "log" && operation !== "secret.resolve" && operation !== "profile.get" && operation !== "agent.list" && operation !== "agent.sign" && operation !== "provider.call" && operation !== "vault.put" && operation !== "vault.withSecret" && operation !== "vault.remove") return Promise.reject(new Error("unsupported broker operation"));
  const id = `broker:${++sequence}`;
  return new Promise((resolve, reject) => {
    const abort = () => { brokerCalls.delete(id); send({ protocolVersion: 1, kind: "broker.cancel", id }); reject(new Error("broker request cancelled")); };
    if (signal?.aborted) { reject(new Error("broker request cancelled")); return; }
    signal?.addEventListener("abort", abort, { once:true });
    brokerCalls.set(id, { resolve: (value) => { signal?.removeEventListener("abort",abort); resolve(value); }, reject: (error) => { signal?.removeEventListener("abort",abort); reject(error); } });
    if (!send({ protocolVersion: 1, kind: "broker.request", id, payload: { operation, payload } })) {
      brokerCalls.delete(id); reject(new Error("broker IPC send failed"));
    }
  });
}

function agentRequest(kind: "agent.observation.request" | "agent.lifecycle.publish", payload: unknown): Promise<unknown> {
  const id = `agent:${++sequence}`;
  return new Promise((resolve, reject) => {
    brokerCalls.set(id, { resolve, reject });
    if (!send({ protocolVersion: 1, kind, id, payload })) {
      brokerCalls.delete(id); reject(new Error("agent IPC send failed"));
    }
  });
}

function send(frame: ChildFrame): boolean {
  if (frameByteLength(frame) > MAX_MESSAGE_BYTES || typeof process.send !== "function" || !process.connected) return false;
  try { return process.send(frame); } catch { return false; }
}

function failure(id: string, error: unknown): void { send({ protocolVersion: 1, kind: "failure", id, payload: { message: error instanceof Error ? error.message.slice(0, 1_000) : "extension operation failed" } }); }
function object(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function isHostFrame(value: unknown): value is HostFrame {
  const frame = object(value);
  return frame?.protocolVersion === EXTENSION_HOST_PROTOCOL_VERSION
    && typeof frame.id === "string" && frame.id.length > 0 && frame.id.length <= 200
    && (frame.kind === "activate" || frame.kind === "invoke" || frame.kind === "cancel" || frame.kind === "deactivate" || frame.kind === "broker.result"
      || frame.kind === "agent.terminal.admit" || frame.kind === "agent.terminal.cancel" || frame.kind === "agent.drain"
      || frame.kind === "agent.observation.result" || frame.kind === "agent.lifecycle.ack" || frame.kind === "agent.lifecycle.backpressure");
}
