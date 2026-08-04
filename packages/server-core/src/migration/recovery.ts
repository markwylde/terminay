/**
 * Recovery-client and legacy-adapter metadata. These reports describe
 * authority/fallback decisions without copying renderer payloads, IPC names,
 * URLs with credentials, or terminal state.
 */

export interface RecoveryClientFallbackInput {
  readonly origin: string;
  readonly bundleId?: string;
}

export interface RecoveryClientFallback {
  readonly mode: "direct-server-bundle";
  readonly origin: string;
  readonly entryPath: "/";
  readonly bundleId?: string;
  readonly requiresHostShell: false;
  readonly authority: "server";
  readonly reason: "host-shell-unavailable";
}

export type LegacyAdapterName = "rendererPreload" | "terminalOnlyRemote" | "recordingPreload" | "fileViewerPreload";
export type LegacyAdapterCleanup = "not-present" | "retain-until-parity";

export interface CompatibilityAdapterStatus {
  readonly name: LegacyAdapterName;
  readonly present: boolean;
  readonly authority: "compatibility-adapter" | "server";
  readonly cleanup: LegacyAdapterCleanup;
  readonly reason: "not-present" | "server-client-parity-not-proven";
}

export interface CompatibilityAdapterCleanupReport {
  readonly adapters: readonly CompatibilityAdapterStatus[];
  readonly pendingCount: number;
  readonly serverAuthorityReady: false;
}

const BUNDLE_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const ADAPTERS: readonly [LegacyAdapterName, readonly string[]][] = [
  ["rendererPreload", ["rendererPreload", "preloadBridge", "legacyPreload"]],
  ["terminalOnlyRemote", ["terminalOnlyRemote", "terminalRemote", "legacyTerminalRemote"]],
  ["recordingPreload", ["recordingPreload", "legacyRecordingPreload"]],
  ["fileViewerPreload", ["fileViewerPreload", "legacyFileViewerPreload"]],
];

export function createRecoveryClientFallback(input: RecoveryClientFallbackInput): RecoveryClientFallback {
  const origin = canonicalSessionOrigin(input.origin);
  const bundleId = input.bundleId;
  if (bundleId !== undefined && !BUNDLE_ID.test(bundleId)) throw new TypeError("recovery bundle id is invalid");
  return Object.freeze({
    mode: "direct-server-bundle",
    origin,
    entryPath: "/",
    ...(bundleId === undefined ? {} : { bundleId }),
    requiresHostShell: false,
    authority: "server",
    reason: "host-shell-unavailable",
  });
}

/** Build a bounded cleanup report from legacy host metadata. */
export function inspectCompatibilityAdapterCleanup(sourceInput: unknown): CompatibilityAdapterCleanupReport {
  const source = asRecord(sourceInput);
  const container = asRecord(source?.legacyAdapters) ?? asRecord(source?.adapters) ?? source;
  const adapters = ADAPTERS.map(([name, aliases]) => {
    const key = aliases.find((candidate) => container?.[candidate] !== undefined);
    const raw = key === undefined ? undefined : container?.[key];
    const present = raw !== undefined && raw !== false && !(isRecord(raw) && raw.present === false);
    return present
      ? { name, present: true, authority: "compatibility-adapter" as const, cleanup: "retain-until-parity" as const, reason: "server-client-parity-not-proven" as const }
      : { name, present: false, authority: "server" as const, cleanup: "not-present" as const, reason: "not-present" as const };
  });
  return Object.freeze({ adapters: Object.freeze(adapters), pendingCount: adapters.filter((adapter) => adapter.present).length, serverAuthorityReady: false });
}

function canonicalSessionOrigin(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new TypeError("recovery origin is invalid");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TypeError("recovery origin is invalid"); }
  const loopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) throw new TypeError("recovery origin must use HTTPS or loopback HTTP");
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new TypeError("recovery origin must be a credential-free origin");
  return parsed.origin;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
