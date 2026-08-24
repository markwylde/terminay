import { EXTENSION_LIMITS } from "./constants.js";
import type { AgentJsonlSession, AgentJsonlSessionOptions, AgentLifecycleEvent } from "./types.js";
import { validateAgentChildJournalSources, validateAgentLifecycleEvent } from "./validation.js";

/** Creates a host-driven JSONL session declaration without starting I/O itself. */
export function jsonlSession(options: AgentJsonlSessionOptions): AgentJsonlSession {
  if (options.childSources !== undefined) {
    const result = validateAgentChildJournalSources(options.childSources);
    if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return { state: "bound", ...options };
}

/** Returns a display-safe string or `undefined`; it never truncates identity values. */
export function safeAgentString(value: unknown, maximum = EXTENSION_LIMITS.stringLength): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

export interface AgentMapping<T> {
  /** Provider major/minor version represented by this mapping. */
  providerVersion: string;
  value: T;
}

/** Selects the greatest known mapping no newer than the provider version. */
export function selectAgentMapping<T>(mappings: readonly AgentMapping<T>[], providerVersion: string): T | undefined {
  if (mappings.length === 0) return undefined;
  const ordered = [...mappings].sort((left, right) => compareVersions(left.providerVersion, right.providerVersion));
  const requested = parseVersion(providerVersion);
  if (requested === undefined) return ordered[ordered.length - 1]!.value;
  let selected = ordered[0]!;
  for (const candidate of ordered) {
    const candidateVersion = parseVersion(candidate.providerVersion);
    if (candidateVersion !== undefined && compareParsedVersions(candidateVersion, requested) <= 0) selected = candidate;
  }
  return selected.value;
}

type ParsedVersion = readonly [number, number, number];
function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value.trim());
  if (!match) return undefined;
  const parsed: ParsedVersion = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
  return parsed.every(Number.isSafeInteger) ? parsed : undefined;
}
function compareVersions(left: string, right: string): number {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  if (leftParsed === undefined) return rightParsed === undefined ? 0 : 1;
  if (rightParsed === undefined) return -1;
  return compareParsedVersions(leftParsed, rightParsed);
}
function compareParsedVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < left.length; index++) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface JsonlRecordDecoder {
  push(chunk: Uint8Array, reset?: boolean): unknown[];
  reset(): void;
}

/** Bounded UTF-8 JSONL decoder; reset on truncate or replacement. */
export function createJsonlRecordDecoder(maxRecordBytes = EXTENSION_LIMITS.agentRecordBytes): JsonlRecordDecoder {
  const maximum = Math.max(1, Math.min(maxRecordBytes, EXTENSION_LIMITS.agentRecordBytes));
  const decoder = new TextDecoder();
  let pending = "";
  return {
    push(chunk, reset = false): unknown[] {
      if (reset) pending = "";
      if (chunk.byteLength > EXTENSION_LIMITS.agentFollowChunkBytes) return [];
      pending += decoder.decode(chunk, { stream: true });
      if (pending.length > maximum * 2) { pending = ""; return []; }
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      const records: unknown[] = [];
      for (const line of lines) {
        if (line.length === 0 || line.length > maximum) continue;
        try { records.push(JSON.parse(line)); } catch { /* provider-private malformed input */ }
      }
      return records;
    },
    reset(): void { pending = ""; },
  };
}

/** Throws before an invalid event is sent to the host. */
export function assertAgentLifecycleEvent(value: unknown): AgentLifecycleEvent {
  const result = validateAgentLifecycleEvent(value);
  if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return result.value;
}
