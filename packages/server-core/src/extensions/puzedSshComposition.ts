import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JsonValue, TerminayExtensionManifest } from "@terminay/extension-api";
import type { ExtensionBroker, ExtensionBrokerRequest } from "./types.js";

export const PUZED_EXTENSION_ID = "com.puzed.platform";
export const SSH_EXTENSION_ID = "com.terminay.ssh";
export const SSH_PROVIDER_ID = "com.terminay.ssh/connection";

export interface CompositionVault {
  put(input: { id: string; label?: string; value: Uint8Array }): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  bindSshSecret?(input: Readonly<{ profileId: string; fieldId: string; secretId: string }>): void;
  unbindSshSecret?(input: Readonly<{ profileId: string; fieldId: string }>): void;
}

export interface ComposedSshRuntime {
  createBinding(input: Readonly<{ bindingId: string; profileId: string; logicalHostIdentity: string; privateKeySecretId: string }>, signal: AbortSignal): Promise<{ revision: number }>;
  updateBinding(input: Readonly<{ bindingId: string; expectedRevision: number; logicalHostIdentity: string; host: string; port: number; username: string; root: string }>, signal: AbortSignal): Promise<{ revision: number }>;
  verifyBinding(input: Readonly<{ bindingId: string; expectedRevision: number }>, signal: AbortSignal): Promise<ComposedSshVerification>;
  approveTrust(input: Readonly<{ bindingId: string; expectedRevision: number; challengeId: string; action: "approve" | "replace" }>, signal: AbortSignal): Promise<{ revision: number }>;
  removeBinding(bindingId: string, signal: AbortSignal): Promise<void>;
}

export type ComposedSshVerification =
  | Readonly<{ state: "ready"; revision: number; canonicalRoot: string; logicalHostIdentity: string }>
  | Readonly<{ state: "trust-required"; revision: number; challengeId: string; algorithm: string; fingerprint: string; changed: boolean }>
  | Readonly<{ state: "unavailable"; revision: number; code: string; message: string; retryable: boolean }>;

export interface CanonicalProjectOpener {
  open(input: Readonly<{ environmentId: string; displayName: string; sshBindingId: string; sshRevision: number; canonicalRoot: string; puzedProfileId: string; machineId: string }>, signal: AbortSignal): Promise<{ projectId: string; environmentId: string }>;
}

export interface PuzedSshBindingRecord {
  readonly id: string;
  readonly puzedProfileId: string;
  readonly operationId: string;
  readonly machineId?: string;
  readonly logicalHostIdentity: string;
  readonly privateKeySecretId: string;
  readonly sshRevision: number;
  readonly revision: number;
  readonly address?: Readonly<{ host: string; port: number; username: string; root: string }>;
  readonly project?: Readonly<{ projectId: string; environmentId: string; canonicalRoot: string }>;
}

interface CompositionState { readonly schemaVersion: 1; readonly revision: number; readonly bindings: Record<string, PuzedSshBindingRecord>; readonly idempotency: Record<string, { digest: string; result: JsonValue }>; }

export interface CompositionStateBackend { load(): Promise<unknown | undefined>; commit(state: CompositionState): Promise<void>; }

export class FileCompositionStateBackend implements CompositionStateBackend {
  constructor(private readonly file: string) {}
  async load(): Promise<unknown | undefined> { try { return JSON.parse(await readFile(this.file, "utf8")); } catch (error) { if ((error as { code?: string }).code === "ENOENT") return undefined; throw error; } }
  async commit(state: CompositionState): Promise<void> { await mkdir(dirname(this.file), { recursive: true }); const temporary = `${this.file}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, this.file); }
}

export class PuzedSshCompositionService {
  private state: CompositionState | undefined;
  private writes = Promise.resolve();
  constructor(private readonly options: Readonly<{ backend: CompositionStateBackend; vault: CompositionVault; ssh: ComposedSshRuntime; projects: CanonicalProjectOpener }>) {}

  async generate(input: unknown, idempotencyKey: string, signal: AbortSignal): Promise<JsonValue> {
    const value = object(input); const profileId = text(value.puzedProfileId ?? value.profileId, "puzedProfileId"); const operationId = text(value.operationId, "operationId");
    const logicalHostIdentity = optionalText(value.logicalHostIdentityHint) ?? `puzed:${profileId}:pending:${operationId}`;
    let created: { bindingId: string; secretId: string } | undefined;
    try { return await this.idempotent(`generate:${idempotencyKey}`, { profileId, operationId, logicalHostIdentity }, async (state) => {
      const existing = Object.values(state.bindings).find((binding) => binding.puzedProfileId === profileId && binding.operationId === operationId);
      if (existing !== undefined) throw new Error("composition binding exists without an idempotency receipt");
      const bindingId = `puzed-ssh:${randomUUID()}`; const secretId = `extensions.ssh.composed.${randomUUID()}`;
      const pair = generateKeyPairSync("ed25519"); const publicDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer; const privateDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer; const privateBytes = new TextEncoder().encode(opensshEd25519Private(publicDer, privateDer, `terminay-${bindingId}`));
      try {
        await this.options.vault.put({ id: secretId, label: `Terminay Puzed SSH key ${bindingId}`, value: privateBytes });
        const sshProfileId = `composed:${bindingId}`; this.options.vault.bindSshSecret?.({ profileId: sshProfileId, fieldId: secretId, secretId }); created = { bindingId, secretId };
        await this.options.ssh.createBinding({ bindingId, profileId: sshProfileId, logicalHostIdentity, privateKeySecretId: secretId }, signal);
      } finally { privateBytes.fill(0); }
      const publicKey = opensshEd25519(publicDer, `terminay-${bindingId}`);
      state.bindings[bindingId] = { id: bindingId, puzedProfileId: profileId, operationId, logicalHostIdentity, privateKeySecretId: secretId, sshRevision: 1, revision: 1 };
      return { publicKey, sshBindingId: bindingId };
    }); } catch (error) { if (created !== undefined) { const profileId = `composed:${created.bindingId}`; this.options.vault.unbindSshSecret?.({ profileId, fieldId: created.secretId }); await Promise.allSettled([this.options.ssh.removeBinding(created.bindingId, signal), this.options.vault.remove(created.secretId)]); } throw error; }
  }

  async bindMachine(input: unknown, idempotencyKey: string, signal: AbortSignal): Promise<JsonValue> {
    const value = object(input); const bindingId = text(value.sshBindingId, "sshBindingId"); const machineId = text(value.machineId, "machineId"); const host = hostText(value.host); const port = integer(value.port ?? 22, "port", 1, 65535); const username = text(value.username, "username"); const root = optionalText(value.root ?? value.defaultRoot) ?? "~";
    return this.idempotent(`bind:${idempotencyKey}`, { bindingId, machineId, host, port, username, root }, async (state) => {
      const current = requiredBinding(state, bindingId); const logicalHostIdentity = `puzed:${current.puzedProfileId}:${machineId}`;
      if (current.machineId !== undefined && current.machineId !== machineId) throw new Error("SSH binding is already attached to another Puzed machine");
      const result = await this.options.ssh.updateBinding({ bindingId, expectedRevision: current.sshRevision, logicalHostIdentity, host, port, username, root }, signal);
      state.bindings[bindingId] = { ...current, machineId, logicalHostIdentity, address: { host, port, username, root }, sshRevision: result.revision, revision: current.revision + 1 };
      return { sshBindingId: bindingId, revision: result.revision, logicalHostIdentity };
    });
  }

  async verify(input: unknown, signal: AbortSignal): Promise<JsonValue> {
    const value = object(input); await this.ensureDescriptorBound(value, signal); const binding = requiredBinding(await this.load(), text(value.sshBindingId, "sshBindingId"));
    if (binding.machineId === undefined || binding.address === undefined) throw new Error("SSH binding has no Puzed machine address");
    const result = await this.options.ssh.verifyBinding({ bindingId: binding.id, expectedRevision: binding.sshRevision }, signal);
    if (result.state === "trust-required") return { state: "host-trust-required", fingerprint: result.fingerprint, challengeId: result.challengeId, algorithm: result.algorithm, changed: result.changed, revision: result.revision };
    return result as unknown as JsonValue;
  }

  async openProject(input: unknown, idempotencyKey: string, signal: AbortSignal): Promise<JsonValue> {
    const value = object(input); await this.ensureDescriptorBound(value, signal); const bindingId = text(value.sshBindingId, "sshBindingId"); const displayName = optionalText(value.displayName ?? value.name) ?? `Puzed ${text(value.logicalHostIdentity, "logicalHostIdentity").split(":").at(-1)}`;
    return this.idempotent(`open:${idempotencyKey}`, { bindingId, displayName }, async (state) => {
      const binding = requiredBinding(state, bindingId); if (binding.machineId === undefined) throw new Error("SSH binding has no Puzed machine");
      const verified = await this.options.ssh.verifyBinding({ bindingId, expectedRevision: binding.sshRevision }, signal);
      if (verified.state !== "ready") throw new CompositionNotReadyError(verified);
      const environmentId = `puzed:${binding.puzedProfileId}:${binding.machineId}`;
      const opened = await this.options.projects.open({ environmentId, displayName, sshBindingId: bindingId, sshRevision: verified.revision, canonicalRoot: verified.canonicalRoot, puzedProfileId: binding.puzedProfileId, machineId: binding.machineId }, signal);
      state.bindings[bindingId] = { ...binding, sshRevision: verified.revision, project: { ...opened, canonicalRoot: verified.canonicalRoot }, revision: binding.revision + 1 };
      return opened as unknown as JsonValue;
    });
  }

  async approveTrust(input: unknown, signal: AbortSignal): Promise<JsonValue> { const value = object(input); const bindingId = text(value.sshBindingId, "sshBindingId"); const binding = requiredBinding(await this.load(), bindingId); const expectedRevision = integer(value.expectedRevision, "expectedRevision", 1, Number.MAX_SAFE_INTEGER); if (expectedRevision !== binding.sshRevision) throw new Error("SSH trust revision changed"); const challengeId = text(value.challengeId, "challengeId"); const action = value.action === "approve" || value.action === "replace" ? value.action : (() => { throw new Error("SSH trust action is invalid"); })(); return this.options.ssh.approveTrust({ bindingId, expectedRevision, challengeId, action }, signal) as unknown as JsonValue; }

  async snapshot(): Promise<readonly PuzedSshBindingRecord[]> { return Object.values((await this.load()).bindings).map((value) => safeBinding(value)); }

  private async ensureDescriptorBound(value: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    if (value.host === undefined) return;
    const bindingId = text(value.sshBindingId, "sshBindingId"); const identity = text(value.logicalHostIdentity, "logicalHostIdentity"); const current = requiredBinding(await this.load(), bindingId);
    const prefix = `puzed:${current.puzedProfileId}:`; if (!identity.startsWith(prefix) || identity.length === prefix.length) throw new Error("logical Puzed host identity does not match the retained Platform profile");
    const machineId = identity.slice(prefix.length); const host = hostText(value.host); const port = integer(value.port ?? 22, "port", 1, 65535); const username = text(value.username, "username"); const root = optionalText(value.root ?? value.defaultRoot) ?? "~";
    if (current.machineId === machineId && current.address?.host === host && current.address.port === port && current.address.username === username && current.address.root === root) return;
    await this.bindMachine({ sshBindingId: bindingId, machineId, host, port, username, root }, `descriptor:${bindingId}:${hash({ machineId, host, port, username, root })}`, signal);
  }

  private async idempotent(key: string, request: unknown, work: (draft: { bindings: Record<string, PuzedSshBindingRecord>; idempotency: Record<string, { digest: string; result: JsonValue }> }) => Promise<JsonValue>): Promise<JsonValue> {
    const digest = hash(request); let output!: JsonValue;
    const next = this.writes.then(async () => { const state = await this.load(); const previous = state.idempotency[key]; if (previous !== undefined) { if (previous.digest !== digest) throw new Error("idempotency key was reused for another composition request"); output = structuredClone(previous.result); return; }
      const draft = { bindings: structuredClone(state.bindings), idempotency: structuredClone(state.idempotency) }; output = await work(draft); draft.idempotency[key] = { digest, result: structuredClone(output) }; const committed: CompositionState = { schemaVersion: 1, revision: state.revision + 1, ...draft }; await this.options.backend.commit(committed); this.state = committed; });
    this.writes = next.catch(() => undefined); await next; return output;
  }
  private async load(): Promise<CompositionState> { if (this.state !== undefined) return this.state; const raw = await this.options.backend.load(); this.state = validateState(raw); return this.state; }
}

export class PuzedSshCompositionBroker implements ExtensionBroker {
  private readonly manifests = new Map<string, TerminayExtensionManifest>();
  constructor(private readonly service: PuzedSshCompositionService) {}
  registerManifest(manifest: TerminayExtensionManifest): void { this.manifests.set(manifest.id, manifest); }
  async request(request: ExtensionBrokerRequest, signal: AbortSignal): Promise<unknown> {
    if (request.operation === "log") return undefined;
    if (request.operation !== "provider.call") throw new Error("extension broker capability is unavailable");
    this.authorize(request.extensionId); const envelope = object(request.payload); const dependency = object(envelope.request); const providerId = text(dependency.providerId, "providerId"); if (providerId !== SSH_PROVIDER_ID) throw new Error("provider dependency is not authorized");
    const context = object(envelope.context); const idempotencyKey = optionalText(context.idempotencyKey); const operation = text(dependency.operation, "operation");
    if (operation === "generate-dedicated-key") return this.service.generate(dependency.payload, requiredKey(idempotencyKey), signal);
    if (operation === "bind-machine" || operation === "update-binding") return this.service.bindMachine(dependency.payload, requiredKey(idempotencyKey), signal);
    if (operation === "verify") return this.service.verify(dependency.payload, signal);
    if (operation === "approve-trust") return this.service.approveTrust(dependency.payload, signal);
    if (operation === "open-project") return this.service.openProject(dependency.payload, requiredKey(idempotencyKey), signal);
    throw new Error("provider dependency operation is unsupported");
  }
  private authorize(extensionId: string): void { if (extensionId !== PUZED_EXTENSION_ID) throw new Error("provider dependency caller is not authorized"); const manifest = this.manifests.get(extensionId); const dependency = manifest?.extensionDependencies?.find((item) => item.extensionId === SSH_EXTENSION_ID && item.optional !== true); if (dependency === undefined) throw new Error("required SSH extension dependency is not declared"); }
}

/** Shared embedded/standalone construction seam. Hosts supply their real vault,
 * SSH provider adapter, and canonical project transaction; storage and broker
 * behavior remain identical in both server modes. */
export function createPuzedSshCompositionBroker(options: Readonly<{ dataRoot: string; vault: CompositionVault; ssh: ComposedSshRuntime; projects: CanonicalProjectOpener }>): Readonly<{ service: PuzedSshCompositionService; broker: PuzedSshCompositionBroker }> {
  const backend = new FileCompositionStateBackend(join(options.dataRoot, "extensions", "composition", "puzed-ssh.v1.json"));
  const service = new PuzedSshCompositionService({ backend, vault: options.vault, ssh: options.ssh, projects: options.projects });
  return Object.freeze({ service, broker: new PuzedSshCompositionBroker(service) });
}

export class CompositionNotReadyError extends Error { readonly code = "ssh-not-ready"; constructor(readonly status: Exclude<ComposedSshVerification, { state: "ready" }>) { super("SSH binding is not ready"); } }

function validateState(raw: unknown): CompositionState { if (raw === undefined) return { schemaVersion: 1, revision: 0, bindings: {}, idempotency: {} }; const value = object(raw); if (value.schemaVersion !== 1 || !Number.isInteger(value.revision) || typeof value.bindings !== "object" || value.bindings === null || Array.isArray(value.bindings) || typeof value.idempotency !== "object" || value.idempotency === null || Array.isArray(value.idempotency)) throw new Error("Puzed SSH composition state is invalid"); return structuredClone(value) as unknown as CompositionState; }
function requiredBinding(state: { bindings: Readonly<Record<string, PuzedSshBindingRecord>> }, id: string): PuzedSshBindingRecord { const value = state.bindings[id]; if (value === undefined) throw new Error("Puzed SSH binding was not found"); return value; }
function safeBinding(value: PuzedSshBindingRecord): PuzedSshBindingRecord { const { privateKeySecretId: _secret, ...safe } = value; return safe as PuzedSshBindingRecord; }
function opensshEd25519(spki: Buffer, comment: string): string { const key = spki.subarray(spki.length - 32); const name = Buffer.from("ssh-ed25519"); const part = (value: Buffer) => { const size = Buffer.from([(value.length >>> 24) & 255, (value.length >>> 16) & 255, (value.length >>> 8) & 255, value.length & 255]); return Buffer.concat([size, value]); }; return `ssh-ed25519 ${Buffer.concat([part(name), part(key)]).toString("base64")} ${comment}`; }
function opensshEd25519Private(spki: Buffer, pkcs8: Buffer, comment: string): string { const publicKey = spki.subarray(spki.length - 32); const seed = pkcs8.subarray(pkcs8.length - 32); const u32 = (value: number) => Buffer.from([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]); const part = (value: Buffer) => Buffer.concat([u32(value.length), value]); const type = Buffer.from("ssh-ed25519"); const publicBlob = Buffer.concat([part(type), part(publicKey)]); const checkValue = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16); let privateBlob = Buffer.concat([u32(checkValue), u32(checkValue), part(type), part(publicKey), part(Buffer.concat([seed, publicKey])), part(Buffer.from(comment))]); const padding = Buffer.from(Array.from({ length: (8 - (privateBlob.length % 8)) % 8 || 8 }, (_, index) => index + 1)); privateBlob = Buffer.concat([privateBlob, padding]); const body = Buffer.concat([Buffer.from("openssh-key-v1\0"), part(Buffer.from("none")), part(Buffer.from("none")), part(Buffer.alloc(0)), u32(1), part(publicBlob), part(privateBlob)]).toString("base64").match(/.{1,70}/g)?.join("\n") ?? ""; return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function object(value: unknown): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("provider dependency request is invalid"); return value as Record<string, unknown>; }
function text(value: unknown, field: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\0")) throw new Error(`${field} is invalid`); return value; }
function optionalText(value: unknown): string | undefined { return value === undefined ? undefined : text(value, "value"); }
function hostText(value: unknown): string { const host = text(value, "host"); if (/\s|[/@]/u.test(host)) throw new Error("host is invalid"); return host; }
function integer(value: unknown, field: string, min: number, max: number): number { if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${field} is invalid`); return Number(value); }
function requiredKey(value: string | undefined): string { if (value === undefined) throw new Error("idempotency key is required"); return value; }
