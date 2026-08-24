import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseProfileInput } from "./validation.js";
import { SshProviderError } from "./errors.js";

type ParsedProfile = ReturnType<typeof parseProfileInput>;
type ProfileStatus = string;
export type StoredProfile = Omit<ParsedProfile, "expectedRevision"> & {
  expectedRevision?: undefined;
  revision: number;
  trustIdentity: string;
  status: ProfileStatus;
  updatedAt: string;
  lastSuccessAt?: string;
};
export type PublicProfile = {
  id: string;
  revision: number;
  displayName: string;
  hostname: string;
  port: number;
  username: string;
  authMode: ParsedProfile["auth"]["mode"];
  defaultRoot: string;
  hostVerification: ParsedProfile["hostVerification"];
  trustIdentity: string;
  status: ProfileStatus;
  updatedAt: string;
  lastSuccessAt?: string;
};
export type TrustRecord = Record<string, unknown> & { identity?: string; publicKey?: string; fingerprint?: string };
type StoreState = {
  version: 1;
  profiles: Record<string, StoredProfile>;
  trusts: Record<string, TrustRecord>;
  references: Record<string, string[]>;
};

export class ProfileStore {
  #file: string;
  #auditFile: string;
  #state: StoreState = { version: 1, profiles: {}, trusts: {}, references: {} };
  #write: Promise<void> = Promise.resolve();

  constructor(configurationDirectory: string, dataDirectory: string) {
    this.#file = join(configurationDirectory, "ssh-profiles.json");
    this.#auditFile = join(dataDirectory, "ssh-audit.jsonl");
  }

  async load(): Promise<this> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      if (isStoreState(parsed)) this.#state = parsed;
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    return this;
  }

  list(): PublicProfile[] { return Object.values(this.#state.profiles).map(redactProfile); }

  get(id: string, revision?: number): StoredProfile {
    const profile = this.#state.profiles[id];
    if (!profile) throw new SshProviderError("profile-not-found", "SSH profile was not found");
    if (revision !== undefined && profile.revision !== revision) throw new SshProviderError("revision-conflict", "SSH profile revision changed");
    return structuredClone(profile);
  }

  async save(input: unknown, principal: string = "system"): Promise<PublicProfile> {
    const parsed = parseProfileInput(input);
    const previous = this.#state.profiles[parsed.id];
    if (previous && parsed.expectedRevision !== previous.revision) throw new SshProviderError("revision-conflict", "SSH profile revision changed");
    if (!previous && parsed.expectedRevision !== undefined && parsed.expectedRevision !== 0) throw new SshProviderError("revision-conflict", "SSH profile does not exist at that revision");
    const revision = (previous?.revision ?? 0) + 1;
    const trustIdentity = parsed.logicalHostIdentity ?? `${parsed.hostname.toLowerCase()}:${parsed.port}`;
    if (previous && previous.trustIdentity !== trustIdentity) delete this.#state.trusts[parsed.id];
    const profile: StoredProfile = {
      ...parsed,
      expectedRevision: undefined,
      revision,
      trustIdentity,
      status: "disconnected",
      updatedAt: new Date().toISOString(),
      lastSuccessAt: previous?.lastSuccessAt,
    };
    this.#state.profiles[parsed.id] = profile;
    await this.#persist();
    await this.audit(principal, parsed.id, "profile.save", "success", revision);
    return redactProfile(profile);
  }

  async remove(id: string, expectedRevision?: number, principal: string = "system"): Promise<void> {
    const profile = this.get(id, expectedRevision);
    const refs = this.#state.references[id] ?? [];
    if (refs.length) throw new SshProviderError("profile-referenced", "SSH profile is still referenced", { referenceCount: refs.length });
    delete this.#state.profiles[id];
    delete this.#state.trusts[id];
    await this.#persist();
    await this.audit(principal, id, "profile.remove", "success", profile.revision);
  }

  references(id: string): string[] { return [...(this.#state.references[id] ?? [])]; }

  async setReferences(id: string, references: readonly string[]): Promise<void> {
    this.#state.references[id] = [...new Set(references)].slice(0, 10_000);
    await this.#persist();
  }

  trust(id: string): TrustRecord | undefined {
    return this.#state.trusts[id] ? structuredClone(this.#state.trusts[id]) : undefined;
  }

  async setTrust(id: string, record: TrustRecord): Promise<void> {
    this.#state.trusts[id] = structuredClone(record);
    await this.#persist();
  }

  async setStatus(id: string, status: ProfileStatus, success: boolean = false): Promise<void> {
    const profile = this.#state.profiles[id];
    if (!profile) return;
    profile.status = status;
    if (success) profile.lastSuccessAt = new Date().toISOString();
    await this.#persist();
  }

  async audit(principal: string, profileId: string, action: string, result: string, revision: number, details?: unknown): Promise<void> {
    const record = { id: randomUUID(), timestamp: new Date().toISOString(), principal: String(principal).slice(0, 200), extensionId: "com.terminay.ssh", profileId, action, result, revision, ...(details ? { details } : {}) };
    await mkdir(dirname(this.#auditFile), { recursive: true });
    await writeFile(this.#auditFile, `${JSON.stringify(record)}\n`, { flag: "a", mode: 0o600 });
  }

  async #persist(): Promise<void> {
    const snapshot = JSON.stringify(this.#state, null, 2);
    const file = this.#file;
    this.#write = this.#write.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, file);
    });
    await this.#write;
  }
}

function redactProfile(profile: StoredProfile): PublicProfile {
  return { id: profile.id, revision: profile.revision, displayName: profile.displayName, hostname: profile.hostname, port: profile.port, username: profile.username, authMode: profile.auth.mode, defaultRoot: profile.defaultRoot, hostVerification: profile.hostVerification, trustIdentity: profile.trustIdentity, status: profile.status, updatedAt: profile.updatedAt, lastSuccessAt: profile.lastSuccessAt };
}

function isStoreState(value: unknown): value is StoreState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && isRecord(candidate.profiles) && isRecord(candidate.trusts) && isRecord(candidate.references);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
