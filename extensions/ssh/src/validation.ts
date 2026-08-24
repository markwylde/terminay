import { DEFAULT_TIMEOUTS, PROFILE_LIMITS } from "./constants.js";
import { SshProviderError } from "./errors.js";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const HOST = /^(?=.{1,253}$)(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/;

export type SshAuth = { mode: "agent" } | { mode: "password"; passwordSecretRef: string } | { mode: "private-key"; privateKeySecretRef: string; passphraseSecretRef?: string };
export interface SshProfileInput { id: string; expectedRevision?: number; displayName: string; hostname: string; port: number; username: string; logicalHostIdentity?: string; auth: SshAuth; defaultRoot: string; hostVerification: "strict" | "unsafe"; timeouts: { connectMs: number; handshakeMs: number; keepaliveMs: number } }
type UnknownRecord = Record<string, unknown>;

export function parseProfileInput(value: unknown): Readonly<SshProfileInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("profile must be an object");
  const record = value as UnknownRecord;
  const allowed = new Set(["id", "expectedRevision", "displayName", "hostname", "port", "username", "logicalHostIdentity", "auth", "defaultRoot", "hostVerification", "timeouts"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) fail(`unknown profile field: ${key}`);
  const id = bounded(record.id, "id", 128); if (!ID.test(id)) fail("invalid profile id");
  const displayName = bounded(record.displayName, "displayName", PROFILE_LIMITS.name);
  const hostname = bounded(record.hostname, "hostname", PROFILE_LIMITS.hostname); if (!HOST.test(hostname)) fail("invalid hostname");
  const port = integer(record.port ?? 22, "port", 1, 65535);
  const username = bounded(record.username, "username", PROFILE_LIMITS.username);
  const auth = parseAuth(record.auth);
  const defaultRoot = record.defaultRoot === undefined ? "~" : bounded(record.defaultRoot, "defaultRoot", PROFILE_LIMITS.root);
  if (defaultRoot.includes("\0") || defaultRoot.includes("\n")) fail("invalid default root");
  const policy = record.hostVerification === "unsafe" ? "unsafe" : record.hostVerification === undefined || record.hostVerification === "strict" ? "strict" : fail("invalid host verification policy");
  const timeouts = record.timeouts && typeof record.timeouts === "object" && !Array.isArray(record.timeouts) ? record.timeouts as UnknownRecord : {};
  const logicalHostIdentity = record.logicalHostIdentity === undefined ? undefined : bounded(record.logicalHostIdentity, "logicalHostIdentity", 200);
  return Object.freeze({ id, expectedRevision: optionalInteger(record.expectedRevision), displayName, hostname, port, username, ...(logicalHostIdentity ? { logicalHostIdentity } : {}), auth, defaultRoot, hostVerification: policy, timeouts: Object.freeze({ connectMs: integer(timeouts.connectMs ?? DEFAULT_TIMEOUTS.connectMs, "connectMs", 1000, 120000), handshakeMs: integer(timeouts.handshakeMs ?? DEFAULT_TIMEOUTS.handshakeMs, "handshakeMs", 1000, 120000), keepaliveMs: integer(timeouts.keepaliveMs ?? DEFAULT_TIMEOUTS.keepaliveMs, "keepaliveMs", 1000, 120000) }) });
}

function parseAuth(value: unknown): SshAuth {
  if (!value || typeof value !== "object") fail("authentication is required");
  const record = value as UnknownRecord;
  if (record.mode === "agent") return Object.freeze({ mode: "agent" });
  if (record.mode === "password") return Object.freeze({ mode: "password", passwordSecretRef: bounded(record.passwordSecretRef, "passwordSecretRef", 200) });
  if (record.mode === "private-key") return Object.freeze({ mode: "private-key", privateKeySecretRef: bounded(record.privateKeySecretRef, "privateKeySecretRef", 200), ...(record.passphraseSecretRef ? { passphraseSecretRef: bounded(record.passphraseSecretRef, "passphraseSecretRef", 200) } : {}) });
  fail("unsupported authentication mode");
}
function bounded(value: unknown, field: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max) fail(`invalid ${field}`); return value; }
function integer(value: unknown, field: string, min: number, max: number): number { if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(`invalid ${field}`); return value as number; }
function optionalInteger(value: unknown): number | undefined { if (value === undefined) return undefined; return integer(value, "expectedRevision", 0, Number.MAX_SAFE_INTEGER); }
function fail(message: string): never { throw new SshProviderError("invalid-input", message); }

export function quotePosix(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
export function assertAbsolute(path: unknown): string { if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new SshProviderError("root-unavailable", "Remote root must be canonical and absolute"); return path; }
