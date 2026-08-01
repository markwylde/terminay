import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { ProtocolId } from "@terminay/protocol";
import type { SecretReference } from "./types.js";
import { MAX_VAULT_LABEL_BYTES, MAX_VAULT_SECRET_BYTES, MAX_VAULT_UNLOCK_BYTES, VAULT_ID_PATTERN } from "./vault.js";
import type { SecretVaultAdapter, VaultSecretInput, VaultState } from "./vault.js";

/** The bounded, versioned format written by the server-owned vault. */
export const HEADLESS_VAULT_FORMAT = "terminay-vault-envelope";
export const HEADLESS_VAULT_VERSION = 1;
export const HEADLESS_VAULT_CIPHER = "AES-256-GCM";
export const HEADLESS_VAULT_PROTECTOR = "scrypt-aes-256-gcm";
export const HEADLESS_VAULT_MIN_PASSPHRASE_BYTES = 12;
export const HEADLESS_VAULT_MAX_ENTRIES = 4096;
export const HEADLESS_VAULT_MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;
export const HEADLESS_VAULT_MAX_REVISION = 2 ** 31 - 2;

const SCRYPT = Object.freeze({
  name: "scrypt",
  N: 32_768,
  r: 8,
  p: 1,
  keyLength: 32,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024,
});
const textEncoder = new TextEncoder();
const scryptAsync = promisify(scryptCallback) as unknown as (
  password: Uint8Array,
  salt: Uint8Array,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Persistence is deliberately injected so a server can choose its data root. */
export interface VaultEnvelopeStorage {
  read(): Promise<string | undefined>;
  write(serialized: string): Promise<void>;
}

/** A production file store: mode 0600 and replace-by-rename, never plaintext. */
export class FileVaultEnvelopeStorage implements VaultEnvelopeStorage {
  constructor(private readonly filePath: string) {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new TypeError("vault storage path is required");
    }
  }

  async read(): Promise<string | undefined> {
    try {
      const serialized = await readFile(this.filePath, "utf8");
      if (Buffer.byteLength(serialized) > HEADLESS_VAULT_MAX_ENVELOPE_BYTES) {
        throw new Error("vault envelope exceeds its size limit");
      }
      return serialized;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      if (error instanceof Error && error.message.includes("size limit")) throw error;
      throw new Error("vault storage read failed");
    }
  }

  async write(serialized: string): Promise<void> {
    if (typeof serialized !== "string" || Buffer.byteLength(serialized) > HEADLESS_VAULT_MAX_ENVELOPE_BYTES) {
      throw new Error("vault envelope exceeds its size limit");
    }
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.filePath);
    } catch {
      throw new Error("vault storage write failed");
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

export interface HeadlessPassphraseVaultOptions {
  readonly serverId: string;
  readonly storage: VaultEnvelopeStorage;
  readonly now?: () => number;
  /** Supplying a snapshot is useful for recovery and avoids a second read. */
  readonly initialSerialized?: string;
}

type CipherRecord = {
  readonly cipher: typeof HEADLESS_VAULT_CIPHER;
  readonly nonce: string;
  readonly tag: string;
  readonly ciphertext: string;
};

type EnvelopeEntry = CipherRecord & {
  readonly id: ProtocolId;
  readonly label: string;
  readonly version: 1;
  readonly updatedAt: number;
};

type KeyEnvelope = CipherRecord & {
  readonly protector: typeof HEADLESS_VAULT_PROTECTOR;
  readonly version: 1;
  readonly kdf: typeof SCRYPT;
  readonly salt: string;
};

type Manifest = CipherRecord & { readonly version: 1 };

type VaultEnvelope = {
  readonly format: typeof HEADLESS_VAULT_FORMAT;
  readonly version: 1;
  readonly serverId: string;
  readonly revision: number;
  readonly keyEnvelope: KeyEnvelope;
  readonly entries: readonly EnvelopeEntry[];
  readonly manifest: Manifest;
};

export class HeadlessVaultError extends Error {
  constructor(message = "headless vault operation failed") {
    super(message);
    this.name = "HeadlessVaultError";
  }
}

/**
 * Server-owned passphrase vault. The passphrase and all derived/data keys are
 * held only in memory while unlocked; the storage boundary receives ciphertext
 * envelopes and never plaintext values.
 */
export class HeadlessPassphraseVaultAdapter implements SecretVaultAdapter {
  readonly backend = "headless-passphrase" as const;
  private envelope: VaultEnvelope | undefined;
  private dataEncryptionKey: Buffer | undefined;
  private protectorKey: Buffer | undefined;
  private unavailable = false;
  private readonly now: () => number;

  private constructor(
    private readonly serverId: string,
    private readonly storage: VaultEnvelopeStorage,
    initialSerialized: string | undefined,
    now: () => number,
  ) {
    this.now = now;
    assertServerId(serverId);
    if (initialSerialized !== undefined) {
      this.envelope = parseEnvelope(initialSerialized, serverId);
    }
  }

  static async open(options: HeadlessPassphraseVaultOptions): Promise<HeadlessPassphraseVaultAdapter> {
    if (!options || typeof options !== "object" || !options.storage) throw new TypeError("vault storage is required");
    assertServerId(options.serverId);
    const now = options.now ?? (() => Date.now());
    let serialized = options.initialSerialized;
    if (serialized === undefined) {
      try {
        serialized = await options.storage.read();
      } catch {
        const adapter = new HeadlessPassphraseVaultAdapter(options.serverId, options.storage, undefined, now);
        adapter.unavailable = true;
        return adapter;
      }
    }
    return new HeadlessPassphraseVaultAdapter(options.serverId, options.storage, serialized, now);
  }

  status(): VaultState {
    if (this.unavailable) return "unavailable";
    return this.dataEncryptionKey ? "unlocked" : "locked";
  }

  list(): readonly SecretReference[] {
    if (this.unavailable || !this.envelope) return Object.freeze([]);
    return Object.freeze(this.envelope.entries.map((entry) => Object.freeze({
      id: entry.id,
      configured: true,
      ...(entry.label.length > 0 ? { label: entry.label } : {}),
      version: entry.version,
      updatedAt: entry.updatedAt,
    })));
  }

  async unlock(request: { readonly secret: Uint8Array }): Promise<void> {
    if (this.unavailable) throw new HeadlessVaultError("vault unavailable");
    if (!(request?.secret instanceof Uint8Array)) throw new TypeError("unlock secret must be bytes");
    if (request.secret.byteLength < HEADLESS_VAULT_MIN_PASSPHRASE_BYTES || request.secret.byteLength > MAX_VAULT_UNLOCK_BYTES) {
      throw new RangeError("unlock secret length is outside the policy");
    }
    const passphrase = Buffer.from(request.secret);
    let candidateKey: Buffer | undefined;
    let candidateProtectorKey: Buffer | undefined;
    try {
      if (!this.envelope) {
        const dataKey = randomBytes(32);
        const salt = randomBytes(SCRYPT.saltBytes);
        try {
          candidateProtectorKey = await deriveKey(passphrase, salt);
          const wrapped = encryptAesGcm(dataKey, candidateProtectorKey, keyAad(this.serverId));
          const keyEnvelope: KeyEnvelope = {
            protector: HEADLESS_VAULT_PROTECTOR,
            version: 1,
            kdf: SCRYPT,
            salt: salt.toString("base64url"),
            ...wrapped,
          };
          candidateKey = Buffer.from(dataKey);
          const candidate = createEnvelope(this.serverId, keyEnvelope, candidateKey, [], 0);
          await this.persist(candidate);
          this.envelope = candidate;
        } finally {
          salt.fill(0);
          dataKey.fill(0);
        }
      } else {
        const salt = decodeBase64(this.envelope.keyEnvelope.salt, SCRYPT.saltBytes);
        try {
          candidateProtectorKey = await deriveKey(passphrase, salt);
          candidateKey = decryptAesGcm(this.envelope.keyEnvelope, candidateProtectorKey, keyAad(this.serverId));
          if (candidateKey.length !== 32) throw new Error("invalid data key");
          verifyManifest(this.envelope, candidateKey);
        } catch {
          candidateKey?.fill(0);
          candidateKey = undefined;
          throw new HeadlessVaultError("vault unlock failed");
        } finally {
          salt.fill(0);
        }
      }
      this.dataEncryptionKey?.fill(0);
      this.protectorKey?.fill(0);
      this.dataEncryptionKey = candidateKey;
      this.protectorKey = candidateProtectorKey;
      candidateKey = undefined;
      candidateProtectorKey = undefined;
    } finally {
      passphrase.fill(0);
      candidateKey?.fill(0);
      candidateProtectorKey?.fill(0);
    }
  }

  lock(): void {
    this.dataEncryptionKey?.fill(0);
    this.protectorKey?.fill(0);
    this.dataEncryptionKey = undefined;
    this.protectorKey = undefined;
  }

  async put(input: VaultSecretInput): Promise<SecretReference> {
    return this.writeEntry(input, false);
  }

  async replace(input: VaultSecretInput): Promise<SecretReference> {
    return this.writeEntry(input, true);
  }

  async test(id: ProtocolId): Promise<void> {
    this.requireKey();
    if (!this.findEntry(id)) throw new HeadlessVaultError("missing secret");
  }

  async remove(id: ProtocolId): Promise<boolean> {
    const key = this.requireKey();
    const current = this.envelope;
    if (!current) return false;
    const index = current.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const entries = current.entries.slice();
    entries.splice(index, 1);
    const candidate = createEnvelope(this.serverId, current.keyEnvelope, key, entries, current.revision + 1);
    await this.persist(candidate);
    this.envelope = candidate;
    return true;
  }

  /** Re-encrypts every entry under a fresh data key and refreshes its wrapped key. */
  async rotate(): Promise<void> {
    const currentKey = this.requireKey();
    const protectorKey = this.protectorKey;
    if (!protectorKey || !this.envelope) throw new HeadlessVaultError("vault is locked");
    if (this.envelope.revision >= HEADLESS_VAULT_MAX_REVISION) throw new HeadlessVaultError("vault revision limit reached");
    const nextKey = randomBytes(32);
    const usedNonces = new Set<string>();
    try {
      const wrapped = encryptAesGcm(nextKey, protectorKey, keyAad(this.serverId), usedNonces);
      const nextKeyEnvelope: KeyEnvelope = {
        ...this.envelope.keyEnvelope,
        ...wrapped,
      };
      const entries: EnvelopeEntry[] = [];
      for (const entry of this.envelope.entries) {
        let plaintext: Buffer | undefined;
        try {
          plaintext = decryptAesGcm(entry, currentKey, entryAad(this.serverId, entry.id));
          entries.push({
            id: entry.id,
            label: entry.label,
            version: 1,
            updatedAt: entry.updatedAt,
            ...encryptAesGcm(plaintext, nextKey, entryAad(this.serverId, entry.id), usedNonces),
          });
        } finally {
          plaintext?.fill(0);
        }
      }
      const candidate = createEnvelope(this.serverId, nextKeyEnvelope, nextKey, entries, this.envelope.revision + 1, usedNonces);
      await this.persist(candidate);
      currentKey.fill(0);
      this.dataEncryptionKey = nextKey;
      this.envelope = candidate;
    } catch (error) {
      nextKey.fill(0);
      throw error instanceof HeadlessVaultError ? error : new HeadlessVaultError();
    }
  }

  async withSecret<T>(id: ProtocolId, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T> {
    const key = this.requireKey();
    const entry = this.findEntry(id);
    if (!entry) throw new HeadlessVaultError("missing secret");
    let plaintext: Buffer | undefined;
    try {
      plaintext = decryptAesGcm(entry, key, entryAad(this.serverId, id));
      return await callback(plaintext);
    } finally {
      plaintext?.fill(0);
    }
  }

  private requireKey(): Buffer {
    if (this.unavailable) throw new HeadlessVaultError("vault unavailable");
    if (!this.dataEncryptionKey) throw new HeadlessVaultError("vault is locked");
    return this.dataEncryptionKey;
  }

  private findEntry(id: ProtocolId): EnvelopeEntry | undefined {
    return this.envelope?.entries.find((entry) => entry.id === id);
  }

  private async writeEntry(input: VaultSecretInput, replace: boolean): Promise<SecretReference> {
    const key = this.requireKey();
    if (typeof input?.id !== "string" || !VAULT_ID_PATTERN.test(input.id)) throw new TypeError("vault secret id is invalid");
    if (!(input.value instanceof Uint8Array) || input.value.byteLength > MAX_VAULT_SECRET_BYTES) throw new RangeError("secret exceeds the limit");
    const current = this.envelope;
    if (!current) throw new HeadlessVaultError("vault is locked");
    const index = current.entries.findIndex((entry) => entry.id === input.id);
    if (!replace && index >= 0) throw new HeadlessVaultError("secret already exists");
    if (replace && index < 0) throw new HeadlessVaultError("missing secret");
    const label = input.label ?? "";
    if (typeof label !== "string" || textEncoder.encode(label).byteLength > MAX_VAULT_LABEL_BYTES) throw new RangeError("secret label exceeds the limit");
    const plaintext = Buffer.from(input.value);
    try {
      const usedNonces = new Set(current.entries.map((entry) => entry.nonce));
      usedNonces.add(current.manifest.nonce);
      const entry: EnvelopeEntry = {
        id: input.id,
        label,
        version: 1,
        updatedAt: Math.max(0, Math.floor(this.now())),
        ...encryptAesGcm(plaintext, key, entryAad(this.serverId, input.id), usedNonces),
      };
      const entries = current.entries.slice();
      if (replace) entries[index] = entry;
      else {
        if (entries.length >= HEADLESS_VAULT_MAX_ENTRIES) throw new RangeError("vault entry count exceeds the limit");
        entries.push(entry);
      }
      const candidate = createEnvelope(this.serverId, current.keyEnvelope, key, entries, current.revision + 1, usedNonces);
      await this.persist(candidate);
      this.envelope = candidate;
      return toReference(entry);
    } finally {
      plaintext.fill(0);
    }
  }

  private async persist(candidate: VaultEnvelope): Promise<void> {
    const serialized = JSON.stringify(candidate);
    if (Buffer.byteLength(serialized) > HEADLESS_VAULT_MAX_ENVELOPE_BYTES) throw new HeadlessVaultError("vault envelope exceeds its size limit");
    try {
      await this.storage.write(serialized);
    } catch {
      throw new HeadlessVaultError("vault storage write failed");
    }
  }
}

function assertServerId(serverId: string): void {
  if (typeof serverId !== "string" || serverId.length === 0 || serverId.length > 256) throw new TypeError("server id is invalid");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function deriveKey(passphrase: Buffer, salt: Buffer): Promise<Buffer> {
  return scryptAsync(passphrase, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
}

function entryAad(serverId: string, id: string): Uint8Array {
  return textEncoder.encode(JSON.stringify(["terminay-vault-entry", 1, serverId, id]));
}

function keyAad(serverId: string): Uint8Array {
  return textEncoder.encode(JSON.stringify(["terminay-vault-data-key", 1, serverId]));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestAad(envelope: VaultEnvelope): Uint8Array {
  return textEncoder.encode(canonicalJson(["terminay-vault-manifest", 1, envelope.format, envelope.version, envelope.serverId, envelope.revision, envelope.keyEnvelope, envelope.entries]));
}

function manifestKey(dataKey: Buffer, serverId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", dataKey, textEncoder.encode(serverId), textEncoder.encode("terminay-vault-manifest-integrity-key:v1"), 32));
}

function sealManifest(envelope: VaultEnvelope, key: Buffer): Manifest {
  const integrityKey = manifestKey(key, envelope.serverId);
  try {
    return { version: 1, ...encryptAesGcm(Buffer.from(new Uint8Array(0)), integrityKey, manifestAad(envelope)) };
  } finally {
    integrityKey.fill(0);
  }
}

function verifyManifest(envelope: VaultEnvelope, key: Buffer): void {
  const integrityKey = manifestKey(key, envelope.serverId);
  let plaintext: Buffer | undefined;
  try {
    plaintext = decryptAesGcm(envelope.manifest, integrityKey, manifestAad(envelope));
    if (plaintext.length !== 0) throw new Error("invalid manifest");
  } catch {
    throw new HeadlessVaultError("vault unlock failed");
  } finally {
    plaintext?.fill(0);
    integrityKey.fill(0);
  }
}

function createEnvelope(serverId: string, keyEnvelope: KeyEnvelope, key: Buffer, entries: readonly EnvelopeEntry[], revision: number, _usedNonces?: Set<string>): VaultEnvelope {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > HEADLESS_VAULT_MAX_REVISION) throw new HeadlessVaultError("vault revision limit reached");
  const withoutManifest = { format: HEADLESS_VAULT_FORMAT, version: 1 as const, serverId, revision, keyEnvelope, entries: entries.slice() };
  const candidate = { ...withoutManifest, manifest: undefined as unknown as Manifest } as VaultEnvelope;
  return { ...candidate, manifest: sealManifest(candidate, key) };
}

function parseEnvelope(serialized: string, expectedServerId: string): VaultEnvelope {
  if (typeof serialized !== "string" || Buffer.byteLength(serialized) > HEADLESS_VAULT_MAX_ENVELOPE_BYTES) throw new HeadlessVaultError("vault envelope is invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new HeadlessVaultError("vault envelope is invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HeadlessVaultError("vault envelope is invalid");
  const value = parsed as Record<string, unknown>;
  const revision = value.revision as number;
  if (value.format !== HEADLESS_VAULT_FORMAT || value.version !== 1 || value.serverId !== expectedServerId || !Array.isArray(value.entries) || value.entries.length > HEADLESS_VAULT_MAX_ENTRIES || !Number.isSafeInteger(revision) || revision < 0 || revision > HEADLESS_VAULT_MAX_REVISION) throw new HeadlessVaultError("vault envelope is invalid");
  const keyEnvelope = value.keyEnvelope as Record<string, unknown>;
  const manifest = value.manifest as Record<string, unknown>;
  if (!keyEnvelope || keyEnvelope.protector !== HEADLESS_VAULT_PROTECTOR || keyEnvelope.version !== 1 || keyEnvelope.cipher !== HEADLESS_VAULT_CIPHER || typeof keyEnvelope.salt !== "string" || typeof keyEnvelope.nonce !== "string" || typeof keyEnvelope.tag !== "string" || typeof keyEnvelope.ciphertext !== "string" || !keyEnvelope.kdf || JSON.stringify(keyEnvelope.kdf) !== JSON.stringify(SCRYPT)) throw new HeadlessVaultError("vault envelope is invalid");
  if (manifest?.version !== 1 || manifest.cipher !== HEADLESS_VAULT_CIPHER || typeof manifest.nonce !== "string" || typeof manifest.tag !== "string" || typeof manifest.ciphertext !== "string") throw new HeadlessVaultError("vault envelope is invalid");
  decodeBase64(keyEnvelope.salt, SCRYPT.saltBytes).fill(0);
  decodeBase64(keyEnvelope.nonce, 12).fill(0);
  decodeBase64(keyEnvelope.tag, 16).fill(0);
  const wrappedKey = decodeBase64(keyEnvelope.ciphertext, 32);
  wrappedKey.fill(0);
  decodeBase64(manifest.nonce, 12).fill(0);
  decodeBase64(manifest.tag, 16).fill(0);
  if (manifest.ciphertext !== "") throw new HeadlessVaultError("vault envelope is invalid");
  const ids = new Set<string>();
  const entries = (value.entries as unknown[]).map((raw) => {
    const entry = raw as Record<string, unknown>;
    const updatedAt = entry?.updatedAt as number;
    if (!entry || typeof entry.id !== "string" || !VAULT_ID_PATTERN.test(entry.id) || ids.has(entry.id) || typeof entry.label !== "string" || textEncoder.encode(entry.label).byteLength > MAX_VAULT_LABEL_BYTES || entry.version !== 1 || entry.cipher !== HEADLESS_VAULT_CIPHER || !Number.isSafeInteger(updatedAt) || updatedAt < 0 || typeof entry.nonce !== "string" || typeof entry.tag !== "string" || typeof entry.ciphertext !== "string") throw new HeadlessVaultError("vault envelope is invalid");
    ids.add(entry.id);
    decodeBase64(entry.nonce, 12).fill(0);
    decodeBase64(entry.tag, 16).fill(0);
    const ciphertext = decodeBase64(entry.ciphertext, undefined);
    if (ciphertext.length > MAX_VAULT_SECRET_BYTES) throw new HeadlessVaultError("vault envelope is invalid");
    ciphertext.fill(0);
    return { id: entry.id, label: entry.label, version: 1 as const, updatedAt, cipher: HEADLESS_VAULT_CIPHER as typeof HEADLESS_VAULT_CIPHER, nonce: entry.nonce, tag: entry.tag, ciphertext: entry.ciphertext };
  });
  return { format: HEADLESS_VAULT_FORMAT, version: 1, serverId: expectedServerId, revision, keyEnvelope: keyEnvelope as unknown as KeyEnvelope, entries, manifest: manifest as unknown as Manifest };
}

function decodeBase64(value: string, expectedBytes: number | undefined): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) throw new HeadlessVaultError("vault envelope is invalid");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) { decoded.fill(0); throw new HeadlessVaultError("vault envelope is invalid"); }
  return decoded;
}

function encryptAesGcm(plaintext: Uint8Array, key: Buffer, aad: Uint8Array, usedNonces = new Set<string>()): CipherRecord {
  let nonce: Buffer | undefined;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomBytes(12);
    if (!usedNonces.has(candidate.toString("base64url"))) { nonce = candidate; break; }
    candidate.fill(0);
  }
  if (!nonce) throw new HeadlessVaultError("could not allocate vault nonce");
  usedNonces.add(nonce.toString("base64url"));
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const result: CipherRecord = { cipher: HEADLESS_VAULT_CIPHER, nonce: nonce.toString("base64url"), tag: tag.toString("base64url"), ciphertext: ciphertext.toString("base64url") };
  nonce.fill(0); tag.fill(0); ciphertext.fill(0);
  return result;
}

function decryptAesGcm(encrypted: CipherRecord, key: Buffer, aad: Uint8Array): Buffer {
  const nonce = decodeBase64(encrypted.nonce, 12);
  const tag = decodeBase64(encrypted.tag, 16);
  const ciphertext = decodeBase64(encrypted.ciphertext, undefined);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new HeadlessVaultError("vault decryption failed");
  } finally {
    nonce.fill(0); tag.fill(0); ciphertext.fill(0);
  }
}

function toReference(entry: EnvelopeEntry): SecretReference {
  return Object.freeze({ id: entry.id, configured: true, ...(entry.label.length > 0 ? { label: entry.label } : {}), version: entry.version, updatedAt: entry.updatedAt });
}
