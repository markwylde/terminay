import { EXTENSION_LIMITS } from "./constants.js";
import type { AgentJsonlSession, AgentJsonlSessionOptions, AgentLifecycleEvent } from "./types.js";
import { validateAgentChildJournalSources, validateAgentLifecycleEvent } from "./validation.js";

/** Creates a host-driven JSONL session declaration without starting I/O itself. */
export function jsonlSession(options: AgentJsonlSessionOptions): AgentJsonlSession {
  if (options.childSources !== undefined) {
    const result = validateAgentChildJournalSources(options.childSources);
    if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  if (options.childSourceDiscovery !== undefined && typeof (options.childSourceDiscovery as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function" && !(options.childSourceDiscovery instanceof Promise)) {
    throw new Error("childSourceDiscovery: expected an async iterable or promise");
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
  let decoder = new TextDecoder();
  let pending: number[] = [];
  let discarding = false;
  const clear = (): void => { decoder = new TextDecoder(); pending = []; discarding = false; };
  return {
    push(chunk, reset = false): unknown[] {
      if (reset) clear();
      if (chunk.byteLength > EXTENSION_LIMITS.agentFollowChunkBytes) return [];
      const records: unknown[] = [];
      for (const byte of chunk) {
        if (byte === 0x0a) {
          if (!discarding && pending.length > 0) {
            const line = decoder.decode(Uint8Array.from(pending));
            try { records.push(JSON.parse(line)); } catch { /* provider-private malformed input */ }
          }
          decoder = new TextDecoder(); pending = []; discarding = false;
          continue;
        }
        if (discarding) continue;
        pending.push(byte);
        if (pending.length > maximum) { pending = []; discarding = true; }
      }
      return records;
    },
    reset: clear,
  };
}

/** Throws before an invalid event is sent to the host. */
export function assertAgentLifecycleEvent(value: unknown): AgentLifecycleEvent {
  const result = validateAgentLifecycleEvent(value);
  if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return result.value;
}

/** Creates a validating publisher for canonical provider-neutral lifecycle events. */
export function createAgentLifecyclePublisher(
  sink: (event: AgentLifecycleEvent) => void | Promise<void>,
): import("./types.js").AgentLifecyclePublisher {
  const emit = (event: AgentLifecycleEvent): void | Promise<void> => sink(assertAgentLifecycleEvent(event));
  return {
    sessionStarted: (event) => emit({ kind: "session.started", ...event }),
    metadataChanged: (event) => emit({ kind: "agent.metadata", ...event }),
    turnStarted: (event) => emit({ kind: "turn.started", ...event }),
    toolStarted: (event) => emit({ kind: "tool.started", ...event }),
    toolFinished: (event) => emit({ kind: "tool.finished", ...event }),
    waitStarted: (event) => emit({ kind: "wait.started", ...event }),
    waitFinished: (event) => emit({ kind: "wait.finished", ...event }),
    done: (event) => emit({ kind: "agent.done", ...event }),
    exited: (event) => emit({ kind: "agent.exited", ...event }),
    sessionStopped: (event) => emit({ kind: "session.stopped", ...event }),
    subagentStarted: (event) => emit({ kind: "subagent.started", ...event }),
    subagentDone: (event) => emit({ kind: "subagent.done", ...event }),
  };
}
