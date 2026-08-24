import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProviderVaultPutRequest, ProviderVaultPutResult, ProviderVaultRemoveRequest, ProviderVaultRemoveResult, ProviderVaultWithSecretRequest } from "@terminay/extension-api";
import type { ServerVaultService } from "../settings/vault.js";

interface BindingRecord { bindingRef: string; bindingKey: string; purpose: string; secretId: string; revision: number; pending: boolean }
interface ScopeFile { version: 1; bindings: BindingRecord[] }
interface ScopeState { readonly file: string; loaded: boolean; records: Map<string, BindingRecord>; keys: Map<string, string>; leases: Map<string, number>; idempotency: Map<string, unknown>; mutation: Promise<void> }

export interface ProviderVaultPrincipal { readonly extensionId: string; readonly providerId: string; readonly dataDirectory: string }

/** Host-private target vault. Public bindings are opaque installation/provider
 * scoped references; only the selected encrypted Server vault sees secret ids. */
export class ExtensionProviderVault {
  private readonly scopes = new Map<string, ScopeState>();
  constructor(private readonly vault: ServerVaultService) {}

  async put(principal: ProviderVaultPrincipal, request: ProviderVaultPutRequest, signal: AbortSignal): Promise<ProviderVaultPutResult> {
    const state = await this.scope(principal); this.available(signal);
    const replay = state.idempotency.get(`put:${request.idempotencyKey}`);
    if (replay !== undefined) { request.value.fill(0); return structuredClone(replay) as ProviderVaultPutResult; }
    const existingRef = state.keys.get(request.bindingKey); const existing = existingRef === undefined ? undefined : state.records.get(existingRef);
    if (request.expectedRevision !== undefined && request.expectedRevision !== existing?.revision) { request.value.fill(0); throw new Error("provider vault revision conflict"); }
    const bindingRef = existing?.bindingRef ?? `pvb_${randomBytes(24).toString("base64url")}`;
    const secretId = existing?.secretId ?? this.secretId(principal, bindingRef);
    const value = new Uint8Array(request.value);
    try {
      if (existing === undefined) await this.vault.put({ id: secretId, label: "Extension private credential", value });
      else await this.vault.replace({ id: secretId, label: "Extension private credential", value });
    } finally { value.fill(0); request.value.fill(0); }
    this.available(signal);
    const record: BindingRecord = { bindingRef, bindingKey: request.bindingKey, purpose: request.purpose, secretId, revision: (existing?.revision ?? 0) + 1, pending: false };
    state.records.set(bindingRef, record); state.keys.set(record.bindingKey, bindingRef);
    await this.persist(state);
    const result = Object.freeze({ binding: Object.freeze({ bindingRef }), revision: record.revision });
    this.remember(state, `put:${request.idempotencyKey}`, result); return result;
  }

  async withSecret<T>(principal: ProviderVaultPrincipal, request: ProviderVaultWithSecretRequest, signal: AbortSignal, use: (copy: Uint8Array) => T | Promise<T>): Promise<T> {
    const state = await this.scope(principal); this.available(signal);
    const record = state.records.get(request.binding.bindingRef);
    if (record === undefined || record.pending || record.purpose !== request.purpose) throw new Error("provider vault binding unavailable");
    state.leases.set(record.bindingRef, (state.leases.get(record.bindingRef) ?? 0) + 1);
    try {
      return await this.vault.withSecret(record.secretId, async (secret) => {
        this.available(signal); const copy = new Uint8Array(secret);
        try { return await use(copy); } finally { copy.fill(0); }
      });
    } finally {
      const remaining = (state.leases.get(record.bindingRef) ?? 1) - 1;
      if (remaining <= 0) state.leases.delete(record.bindingRef); else state.leases.set(record.bindingRef, remaining);
      if (remaining <= 0 && record.pending) await this.finishRemove(state, record);
    }
  }

  async remove(principal: ProviderVaultPrincipal, request: ProviderVaultRemoveRequest, signal: AbortSignal): Promise<ProviderVaultRemoveResult> {
    const state = await this.scope(principal); this.available(signal);
    const replay = state.idempotency.get(`remove:${request.idempotencyKey}`);
    if (replay !== undefined) return structuredClone(replay) as ProviderVaultRemoveResult;
    const record = state.records.get(request.binding.bindingRef);
    if (record === undefined) throw new Error("provider vault binding unavailable");
    if (request.expectedRevision !== undefined && request.expectedRevision !== record.revision) throw new Error("provider vault revision conflict");
    record.pending = true; await this.persist(state);
    const pending = (state.leases.get(record.bindingRef) ?? 0) > 0;
    if (!pending) await this.finishRemove(state, record);
    const result = Object.freeze({ state: pending ? "pending" as const : "deleted" as const });
    this.remember(state, `remove:${request.idempotencyKey}`, result); return result;
  }

  /** Drops transient leases after a child crash/disable/update. Durable bindings
   * remain available when that installation/provider is activated again. */
  async cleanup(principal: ProviderVaultPrincipal): Promise<void> {
    const state = await this.scope(principal); state.leases.clear();
    for (const record of [...state.records.values()]) if (record.pending) await this.finishRemove(state, record);
  }

  private async scope(principal: ProviderVaultPrincipal): Promise<ScopeState> {
    const key = `${principal.extensionId}\0${principal.providerId}\0${principal.dataDirectory}`;
    let state = this.scopes.get(key);
    if (state === undefined) {
      const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
      state = { file: join(principal.dataDirectory, "provider-vault", `${digest}.json`), loaded: false, records: new Map(), keys: new Map(), leases: new Map(), idempotency: new Map(), mutation: Promise.resolve() };
      this.scopes.set(key, state);
    }
    if (!state.loaded) {
      state.loaded = true;
      try {
        const parsed = JSON.parse(await readFile(state.file, "utf8")) as ScopeFile;
        if (parsed.version !== 1 || !Array.isArray(parsed.bindings)) throw new Error("invalid provider vault metadata");
        for (const item of parsed.bindings) if (validRecord(item)) { state.records.set(item.bindingRef, item); state.keys.set(item.bindingKey, item.bindingRef); }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return state;
  }

  private async finishRemove(state: ScopeState, record: BindingRecord): Promise<void> {
    await this.vault.remove(record.secretId); state.records.delete(record.bindingRef); state.keys.delete(record.bindingKey); await this.persist(state);
  }
  private persist(state: ScopeState): Promise<void> {
    const action = state.mutation.then(async () => { await mkdir(dirname(state.file), { recursive: true }); const temporary = `${state.file}.tmp`; await writeFile(temporary, `${JSON.stringify({ version: 1, bindings: [...state.records.values()] } satisfies ScopeFile)}\n`, { mode: 0o600 }); await rename(temporary, state.file); });
    state.mutation = action.catch(() => undefined); return action;
  }
  private remember(state: ScopeState, key: string, result: unknown): void { if (state.idempotency.size >= 256) state.idempotency.delete(state.idempotency.keys().next().value!); state.idempotency.set(key, structuredClone(result)); }
  private secretId(principal: ProviderVaultPrincipal, bindingRef: string): string { return `extpv:${createHash("sha256").update(`${principal.extensionId}\0${principal.providerId}\0${principal.dataDirectory}\0${bindingRef}`).digest("hex")}`; }
  private available(signal: AbortSignal): void { if (signal.aborted) throw new Error("provider dependency call cancelled"); }
}

function validRecord(value: unknown): value is BindingRecord {
  if (typeof value !== "object" || value === null) return false; const item = value as Partial<BindingRecord>;
  return typeof item.bindingRef === "string" && /^pvb_[A-Za-z0-9_-]{20,100}$/u.test(item.bindingRef) && typeof item.bindingKey === "string" && typeof item.purpose === "string" && typeof item.secretId === "string" && Number.isSafeInteger(item.revision) && Number(item.revision) > 0 && typeof item.pending === "boolean";
}
