import type { JsonValue } from "@terminay/protocol";

export interface SupportBundleInput {
  readonly serverId: string;
  readonly version: string;
  readonly phase: string;
  readonly generatedAt?: number;
  readonly health?: Record<string, unknown>;
  readonly logs?: readonly string[];
}

export interface SupportBundleOptions {
  /** Logs are excluded unless the caller explicitly opts in. */
  readonly includeLogs?: boolean;
  readonly maxLogLines?: number;
  readonly maxBytes?: number;
}

export interface SupportBundle {
  readonly schemaVersion: 1;
  readonly generatedAt: number;
  readonly diagnostics: {
    readonly serverId: string;
    readonly version: string;
    readonly phase: string;
    readonly health: Readonly<Record<string, JsonValue>>;
  };
  readonly logs?: readonly string[];
}

/** Build a local-only, opt-in diagnostic artifact. It accepts only bounded
 * health/log data and redacts credential-like values before serialization. */
export function createSupportBundle(input: SupportBundleInput, options: SupportBundleOptions = {}): SupportBundle {
  assertShort(input.serverId, "serverId");
  assertShort(input.version, "version");
  assertShort(input.phase, "phase");
  const maxBytes = positiveLimit(options.maxBytes ?? 512 * 1024, "maxBytes");
  const maxLogLines = positiveLimit(options.maxLogLines ?? 500, "maxLogLines");
  const generatedAt = input.generatedAt ?? Date.now();
  if (!Number.isFinite(generatedAt) || generatedAt < 0) throw new TypeError("generatedAt is invalid");
  const diagnostics = {
    serverId: input.serverId,
    version: input.version,
    phase: input.phase,
    health: redactObject(input.health ?? {}, 0),
  } as const;
  const logs = options.includeLogs === true
    ? Object.freeze((input.logs ?? []).slice(0, maxLogLines).map((line) => redactText(line).slice(0, 4096)))
    : undefined;
  const bundle = Object.freeze({
    schemaVersion: 1 as const,
    generatedAt,
    diagnostics,
    ...(logs === undefined ? {} : { logs }),
  });
  const encoded = JSON.stringify(bundle);
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new RangeError("support bundle exceeds configured size");
  return bundle;
}

function redactObject(value: unknown, depth: number): Record<string, JsonValue> {
  if (depth > 4 || typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) continue;
    if (typeof child === "string") result[key] = redactText(child).slice(0, 2048);
    else if (typeof child === "number" || typeof child === "boolean" || child === null) result[key] = child;
    else if (Array.isArray(child)) result[key] = child.slice(0, 32).map((item) => typeof item === "string" ? redactText(item).slice(0, 512) : null);
    else result[key] = redactObject(child, depth + 1);
  }
  return result;
}

function redactText(value: string): string {
  if (typeof value !== "string") return "[redacted]";
  return value
    .replace(/((?:token|secret|password|passphrase|private[_-]?key|api[_-]?key|grant|proof)[=:]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]");
}

function isSecretKey(key: string): boolean {
  return /(?:token|secret|password|passphrase|private[_-]?key|api[_-]?key|grant|proof|credential)/iu.test(key);
}

function assertShort(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0")) throw new TypeError(`${name} is invalid`);
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
