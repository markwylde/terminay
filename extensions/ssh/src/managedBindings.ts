import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  JsonValue,
  ProviderCallContext,
  ProviderDependencyHandler,
  ProviderDependencyTargetContext,
  ProviderRuntime,
  ProviderVaultBinding,
} from "@terminay/extension-api";
import type { ProfileStore } from "./store.js";
import { SshProviderError } from "./errors.js";

const PUZED_EXTENSION_ID = "com.puzed.platform";
const PUZED_PROVIDER_ID = "com.puzed.platform/vm";
const PURPOSE = "ssh-private-key";

interface ManagedBinding {
  id: string;
  ownerProfileId: string;
  profileId: string;
  publicKey: string;
  vaultBinding: ProviderVaultBinding;
  vaultRevision: number;
  revision: number;
  profileRevision?: number;
  logicalHostIdentity: string;
  machineId?: string;
  host?: string;
  port?: number;
  username?: string;
  root?: string;
}

interface State {
  version: 1;
  bindings: Record<string, ManagedBinding>;
}

/** Public SSH dependency implementation. Puzed gets only public key and opaque
 * binding identity; vault references remain private to this extension. */
export class ManagedBindingService {
  readonly #file: string;
  readonly #profiles: ProfileStore;
  readonly #runtime: ProviderRuntime;
  #state: State = { version: 1, bindings: {} };
  #writes: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string, profiles: ProfileStore, runtime: ProviderRuntime) {
    this.#file = join(dataDirectory, "managed-bindings.v1.json");
    this.#profiles = profiles;
    this.#runtime = runtime;
  }

  async load(): Promise<this> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      if (!isState(parsed)) throw new Error("SSH managed-binding state is invalid");
      this.#state = parsed;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    return this;
  }

  handler(): ProviderDependencyHandler {
    return { call: (request, context) => this.call(request.operation, request.payload, request.caller, context) };
  }

  private async call(operation: string, payload: JsonValue, caller: { extensionId: string; providerId: string }, context: ProviderDependencyTargetContext): Promise<JsonValue> {
    if (caller.extensionId !== PUZED_EXTENSION_ID || caller.providerId !== PUZED_PROVIDER_ID) throw new SshProviderError("permission-denied", "SSH managed bindings are unavailable to this caller");
    context.signal.throwIfAborted();
    if (operation === "managed-binding.generate") return this.generate(record(payload), context);
    if (operation === "managed-binding.bind" || operation === "managed-binding.update") return this.bind(record(payload), context);
    if (operation === "managed-binding.verify") return this.verify(record(payload), context);
    if (operation === "managed-binding.approve-trust") return this.approveTrust(record(payload), context);
    if (operation === "managed-binding.service") return this.service(record(payload), context);
    if (operation === "managed-binding.remove") return this.remove(record(payload), context);
    throw new SshProviderError("unsupported", "SSH managed-binding operation is unsupported");
  }

  private async generate(input: Record<string, unknown>, context: ProviderDependencyTargetContext): Promise<JsonValue> {
    const ownerProfileId = text(input.ownerProfileId, "ownerProfileId");
    const operationId = text(input.operationId, "operationId");
    const idempotencyKey = requiredIdempotency(context);
    const id = `puzed-ssh:${createHash("sha256").update(`${ownerProfileId}\0${operationId}`).digest("hex").slice(0, 32)}`;
    const existing = this.#state.bindings[id];
    if (existing) return { bindingId: id, publicKey: existing.publicKey };
    const logicalHostIdentity = optionalText(input.logicalHostIdentityHint) ?? `puzed:${ownerProfileId}:pending:${operationId}`;
    const generated = generateKeyPairSync("ed25519");
    const spki = generated.publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const pkcs8 = generated.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
    const comment = `terminay-puzed-ssh:${id}`;
    const privateKey = new Uint8Array(Buffer.from(opensshPrivateKey(spki, pkcs8, comment), "utf8"));
    const publicKey = opensshPublicKey(spki, comment);
    const stored = await context.vault.put({ bindingKey: id, purpose: PURPOSE, value: privateKey, idempotencyKey });
    privateKey.fill(0);
    const binding: ManagedBinding = { id, ownerProfileId, profileId: `managed:${id}`, publicKey, vaultBinding: stored.binding, vaultRevision: stored.revision, revision: 1, logicalHostIdentity };
    try { this.#state.bindings[id] = binding; await this.persist(); }
    catch (error) { delete this.#state.bindings[id]; await context.vault.remove({ binding: stored.binding, idempotencyKey: `${idempotencyKey}:rollback`, expectedRevision: stored.revision }).catch(() => undefined); throw error; }
    return { bindingId: id, publicKey };
  }

  private async bind(input: Record<string, unknown>, context: ProviderDependencyTargetContext): Promise<JsonValue> {
    const binding = this.binding(input);
    if (context.expectedRevision !== undefined && context.expectedRevision !== binding.revision) throw new SshProviderError("conflict", "SSH managed binding revision changed");
    const machineId = text(input.machineId, "machineId");
    const logicalHostIdentity = optionalText(input.logicalHostIdentity) ?? `puzed:${binding.ownerProfileId}:${machineId}`;
    const host = hostText(input.host); const port = integer(input.port ?? 22, "port", 1, 65535);
    const username = text(input.username, "username"); const root = optionalText(input.root) ?? "~";
    const prior = tryProfile(this.#profiles, binding.profileId);
    const saved = await this.#profiles.save({ id: binding.profileId, expectedRevision: prior?.revision, displayName: `Puzed ${machineId}`, hostname: host, port, username, auth: { mode: "private-key", privateKeySecretRef: "managed-vault" }, defaultRoot: root, logicalHostIdentity, hostVerification: "strict", timeouts: { connectMs: 15_000, handshakeMs: 15_000, keepaliveMs: 15_000 } }, "puzed-dependency");
    Object.assign(binding, { machineId, logicalHostIdentity, host, port, username, root, profileRevision: saved.revision, revision: binding.revision + 1 });
    await this.persist();
    return { bindingId: binding.id, revision: binding.revision, profileRevision: saved.revision, logicalHostIdentity };
  }

  private async verify(input: Record<string, unknown>, context: ProviderDependencyTargetContext): Promise<JsonValue> {
    const binding = this.binding(input); this.assertExpected(binding, context); this.assertReady(binding);
    if (!this.#runtime.invokeService) throw new SshProviderError("unsupported", "SSH services are unavailable");
    try {
      const resolved = await this.#runtime.invokeService({ ...environmentRequest(binding), capability: "filesystem", operation: "resolveRoot", projectId: `managed:${binding.id}`, environmentRevision: binding.revision, input: { root: binding.root! } }, targetCallContext(binding, context)) as Record<string, JsonValue>;
      return { state: "ready", bindingId: binding.id, revision: binding.revision, canonicalRoot: typeof resolved.root === "string" ? resolved.root : binding.root!, logicalHostIdentity: binding.logicalHostIdentity };
    } catch (error) {
      if (!(error instanceof SshProviderError) || !["host-key-approval-required", "host-key-mismatch"].includes(error.code)) throw error;
      const details = record(json(error.details ?? {}));
      return { state: "trust-required", bindingId: binding.id, revision: binding.revision, challengeId: typeof details.challengeId === "string" ? details.challengeId : "", fingerprint: typeof details.fingerprint === "string" ? details.fingerprint : "", algorithm: typeof details.algorithm === "string" ? details.algorithm : "unknown", changed: error.code === "host-key-mismatch" };
    }
  }

  private async approveTrust(input: Record<string, unknown>, context: ProviderDependencyTargetContext): Promise<JsonValue> {
    const binding = this.binding(input); this.assertExpected(binding, context); this.assertReady(binding);
    const action = input.action === "approve" ? "trust-host" : input.action === "replace" ? "replace-host-key" : undefined;
    if (!action) throw new SshProviderError("invalid-input", "SSH trust action is invalid");
    const result = await this.#runtime.invokeAction({ ...environmentRequest(binding), actionId: action, values: { challengeId: text(input.challengeId, "challengeId") } }, targetCallContext(binding, context));
    binding.revision++; await this.persist();
    return json(result.state === "complete"
      ? { bindingId: binding.id, revision: binding.revision, status: result.status }
      : { bindingId: binding.id, revision: binding.revision, state: "pending", operationId: result.operationId, progress: result.progress });
  }

  private async service(input: Record<string, unknown>, context: ProviderDependencyTargetContext): Promise<JsonValue> {
    const binding = this.binding(input); this.assertExpected(binding, context); this.assertReady(binding);
    const expectedRevision = integer(input.expectedRevision, "expectedRevision", 1, Number.MAX_SAFE_INTEGER);
    if (expectedRevision !== binding.revision) throw new SshProviderError("conflict", "SSH managed binding revision changed");
    if (!this.#runtime.invokeService) throw new SshProviderError("unsupported", "SSH services are unavailable");
    const capability = text(input.capability, "capability") as "terminal" | "filesystem" | "agent-journal";
    if (!["terminal", "filesystem", "agent-journal"].includes(capability)) throw new SshProviderError("unsupported", "SSH managed service capability is unavailable");
    return this.#runtime.invokeService({ ...environmentRequest(binding), capability, operation: text(input.operation, "operation"), projectId: text(input.projectId, "projectId"), environmentRevision: expectedRevision, input: json(input.input) }, targetCallContext(binding, context));
  }

  private async remove(input: Record<string, unknown>, context: ProviderDependencyTargetContext): Promise<JsonValue> {
    const binding = this.binding(input); this.assertExpected(binding, context); const idempotencyKey = requiredIdempotency(context);
    await context.vault.remove({ binding: binding.vaultBinding, idempotencyKey, expectedRevision: binding.vaultRevision });
    const profile = tryProfile(this.#profiles, binding.profileId); if (profile) await this.#profiles.remove(binding.profileId, profile.revision, "puzed-dependency");
    delete this.#state.bindings[binding.id]; await this.persist(); return { state: "deleted" };
  }

  private binding(input: Record<string, unknown>): ManagedBinding { const id = text(input.bindingId, "bindingId"); const value = this.#state.bindings[id]; if (!value) throw new SshProviderError("profile-not-found", "SSH managed binding was not found"); return value; }
  private assertExpected(binding: ManagedBinding, context: ProviderDependencyTargetContext): void { if (context.expectedRevision !== undefined && context.expectedRevision !== binding.revision) throw new SshProviderError("conflict", "SSH managed binding revision changed"); }
  private assertReady(binding: ManagedBinding): asserts binding is ManagedBinding & Required<Pick<ManagedBinding, "host" | "port" | "username" | "root">> { if (!binding.host || !binding.port || !binding.username || !binding.root) throw new SshProviderError("invalid-input", "SSH managed binding is not connected to a machine"); }
  private async persist(): Promise<void> { const value = JSON.stringify(this.#state, null, 2); this.#writes = this.#writes.then(async () => { await mkdir(dirname(this.#file), { recursive: true }); const temp = `${this.#file}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, value, { mode: 0o600 }); await rename(temp, this.#file); }); await this.#writes; }
}

function targetCallContext(binding: ManagedBinding, context: ProviderDependencyTargetContext): ProviderCallContext {
  return {
    ...context,
    dependencies: { call: async () => { throw new SshProviderError("unsupported", "Nested SSH provider dependencies are unavailable"); } },
    profiles: { get: async () => { throw new SshProviderError("unsupported", "Managed SSH profiles are extension-owned"); } },
    secrets: { withValue: (_request, use) => context.vault.withSecret({ binding: binding.vaultBinding, purpose: PURPOSE }, use) },
    sshAgent: { listIdentities: async () => [], sign: async () => { throw new SshProviderError("authentication-failed", "SSH agent is unavailable for a managed key"); } },
  };
}
function environmentRequest(binding: ManagedBinding) { if (!binding.profileRevision) throw new SshProviderError("invalid-input", "SSH managed binding has no profile"); return { environmentId: `managed:${binding.id}`, profileId: binding.profileId, providerState: { profileId: binding.profileId, profileRevision: binding.profileRevision, host: binding.host!, port: binding.port!, username: binding.username!, root: binding.root!, environmentRevision: binding.revision, trustChallenge: null, deleted: false } }; }
function tryProfile(store: ProfileStore, id: string) { try { return store.get(id); } catch { return undefined; } }
function requiredIdempotency(context: ProviderDependencyTargetContext): string { if (!context.idempotencyKey) throw new SshProviderError("invalid-input", "SSH managed binding mutation requires idempotency"); return context.idempotencyKey; }
function opensshPublicKey(spki: Buffer, comment: string): string { const key = spki.subarray(spki.length - 32); const part = (value: Buffer) => { const size = Buffer.alloc(4); size.writeUInt32BE(value.length); return Buffer.concat([size, value]); }; return `ssh-ed25519 ${Buffer.concat([part(Buffer.from("ssh-ed25519")), part(key)]).toString("base64")} ${comment}`; }
function opensshPrivateKey(spki: Buffer, pkcs8: Buffer, comment: string): string { const publicKey = spki.subarray(spki.length - 32); const seed = pkcs8.subarray(pkcs8.length - 32); const u32 = (value: number) => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return buffer; }; const part = (value: Buffer) => Buffer.concat([u32(value.length), value]); const type = Buffer.from("ssh-ed25519"); const publicBlob = Buffer.concat([part(type), part(publicKey)]); const check = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16); let privateBlob = Buffer.concat([u32(check), u32(check), part(type), part(publicKey), part(Buffer.concat([seed, publicKey])), part(Buffer.from(comment))]); privateBlob = Buffer.concat([privateBlob, Buffer.from(Array.from({ length: (8 - (privateBlob.length % 8)) % 8 || 8 }, (_, index) => index + 1))]); const body = Buffer.concat([Buffer.from("openssh-key-v1\0"), part(Buffer.from("none")), part(Buffer.from("none")), part(Buffer.alloc(0)), u32(1), part(publicBlob), part(privateBlob)]).toString("base64").match(/.{1,70}/gu)?.join("\n") ?? ""; return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`; }
function record(value: JsonValue): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new SshProviderError("invalid-input", "SSH managed-binding input must be an object"); return value; }
function json(value: unknown): JsonValue { if (value === undefined) return null; return JSON.parse(JSON.stringify(value)) as JsonValue; }
function text(value: unknown, name: string): string { if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) throw new SshProviderError("invalid-input", `Invalid ${name}`); return value; }
function optionalText(value: unknown): string | undefined { return value === undefined ? undefined : text(value, "value"); }
function hostText(value: unknown): string { const valueText = text(value, "host"); if (/\s|[/@]/u.test(valueText)) throw new SshProviderError("invalid-input", "Invalid host"); return valueText; }
function integer(value: unknown, name: string, min: number, max: number): number { if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new SshProviderError("invalid-input", `Invalid ${name}`); return Number(value); }
function isState(value: unknown): value is State { return !!value && typeof value === "object" && !Array.isArray(value) && (value as State).version === 1 && !!(value as State).bindings && typeof (value as State).bindings === "object"; }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
