import { ProfileStore } from "./store.js";
import { HostTrustManager } from "./trust.js";
import { ConnectionPool } from "./pool.js";
import { RemoteTerminalManager } from "./terminal.js";
import { SftpFilesystem } from "./filesystem.js";
import { profileForm } from "./forms.js";
import { EXTENSION_ID, PROVIDER_ID } from "./constants.js";
import { SshProviderError } from "./errors.js";
import { parseProfileInput } from "./validation.js";
import { ManagedBindingService } from "./managedBindings.js";
export { ManagedBindingService } from "./managedBindings.js";
import type { PublicProfile, ProfileStore as ProfileStoreType } from "./store.js";
import type { AuthenticationBroker } from "./transport.js";
import type {
  EnvironmentCreateRequest,
  EnvironmentRuntimeRequest,
  EnvironmentServiceRequest,
  ExtensionContext,
  InvokeEnvironmentActionRequest,
  JsonValue,
  ProfileValuesRequest,
  ProgressPresentation,
  ProviderCallContext,
  ProviderEnvironmentStatus,
  ProviderRuntime,
  ResolveOptionsRequest,
  ResumeOperationRequest,
} from "@terminay/extension-api";

type Values = Record<string, JsonValue>;
type UnknownRecord = Record<string, unknown>;
interface ProviderState extends Record<string, JsonValue> {
  profileId: string; profileRevision: number; host: string; port: number; username: string;
  root: string; environmentRevision: number; trustChallenge: JsonValue; deleted: boolean;
}
interface RuntimeDependencies {
  store: ProfileStoreType; trust: HostTrustManager; pool: ConnectionPool; filesystem: SftpFilesystem;
}
interface ActiveRuntime extends RuntimeDependencies { terminals: RemoteTerminalManager }
interface TestInput { profileId: string; revision: number; authBroker?: AuthenticationBroker }
interface ProgressStage { id: string; state: "pending" | "active" | "complete" | "failed" }

let activeRuntime: ActiveRuntime | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
  if (context.extensionId !== EXTENSION_ID) throw new Error("SSH extension identity mismatch");
  const store = await new ProfileStore(context.paths.configuration, context.paths.data).load();
  const trust = new HostTrustManager(store); const pool = new ConnectionPool({ store, trust });
  const terminals = new RemoteTerminalManager(pool); const filesystem = new SftpFilesystem(pool);
  activeRuntime = { store, trust, pool, terminals, filesystem };
  const runtime = createProviderRuntime({ store, trust, pool, filesystem });
  const managedBindings = await new ManagedBindingService(context.paths.data, store, runtime).load();
  context.registerProjectEnvironmentProvider({
    definition: { providerId: PROVIDER_ID, displayName: "SSH server", description: "Open a POSIX project through SSH from this Terminay Server.", icon: "server", capabilities: ["terminal", "filesystem", "agent-journal"], profileForm },
    runtime,
    dependencyOperations: managedBindings.handler(),
  });
}

export async function deactivate(): Promise<void> { if (!activeRuntime) return; activeRuntime.terminals.close(); await activeRuntime.pool.close(); activeRuntime = undefined; }

export function createProviderRuntime({ store, trust, pool, filesystem }: RuntimeDependencies): ProviderRuntime { return {
  async testProfile(request: ProfileValuesRequest, call: ProviderCallContext) {
    try {
      const snapshot = request.profileId ? await call.profiles.get(request.profileId) : undefined;
      const values = snapshot?.values ?? profileValues(request); const saved = request.profileId ? tryGet(store, request.profileId) : undefined;
      const input = toProfileInput(values, request.profileId ?? `test-${Date.now()}`, saved?.revision, snapshot?.secretFields);
      parseProfileInput(input);
      const current = saved ?? await store.save(input, "terminay-server");
      await testProfile(store, pool, filesystem, { profileId: current.id, revision: current.revision, authBroker: authBroker(call) }, asAbortSignal(call.signal)); return [];
    } catch (error) { return [{ code: errorCode(error), message: errorMessage(error, "SSH profile validation failed") }]; }
  },
  async resolveOptions(request: ResolveOptionsRequest) {
    if (request.sourceId !== "remote-directories") return { options: [] };
    const rawState = request.values.providerState; if (rawState === undefined) return { options: [] }; const state = parseState(rawState);
    const result = await filesystem.browse({ profileId: state.profileId, revision: state.profileRevision, root: state.root, path: request.query || state.root });
    return { options: result.entries.filter((entry) => entry.type === "directory").slice(0, 200).map((entry) => ({ value: entry.path, label: entry.name })) };
  },
  async createEnvironment(request: EnvironmentCreateRequest, call: ProviderCallContext) {
    const snapshot = request.profileId ? await call.profiles.get(request.profileId) : undefined;
    const existing = snapshot ? tryGet(store, snapshot.profileId) : undefined;
    const input = toProfileInput(snapshot?.values ?? profileValues(request), request.profileId ?? request.environmentId, existing?.revision, snapshot?.secretFields);
    if (input.hostVerification === "unsafe") throw new SshProviderError("permission-denied", "Unsafe verification requires a separate confirmed action");
    const saved = await store.save(input, "terminay-server");
    try {
      const resolved = await filesystem.resolveRoot({ profileId: saved.id, revision: saved.revision, root: saved.defaultRoot, authBroker: authBroker(call) }, asAbortSignal(call.signal));
      const providerState = stateFor(saved, resolved.root);
      return { state: "ready", providerState, status: availableStatus(providerState, 1) };
    } catch (error) {
      if (errorCode(error) !== "host-key-approval-required" && errorCode(error) !== "host-key-mismatch") throw error;
      const providerState = stateFor(saved, saved.defaultRoot); providerState.trustChallenge = jsonDetails(error);
      const operationId = `ssh-trust:${saved.id}:${saved.revision}`;
      return { state: "pending", operationId, providerState, progress: trustProgress(error, operationId), pollAfterMs: 30_000 };
    }
  },
  async resumeOperation(request: ResumeOperationRequest, call: ProviderCallContext) {
    const state = parseState(request.providerState);
    try { const resolved = await filesystem.resolveRoot({ profileId: state.profileId, revision: state.profileRevision, root: state.root, authBroker: authBroker(call) }, asAbortSignal(call.signal)); const ready = { ...state, root: resolved.root, trustChallenge: null }; return { state: "ready", providerState: ready, status: availableStatus(ready, ready.environmentRevision) }; }
    catch (error) { if (errorCode(error) !== "host-key-approval-required" && errorCode(error) !== "host-key-mismatch") throw error; const pending = { ...state, trustChallenge: jsonDetails(error) }; return { state: "pending", operationId: request.operationId, providerState: pending, progress: trustProgress(error, request.operationId), pollAfterMs: 30_000 }; }
  },
  async getStatus(request: EnvironmentRuntimeRequest) {
    const state = parseState(request.providerState); const connection = pool.status(state.profileId, state.profileRevision);
    return connection.status === "ready" ? availableStatus(state, state.environmentRevision) : { state: connection.status === "connecting" || connection.status === "reconnecting" ? "connecting" : "unavailable", message: `SSH connection is ${connection.status}.`, defaultRoot: state.root, revision: state.environmentRevision, card: statusCard(state, connection.status) };
  },
  async invokeAction(request: InvokeEnvironmentActionRequest, call: ProviderCallContext) {
    const state = parseState(request.providerState); const values = request.values ?? {};
    if (request.actionId === "retry") { const lease = await pool.acquire(state.profileId, state.profileRevision, { signal: asAbortSignal(call.signal), broker: authBroker(call) }); lease.release(); }
    else if (request.actionId === "trust-host") await trust.approve({ profileId: state.profileId, expectedRevision: state.profileRevision, challengeId: requiredValue(values, "challengeId"), action: "approve" }, "terminay-server");
    else if (request.actionId === "replace-host-key") await trust.approve({ profileId: state.profileId, expectedRevision: state.profileRevision, challengeId: requiredValue(values, "challengeId"), action: "replace" }, "terminay-server");
    else if (request.actionId === "enable-unsafe") await trust.confirmUnsafe({ profileId: state.profileId, expectedRevision: state.profileRevision, confirmation: requiredValue(values, "confirmation") }, "terminay-server");
    else if (request.actionId === "restore-strict") await trust.restoreStrict({ profileId: state.profileId, expectedRevision: state.profileRevision }, "terminay-server");
    else throw new SshProviderError("unsupported", "SSH environment action is unsupported");
    const nextProfile = store.get(state.profileId); const nextState = stateFor(nextProfile, state.root, state.environmentRevision + 1);
    return { state: "complete", providerState: nextState, status: availableStatus(nextState, nextState.environmentRevision) };
  },
  async invokeService(request: EnvironmentServiceRequest, call: ProviderCallContext) {
    const state = parseState(request.providerState);
    if (request.environmentRevision !== state.environmentRevision) throw new SshProviderError("conflict", "SSH environment revision changed");
    const runtime = activeRuntime;
    if (!runtime) throw new SshProviderError("unreachable", "SSH extension runtime is unavailable");
    const input = serviceInput(request.input, state, authBroker(call));
    if (request.operation === "read") {
      const limit = request.capability === "terminal" ? 262_144 : 512 * 1024;
      const requested = input.maxBytes ?? input.length;
      if (requested !== undefined && (!Number.isInteger(requested) || Number(requested) < 0 || Number(requested) > limit)) throw new SshProviderError("invalid-input", "SSH read exceeds the service transport limit");
    }
    const signal = asAbortSignal(call.signal);
    if (request.capability === "terminal") {
      if (request.operation === "create") return serviceJson(await runtime.terminals.create(input as never, signal));
      if (request.operation === "input") return serviceJson(runtime.terminals.input(input as never));
      if (request.operation === "resize") return serviceJson(runtime.terminals.resize(input as never));
      if (request.operation === "read") return serviceJson(runtime.terminals.read(input as never));
      if (request.operation === "kill") return serviceJson(runtime.terminals.kill(input as never));
      if (request.operation === "dispose") return serviceJson(runtime.terminals.dispose(input as never));
    }
    if (request.capability === "filesystem") {
      if (request.operation === "resolveRoot") return serviceJson(await runtime.filesystem.resolveRoot(input as never, signal));
      if (request.operation === "browse") return serviceJson(await runtime.filesystem.browse(input as never, signal));
      if (request.operation === "realpath") return serviceJson(await runtime.filesystem.realpath(input as never, signal));
      if (request.operation === "stat") return serviceJson(await runtime.filesystem.stat(input as never, signal));
      if (request.operation === "list") return serviceJson(await runtime.filesystem.list(input as never, signal));
      if (request.operation === "read") return serviceJson(await runtime.filesystem.read(input as never, signal));
      if (request.operation === "write") return serviceJson(await runtime.filesystem.write(input as never, signal));
      if (request.operation === "createDirectory") return serviceJson(await runtime.filesystem.createDirectory(input as never, signal));
      if (request.operation === "rename") return serviceJson(await runtime.filesystem.rename(input as never, signal));
      if (request.operation === "remove") return serviceJson(await runtime.filesystem.remove(input as never, signal));
    }
    if(request.capability==="agent-journal"&&request.operation==="observe")return serviceJson(await runtime.terminals.observeJournal(input as never,signal));
    throw new SshProviderError("unsupported", `SSH ${request.capability} operation is unavailable`);
  },
  async updateEnvironment(request: EnvironmentRuntimeRequest & { values: Values }, call: ProviderCallContext) {
    const state = parseState(request.providerState); const saved = await store.save(toProfileInput(request.values, state.profileId, call.expectedRevision ?? state.profileRevision), "terminay-server"); const resolved = await filesystem.resolveRoot({ profileId: saved.id, revision: saved.revision, root: saved.defaultRoot, authBroker: authBroker(call) }, asAbortSignal(call.signal)); const next = stateFor(saved, resolved.root, state.environmentRevision + 1); return { state: "complete", providerState: next, status: availableStatus(next, next.environmentRevision) };
  },
  async deleteEnvironment(request: EnvironmentRuntimeRequest) { const state = parseState(request.providerState); await store.remove(state.profileId, state.profileRevision, "terminay-server"); const next = { ...state, deleted: true, environmentRevision: state.environmentRevision + 1 }; return { state: "complete", providerState: next, status: { state: "deleting", revision: next.environmentRevision } }; }
}; }

function serviceInput(value: JsonValue, state: ProviderState, broker: AuthenticationBroker): Record<string, unknown> {
  if (!isRecord(value)) throw new SshProviderError("invalid-input", "SSH service input must be an object");
  return { ...value, profileId: state.profileId, revision: state.profileRevision, root: state.root, authBroker: broker };
}
function serviceJson(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }


async function testProfile(store: ProfileStoreType, pool: ConnectionPool, filesystem: SftpFilesystem, input: TestInput, signal: AbortSignal) {
  const profileId = requiredString(input, "profileId"), revision = requiredRevision(input);
  const stages: ProgressStage[] = ["resolving-host", "connecting", "verifying-identity", "authenticating", "discovering-home-shell", "ready"].map((id) => ({ id, state: "pending" }));
  try {
    stages[0].state = "complete"; stages[1].state = "active";
    const lease = await pool.acquire(profileId, revision, { signal, broker: input.authBroker }); lease.release();
    stages[1].state = stages[2].state = stages[3].state = "complete"; stages[4].state = "active";
    const profile = store.get(profileId, revision); const root = await filesystem.resolveRoot({ profileId, revision, root: profile.defaultRoot, authBroker: input.authBroker }, signal);
    stages[4].state = "complete"; stages[5].state = "complete";
    return { status: "ready", stages, root: root.root };
  } catch (error) { const active = stages.find((stage) => stage.state === "active"); if (active) active.state = "failed"; if (error instanceof SshProviderError) error.details = { ...(error.details ?? {}), stages }; throw error; }
}
async function validateConnection(filesystem: SftpFilesystem, input: Parameters<SftpFilesystem["resolveRoot"]>[0], signal?: AbortSignal) { const root = await filesystem.resolveRoot(input, signal); return { ready: true, canonicalRoot: root.root, providerId: PROVIDER_ID }; }
function requiredString(input: unknown, key: string): string { const record = asRecord(input); const value = record[key]; if (typeof value !== "string" || !value || value.length > 200) throw new SshProviderError("invalid-input", `Invalid ${key}`); return value; }
function requiredRevision(input: unknown): number { const value = asRecord(input).revision; if (!Number.isInteger(value) || (value as number) < 1) throw new SshProviderError("invalid-input", "Invalid revision"); return value as number; }
function optionalRevision(input: unknown): number | undefined { return asRecord(input).revision === undefined ? undefined : requiredRevision(input); }
function safeProfile(profile: ReturnType<ProfileStoreType["get"]>) { return { id: profile.id, revision: profile.revision, displayName: profile.displayName, hostname: profile.hostname, port: profile.port, username: profile.username, authMode: profile.auth.mode, defaultRoot: profile.defaultRoot, hostVerification: profile.hostVerification, status: profile.status, lastSuccessAt: profile.lastSuccessAt }; }
function profileValues(request: ProfileValuesRequest): Values { if (!request.values || typeof request.values !== "object") throw new SshProviderError("invalid-input", "SSH profile values are required"); return request.values; }
function toProfileInput(values: Values, id: string, expectedRevision?: number, secretFields: string[] = []) { const authValue = isRecord(values.auth) ? values.auth : {}; const authMode = values["auth-mode"] ?? values.authMode ?? authValue.mode; const auth = authMode === "agent" ? { mode: "agent" } : authMode === "password" ? { mode: "password", passwordSecretRef: values.passwordSecretRef ?? authValue.passwordSecretRef ?? (secretFields.includes("password") ? "password" : undefined) } : { mode: "private-key", privateKeySecretRef: values.privateKeySecretRef ?? authValue.privateKeySecretRef ?? (secretFields.includes("private-key") ? "private-key" : undefined), ...(values.passphraseSecretRef ?? authValue.passphraseSecretRef ?? (secretFields.includes("passphrase") ? "passphrase" : undefined) ? { passphraseSecretRef: values.passphraseSecretRef ?? authValue.passphraseSecretRef ?? "passphrase" } : {}) }; return { id, expectedRevision, displayName: values["display-name"] ?? values.displayName, hostname: values.hostname, port: values.port ?? 22, username: values.username, auth, defaultRoot: values["default-root"] ?? values.defaultRoot ?? "~", hostVerification: values.hostVerification ?? "strict", timeouts: values.timeouts ?? { connectMs: values["connect-ms"] ?? values.connectMs, handshakeMs: values["handshake-ms"] ?? values.handshakeMs, keepaliveMs: values["keepalive-ms"] ?? values.keepaliveMs } }; }
function stateFor(profile: Pick<PublicProfile, "id" | "revision" | "hostname" | "port" | "username">, root: string, environmentRevision = 1): ProviderState { return { profileId: profile.id, profileRevision: profile.revision, host: profile.hostname, port: profile.port, username: profile.username, root, environmentRevision, trustChallenge: null, deleted: false }; }
function parseState(value: JsonValue): ProviderState { if (!isRecord(value) || typeof value.profileId !== "string" || !Number.isInteger(value.profileRevision) || typeof value.host !== "string" || typeof value.port !== "number" || typeof value.username !== "string" || typeof value.root !== "string" || !Number.isInteger(value.environmentRevision)) throw new SshProviderError("invalid-input", "SSH provider state is invalid"); return value as ProviderState; }
function availableStatus(state: ProviderState, revision: number): ProviderEnvironmentStatus { return { state: "available", defaultRoot: state.root, revision, card: statusCard(state, "ready") }; }
function statusCard(state: ProviderState, status: string): NonNullable<ProviderEnvironmentStatus["card"]> { return { id: "ssh-status", title: `${state.username}@${state.host}`, summary: status === "ready" ? "SSH server is ready." : `SSH server is ${status}.`, icon: "server", tone: status === "ready" ? "positive" : "warning", facts: [{ label: "Root", value: state.root }], actions: status === "ready" ? [] : [{ id: "retry", label: "Retry", kind: "primary" }] }; }
function requiredValue(values: Values, key: string): string { const value = values[key]; if (typeof value !== "string" || !value) throw new SshProviderError("invalid-input", `Missing ${key}`); return value; }
function authBroker(call: ProviderCallContext): AuthenticationBroker { if (!call.secrets?.withValue || !call.sshAgent?.listIdentities || !call.sshAgent?.sign) throw new SshProviderError("authentication-failed", "Terminay authentication broker is unavailable"); return { secrets: call.secrets, sshAgent: call.sshAgent }; }
function tryGet(store: ProfileStoreType, profileId: string) { try { return store.get(profileId); } catch (error) { if (errorCode(error) === "profile-not-found") return undefined; throw error; } }
function trustProgress(error: unknown, operationId: string): ProgressPresentation { const details = asRecord(errorDetails(error)); return { operationId, title: "Verify SSH server identity", resumable: true, stages: [{ id: "connect", label: "Connecting", state: "complete" }, { id: "trust", label: errorCode(error) === "host-key-mismatch" ? "Replace trusted host key" : "Approve host key", state: "active", detail: `${String(details.algorithm ?? "unknown")} ${String(details.fingerprint ?? "unknown")}` }, { id: "root", label: "Validate project root", state: "pending" }] }; }
function isRecord(value: unknown): value is UnknownRecord { return !!value && typeof value === "object" && !Array.isArray(value); }
function asRecord(value: unknown): UnknownRecord { return isRecord(value) ? value : {}; }
function errorCode(error: unknown): string { return typeof asRecord(error).code === "string" ? asRecord(error).code as string : "invalid-input"; }
function errorMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function errorDetails(error: unknown): unknown { return asRecord(error).details; }
function jsonDetails(error: unknown): JsonValue { const details = errorDetails(error); return isJsonValue(details) ? details : {}; }
function isJsonValue(value: unknown): value is JsonValue { if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true; if (Array.isArray(value)) return value.every(isJsonValue); return isRecord(value) && Object.values(value).every(isJsonValue); }
function asAbortSignal(signal: ProviderCallContext["signal"]): AbortSignal { if (!("addEventListener" in signal) || typeof signal.addEventListener !== "function") throw new SshProviderError("cancelled", "Provider cancellation signal is unavailable"); return signal as AbortSignal; }

export default { activate, deactivate };
export { EXTENSION_ID, PROVIDER_ID, ProfileStore, HostTrustManager, ConnectionPool, RemoteTerminalManager, SftpFilesystem, SshProviderError, profileForm };
