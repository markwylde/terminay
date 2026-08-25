import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SshProviderError } from "./errors.js";
import type { StoredProfile, TrustRecord, ProfileStore } from "./store.js";

interface KeyRecord { identity: string; algorithm: string; publicKey: string; fingerprint: string }
interface Challenge extends Omit<KeyRecord, "identity"> { challengeId: string; profileId: string; revision: number; action: "approve" | "replace"; host: string; port: number; expectedFingerprint?: string; expiresAt: number; used: boolean }
interface TrustCommand { profileId: string; expectedRevision: number; challengeId: string; action: "approve" | "replace" }

export class HostTrustManager {
  #store: ProfileStore; #challenges = new Map<string, Challenge>(); #ttlMs: number;
  constructor(store: ProfileStore, { ttlMs = 120_000 }: { ttlMs?: number } = {}) { this.#store = store; this.#ttlMs = ttlMs; }
  verify(profile: StoredProfile, key: Uint8Array, algorithm = "unknown"): { accepted: true; unsafe: boolean } {
    if (profile.hostVerification === "unsafe") return { accepted: true, unsafe: true };
    const actual = keyRecord(profile, key, algorithm); const trusted = this.#store.trust(profile.id);
    if (trusted?.identity === profile.trustIdentity && typeof trusted.publicKey === "string" && safeEqual(trusted.publicKey, actual.publicKey)) return { accepted: true, unsafe: false };
    const kind = trusted ? "replace" : "approve"; const challenge = this.#issue(profile, actual, kind, trusted);
    throw new SshProviderError(trusted ? "host-key-mismatch" : "host-key-approval-required", trusted ? "SSH host key does not match the trusted key" : "SSH host key approval is required", challenge);
  }
  async approve({ profileId, expectedRevision, challengeId, action }: TrustCommand, principal: string) {
    const profile = this.#store.get(profileId, expectedRevision); const challenge = this.#challenges.get(challengeId);
    if (!challenge || challenge.expiresAt < Date.now() || challenge.used || challenge.profileId !== profileId || challenge.revision !== expectedRevision || challenge.action !== action || !["approve", "replace"].includes(action)) throw new SshProviderError("trust-challenge-stale", "Host trust challenge is stale or does not match");
    challenge.used = true; this.#challenges.delete(challengeId);
    await this.#store.setTrust(profileId, { identity: profile.trustIdentity, algorithm: challenge.algorithm, fingerprint: challenge.fingerprint, publicKey: challenge.publicKey, trustedAt: new Date().toISOString(), revision: expectedRevision });
    await this.#store.audit(principal, profileId, `trust.${action}`, "success", expectedRevision, { algorithm: challenge.algorithm, fingerprint: challenge.fingerprint });
    return { profileId, revision: expectedRevision, fingerprint: challenge.fingerprint };
  }
  async confirmUnsafe({ profileId, expectedRevision, confirmation }: { profileId: string; expectedRevision: number; confirmation: string }, principal: string) {
    if (confirmation !== "DISABLE HOST KEY VERIFICATION") throw new SshProviderError("invalid-input", "Unsafe bypass requires the exact confirmation phrase");
    const profile = this.#store.get(profileId, expectedRevision);
    const saved = await this.#store.save({ ...profileToInput(profile), expectedRevision, hostVerification: "unsafe" }, principal);
    await this.#store.audit(principal, profileId, "trust.unsafe-enable", "success", saved.revision, { warning: "host-key-verification-disabled" });
    return saved;
  }
  async restoreStrict({ profileId, expectedRevision }: { profileId: string; expectedRevision: number }, principal: string) {
    const profile = this.#store.get(profileId, expectedRevision);
    const saved = await this.#store.save({ ...profileToInput(profile), expectedRevision, hostVerification: "strict" }, principal);
    await this.#store.audit(principal, profileId, "trust.unsafe-disable", "success", saved.revision);
    return saved;
  }
  #issue(profile: StoredProfile, actual: KeyRecord, action: "approve" | "replace", trusted?: TrustRecord) {
    for (const [id, item] of this.#challenges) if (item.expiresAt < Date.now() || item.profileId === profile.id) this.#challenges.delete(id);
    const challenge: Challenge = { challengeId: randomBytes(24).toString("base64url"), profileId: profile.id, revision: profile.revision, action, host: profile.hostname, port: profile.port, algorithm: actual.algorithm, fingerprint: actual.fingerprint, publicKey: actual.publicKey, ...(typeof trusted?.fingerprint === "string" ? { expectedFingerprint: trusted.fingerprint } : {}), expiresAt: Date.now() + this.#ttlMs, used: false };
    this.#challenges.set(challenge.challengeId, challenge);
    return { challengeId: challenge.challengeId, action, host: challenge.host, port: challenge.port, algorithm: challenge.algorithm, fingerprint: challenge.fingerprint, expectedFingerprint: challenge.expectedFingerprint, expiresAt: new Date(challenge.expiresAt).toISOString() };
  }
}

function keyRecord(profile: StoredProfile, key: Uint8Array, algorithm: string): KeyRecord { const bytes = Buffer.isBuffer(key) ? key : Buffer.from(key); return { identity: profile.trustIdentity, algorithm, publicKey: bytes.toString("base64"), fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}` }; }
function safeEqual(a: string, b: string): boolean { try { const left = Buffer.from(a, "base64"), right = Buffer.from(b, "base64"); return left.length === right.length && timingSafeEqual(left, right); } catch { return false; } }
function profileToInput(p: StoredProfile) { return { id: p.id, displayName: p.displayName, hostname: p.hostname, port: p.port, username: p.username, ...(p.logicalHostIdentity ? { logicalHostIdentity: p.logicalHostIdentity } : {}), auth: p.auth, defaultRoot: p.defaultRoot, hostVerification: p.hostVerification, timeouts: p.timeouts }; }
