import { pathToFileURL } from "node:url";
import { EXTENSION_HOST_PROTOCOL_VERSION, frameByteLength, type HostFrame, type ChildFrame } from "./protocol.js";

const MAX_MESSAGE_BYTES = 256 * 1024;
const invocations = new Map<string, AbortController>();
const brokerCalls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let deactivate: (() => unknown | Promise<unknown>) | undefined;
let callbacks: Record<string, (input: unknown, context: { signal: AbortSignal }) => unknown | Promise<unknown>> = {};
const providerRuntimes = new Map<string, Record<string, unknown>>();
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
  if (message.kind === "activate") { await activateExtension(message); return; }
  if (message.kind === "deactivate") {
    for (const controller of invocations.values()) controller.abort();
    try { await deactivate?.(); send({ protocolVersion: 1, kind: "deactivated", id: message.id }); }
    catch (error) { failure(message.id, error); }
    return;
  }
  if (message.kind === "invoke") await invoke(message);
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
    providerRuntimes.clear();
    const result = await activate(Object.freeze({
      extensionId: payload.extensionId,
      apiVersion: typeof payload.apiVersion === "string" ? payload.apiVersion : "1.0.0",
      paths: Object.freeze({ configuration: payload.configDirectory, data: payload.dataDirectory, cache: payload.cacheDirectory }),
      registerProjectEnvironmentProvider(registration: unknown) {
        const value = object(registration);
        const definition = object(value?.definition) ?? value;
        const runtime = object(value?.runtime);
        if (definition === undefined) throw new Error("invalid provider registration");
        providers.push(structuredClone(definition));
        if (runtime !== undefined && typeof definition.providerId === "string") providerRuntimes.set(definition.providerId, runtime);
      },
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
    if (definition.deactivate !== undefined && typeof definition.deactivate !== "function") throw new Error("extension returned an invalid deactivate callback");
    deactivate = (extension?.deactivate ?? definition.deactivate) as typeof deactivate;
    send({ protocolVersion: 1, kind: "ready", id: frame.id, payload: { methods: Object.keys(callbacks).sort(), providers } });
  } catch (error) { failure(frame.id, error); }
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
        return brokerRequest("provider.call", { request, context: dependencyContext });
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

function brokerRequest(operation: "log" | "secret.resolve" | "profile.get" | "agent.list" | "agent.sign" | "provider.call", payload: unknown): Promise<unknown> {
  if (operation !== "log" && operation !== "secret.resolve" && operation !== "profile.get" && operation !== "agent.list" && operation !== "agent.sign" && operation !== "provider.call") return Promise.reject(new Error("unsupported broker operation"));
  const id = `broker:${++sequence}`;
  return new Promise((resolve, reject) => {
    brokerCalls.set(id, { resolve, reject });
    if (!send({ protocolVersion: 1, kind: "broker.request", id, payload: { operation, payload } })) {
      brokerCalls.delete(id); reject(new Error("broker IPC send failed"));
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
    && (frame.kind === "activate" || frame.kind === "invoke" || frame.kind === "cancel" || frame.kind === "deactivate" || frame.kind === "broker.result");
}
