import type { ProtocolId } from "@terminay/protocol";
import {
  MAX_VAULT_SECRET_BYTES,
  ServerVaultService,
  type VaultStatus,
} from "./vault.js";

/** A legacy Electron safe-storage record. The ciphertext is never persisted by this coordinator. */
export interface EmbeddedVaultImportEntry {
  readonly id: ProtocolId;
  readonly label?: string;
  readonly encryptedValue: Uint8Array;
}

export interface EmbeddedVaultImportSource {
  readonly sourceId: string;
  readonly entries: readonly EmbeddedVaultImportEntry[];
}

/** Platform adapter implemented by the Electron host, not by server-core. */
export interface EmbeddedSafeStorageAdapter {
  readonly backend: "embedded-safe-storage";
  isAvailable(): boolean;
  decrypt(encryptedValue: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

/** Durable marker boundary. Implementations must persist only source metadata. */
export interface EmbeddedVaultImportLedger {
  isComplete(sourceId: string): boolean | Promise<boolean>;
  markComplete(sourceId: string): void | Promise<void>;
}

export interface EmbeddedVaultImportOptions {
  readonly maxEntries?: number;
  readonly maxCiphertextBytes?: number;
  readonly maxTotalCiphertextBytes?: number;
}

export interface EmbeddedVaultImportResult {
  readonly sourceId: string;
  readonly imported: number;
  readonly skippedExisting: number;
  readonly alreadyComplete: boolean;
  readonly status: VaultStatus;
}

export type EmbeddedVaultImportErrorCode = "unavailable" | "locked" | "invalid_source" | "failed";

export class EmbeddedVaultImportError extends Error {
  readonly code: EmbeddedVaultImportErrorCode;

  constructor(code: EmbeddedVaultImportErrorCode, message: string) {
    super(message);
    this.name = "EmbeddedVaultImportError";
    this.code = code;
  }
}

const DEFAULT_MAX_ENTRIES = 1024;
const DEFAULT_MAX_CIPHERTEXT_BYTES = MAX_VAULT_SECRET_BYTES * 2;
const DEFAULT_MAX_TOTAL_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * Imports legacy Electron safe-storage values once, through the privileged
 * server vault boundary. Plaintext exists only in a zeroized callback scope;
 * no result, ledger marker, or error carries a secret value.
 */
export class EmbeddedVaultImportCoordinator {
  private readonly inFlight = new Map<string, Promise<EmbeddedVaultImportResult>>();
  private readonly limits: Required<EmbeddedVaultImportOptions>;

  constructor(
    private readonly vault: ServerVaultService,
    private readonly safeStorage: EmbeddedSafeStorageAdapter,
    private readonly ledger: EmbeddedVaultImportLedger,
    options: EmbeddedVaultImportOptions = {},
  ) {
    if (safeStorage.backend !== "embedded-safe-storage") throw new TypeError("embedded safe-storage adapter is required");
    this.limits = Object.freeze({
      maxEntries: boundedLimit(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, 4096),
      maxCiphertextBytes: boundedLimit(options.maxCiphertextBytes, DEFAULT_MAX_CIPHERTEXT_BYTES, 1, MAX_VAULT_SECRET_BYTES * 4),
      maxTotalCiphertextBytes: boundedLimit(options.maxTotalCiphertextBytes, DEFAULT_MAX_TOTAL_CIPHERTEXT_BYTES, 1, 64 * 1024 * 1024),
    });
  }

  importOnce(source: EmbeddedVaultImportSource): Promise<EmbeddedVaultImportResult> {
    const normalized = validateSource(source, this.limits);
    const existing = this.inFlight.get(normalized.sourceId);
    if (existing !== undefined) return existing;
    const operation = this.run(normalized).finally(() => this.inFlight.delete(normalized.sourceId));
    this.inFlight.set(normalized.sourceId, operation);
    return operation;
  }

  private async run(source: EmbeddedVaultImportSource): Promise<EmbeddedVaultImportResult> {
    let complete = false;
    try {
      complete = await this.ledger.isComplete(source.sourceId);
    } catch {
      throw new EmbeddedVaultImportError("failed", "embedded import marker could not be read");
    }
    if (complete) {
      return Object.freeze({ sourceId: source.sourceId, imported: 0, skippedExisting: source.entries.length, alreadyComplete: true, status: this.vault.status() });
    }
    const status = this.vault.status();
    let available = false;
    try {
      available = this.safeStorage.isAvailable();
    } catch {
      throw new EmbeddedVaultImportError("unavailable", "embedded safe storage is unavailable");
    }
    if (!available) throw new EmbeddedVaultImportError("unavailable", "embedded safe storage is unavailable");
    if (status.state === "locked") throw new EmbeddedVaultImportError("locked", "server vault is locked");
    if (status.state === "unavailable") throw new EmbeddedVaultImportError("unavailable", "server vault is unavailable");

    let imported = 0;
    let skippedExisting = 0;
    for (const entry of source.entries) {
      const existing = await this.vault.test(entry.id);
      if (existing.ok) {
        skippedExisting += 1;
        continue;
      }
      if (existing.code === "locked") throw new EmbeddedVaultImportError("locked", "server vault became locked during import");
      if (existing.code === "unavailable") throw new EmbeddedVaultImportError("unavailable", "server vault became unavailable during import");
      if (existing.code !== "missing") throw new EmbeddedVaultImportError("failed", "server vault entry could not be inspected");
      let plaintext: Uint8Array | undefined;
      try {
        plaintext = await this.safeStorage.decrypt(new Uint8Array(entry.encryptedValue));
        if (!(plaintext instanceof Uint8Array) || plaintext.byteLength > MAX_VAULT_SECRET_BYTES) throw new EmbeddedVaultImportError("invalid_source", "decrypted legacy secret exceeds the limit");
        await this.vault.put({ id: entry.id, ...(entry.label === undefined ? {} : { label: entry.label }), value: plaintext });
        imported += 1;
      } catch (error) {
        if (error instanceof EmbeddedVaultImportError) throw error;
        // Do not expose adapter/decryption messages: Electron errors may
        // contain source paths or accidental plaintext.
        throw new EmbeddedVaultImportError("failed", "embedded secret import failed");
      } finally {
        plaintext?.fill(0);
      }
    }
    try {
      await this.ledger.markComplete(source.sourceId);
    } catch {
      throw new EmbeddedVaultImportError("failed", "embedded import marker could not be committed");
    }
    return Object.freeze({ sourceId: source.sourceId, imported, skippedExisting, alreadyComplete: false, status: this.vault.status() });
  }
}

export const EmbeddedSafeStorageImport = EmbeddedVaultImportCoordinator;

function validateSource(source: EmbeddedVaultImportSource, limits: Required<EmbeddedVaultImportOptions>): EmbeddedVaultImportSource {
  if (!source || typeof source !== "object" || typeof source.sourceId !== "string" || !SOURCE_ID_PATTERN.test(source.sourceId)) {
    throw new EmbeddedVaultImportError("invalid_source", "embedded import source id is invalid");
  }
  if (!Array.isArray(source.entries) || source.entries.length > limits.maxEntries) throw new EmbeddedVaultImportError("invalid_source", "embedded import entry count exceeds the limit");
  let total = 0;
  for (const entry of source.entries) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !(entry.encryptedValue instanceof Uint8Array)) throw new EmbeddedVaultImportError("invalid_source", "embedded import entry is invalid");
    if (entry.encryptedValue.byteLength > limits.maxCiphertextBytes) throw new EmbeddedVaultImportError("invalid_source", "embedded import ciphertext exceeds the limit");
    total += entry.encryptedValue.byteLength;
    if (total > limits.maxTotalCiphertextBytes) throw new EmbeddedVaultImportError("invalid_source", "embedded import payload exceeds the limit");
  }
  return {
    sourceId: source.sourceId,
    entries: source.entries.map((entry) => ({
      ...entry,
      encryptedValue: new Uint8Array(entry.encryptedValue),
    })),
  };
}

function boundedLimit(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value === undefined) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
