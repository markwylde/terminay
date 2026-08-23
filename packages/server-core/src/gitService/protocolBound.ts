import {
  DEFAULT_PROTOCOL_LIMITS,
  encodeCanonicalJson,
  type JsonValue,
  type ProtocolLimits,
} from "@terminay/protocol";

const PROBE_QUERY_ID = "g".repeat(128);

export function boundGitQueryResult(
  result: JsonValue,
  limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS,
): JsonValue {
  if (gitQueryResultFits(result, limits.maxHeaderBytes)) return result;
  if (!isRecord(result)) return result;
  if (Array.isArray(result.worktrees)) return boundWorktreeList(result, limits.maxHeaderBytes);
  if (Array.isArray(result.entries)) return boundStatusEntries(result, limits.maxHeaderBytes);
  return result;
}

export function gitQueryResultFits(
  result: JsonValue,
  maxHeaderBytes: number = DEFAULT_PROTOCOL_LIMITS.maxHeaderBytes,
): boolean {
  return queryResultHeaderBytes(result) <= maxHeaderBytes;
}

export function queryResultHeaderBytes(result: JsonValue): number {
  return encodeCanonicalJson({
    type: "query_result",
    queryId: PROBE_QUERY_ID,
    ok: true,
    result,
  }).byteLength;
}

function boundWorktreeList(
  result: { readonly [key: string]: JsonValue },
  maxHeaderBytes: number,
): JsonValue {
  const worktrees = Array.isArray(result.worktrees) ? result.worktrees : [];
  const cloned = worktrees.map((worktree) => {
    if (!isRecord(worktree) || !Array.isArray(worktree.entries)) return worktree;
    return { ...worktree, entries: [...worktree.entries] };
  });
  let totalEntries = 0;
  for (const worktree of cloned) {
    if (!isRecord(worktree) || !Array.isArray(worktree.entries)) continue;
    totalEntries += worktree.entries.length;
  }

  const withCap = (cap: number, bounded: boolean): JsonValue => {
    let remaining = cap;
    const nextWorktrees = cloned.map((worktree) => {
      if (!isRecord(worktree) || !Array.isArray(worktree.entries)) return worktree;
      const take = Math.min(worktree.entries.length, remaining);
      remaining -= take;
      return { ...worktree, entries: worktree.entries.slice(0, take) };
    });
    return { ...result, worktrees: nextWorktrees, bounded: bounded || result.bounded === true };
  };

  let candidate = withCap(0, true);
  if (!gitQueryResultFits(candidate, maxHeaderBytes)) {
    const kept = cloned.map((worktree) => (isRecord(worktree) ? { ...worktree, entries: [] } : worktree));
    while (kept.length > 1) {
      kept.pop();
      candidate = { ...result, worktrees: kept, bounded: true };
      if (gitQueryResultFits(candidate, maxHeaderBytes)) break;
    }
    return candidate;
  }

  let lo = 0;
  let hi = totalEntries;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    candidate = withCap(mid, mid < totalEntries);
    if (gitQueryResultFits(candidate, maxHeaderBytes)) lo = mid;
    else hi = mid - 1;
  }
  return withCap(lo, lo < totalEntries || result.bounded === true);
}

function boundStatusEntries(
  result: { readonly [key: string]: JsonValue },
  maxHeaderBytes: number,
): JsonValue {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const withCap = (cap: number, bounded: boolean): JsonValue => ({
    ...result,
    entries: entries.slice(0, cap),
    bounded: bounded || result.bounded === true,
  });
  if (!gitQueryResultFits(withCap(0, true), maxHeaderBytes)) return withCap(0, true);
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (gitQueryResultFits(withCap(mid, mid < entries.length), maxHeaderBytes)) lo = mid;
    else hi = mid - 1;
  }
  return withCap(lo, lo < entries.length || result.bounded === true);
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
