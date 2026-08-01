import type {
  GitBranchStatus,
  GitChangeKind,
  GitDiffFile,
  GitDiffHunk,
  GitDiffLine,
  GitStatusEntry,
  GitWorktreeState,
} from "./types.js";

const UNMERGED_STATUS_PAIRS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export interface ParsedStatus {
  readonly branch: GitBranchStatus;
  readonly entries: readonly GitStatusEntry[];
  readonly bounded: boolean;
}

export interface ParsedDiff {
  readonly files: readonly GitDiffFile[];
  readonly hunks: readonly GitDiffHunk[];
  readonly binary: boolean;
  readonly bounded: boolean;
}

export interface ParsedWorktree {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly isBare: boolean;
  readonly isPrunable: boolean;
  readonly locked: boolean;
}

export function parseStatus(output: string, maxEntries: number): ParsedStatus {
  const fields = output.split("\0");
  const branchField = fields.shift() ?? "";
  const branch = parseBranchHeader(branchField.startsWith("## ") ? branchField.slice(3) : branchField);
  const entries: GitStatusEntry[] = [];
  let bounded = false;

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === undefined || field.length === 0) continue;
    if (field.length < 3 || field[2] !== " ") continue;
    const indexStatus = field[0] ?? " ";
    const worktreeStatus = field[1] ?? " ";
    const firstPath = field.slice(3);
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") {
      const nextPath = fields[index + 1];
      if (nextPath !== undefined && nextPath.length > 0) {
        index += 1;
        // Git's -z format places the destination first and preimage second.
        // Treating these as opaque relative paths also avoids decoding names.
        entries.push(makeStatusEntry(firstPath, nextPath, indexStatus, worktreeStatus));
      } else {
        entries.push(makeStatusEntry(firstPath, null, indexStatus, worktreeStatus));
      }
    } else {
      entries.push(makeStatusEntry(firstPath, null, indexStatus, worktreeStatus));
    }
    if (entries.length >= maxEntries) {
      bounded = fields.slice(index + 1).some((value) => value.length > 0);
      break;
    }
  }

  return { branch, entries, bounded };
}

export function parseBranchHeader(header: string): GitBranchStatus {
  const trimmed = header.trim();
  let name: string | null = null;
  let detached = false;
  let upstream: string | null = null;
  let upstreamState: GitBranchStatus["upstreamState"] = "none";
  let ahead: number | null = null;
  let behind: number | null = null;

  if (/^HEAD \(no branch\)$/u.test(trimmed) || /^HEAD \(detached/u.test(trimmed)) {
    detached = true;
  } else {
    const noCommit = /^No commits yet on (.+)$/u.exec(trimmed);
    const trackingMatch = /^(.*?)(?: \[(.*)\])?$/u.exec(trimmed);
    const tracking = trackingMatch?.[2] ?? "";
    const branchAndRemote = trackingMatch?.[1] ?? trimmed;
    const separator = branchAndRemote.indexOf("...");
    const branchName = separator < 0 ? branchAndRemote : branchAndRemote.slice(0, separator);
    const remoteName = separator < 0 ? null : branchAndRemote.slice(separator + 3);
    if (noCommit !== null) {
      name = noCommit[1] ?? null;
    } else if (branchName.length > 0) {
      name = branchName;
      upstream = remoteName;
      upstreamState = remoteName === null ? "none" : tracking.includes("gone") ? "missing" : "configured";
      const aheadMatch = /ahead (\d+)/u.exec(tracking);
      const behindMatch = /behind (\d+)/u.exec(tracking);
      ahead = aheadMatch === null ? null : Number.parseInt(aheadMatch[1] ?? "", 10);
      behind = behindMatch === null ? null : Number.parseInt(behindMatch[1] ?? "", 10);
    } else if (trimmed.length > 0) {
      name = trimmed;
    }
  }

  return { name, detached, head: null, upstream, upstreamState, ahead, behind };
}

function makeStatusEntry(path: string, previousPath: string | null, indexStatus: string, worktreeStatus: string): GitStatusEntry {
  // Porcelain's unmerged states are the exact two-letter combinations below.
  // A plain staged/unstaged deletion (D  or  D) is not a conflict.
  const unmerged = isUnmergedStatus(indexStatus, worktreeStatus);
  const kind = statusKind(indexStatus, worktreeStatus, unmerged);
  return {
    path,
    previousPath,
    indexStatus,
    worktreeStatus,
    kind,
    staged: indexStatus !== " " && indexStatus !== "?",
    unstaged: worktreeStatus !== " " && worktreeStatus !== "?",
    unmerged,
  };
}

function isUnmergedStatus(indexStatus: string, worktreeStatus: string): boolean {
  return UNMERGED_STATUS_PAIRS.has(`${indexStatus}${worktreeStatus}`);
}

function statusKind(indexStatus: string, worktreeStatus: string, unmerged: boolean): GitChangeKind {
  if (unmerged) return "unmerged";
  if (indexStatus === "?" && worktreeStatus === "?") return "untracked";
  if (indexStatus === "R" || worktreeStatus === "R") return "renamed";
  if (indexStatus === "C" || worktreeStatus === "C") return "copied";
  if (indexStatus === "A" || worktreeStatus === "A") return "added";
  if (indexStatus === "D" || worktreeStatus === "D") return "deleted";
  if (indexStatus === "M" || worktreeStatus === "M") return "modified";
  return "unknown";
}

export function parseWorktreeList(output: string): ParsedWorktree[] {
  const records: ParsedWorktree[] = [];
  let current: {
    path?: string;
    head?: string;
    branch?: string;
    detached?: boolean;
    bare?: boolean;
    prunable?: boolean;
    locked?: boolean;
  } = {};

  const flush = () => {
    if (current.path === undefined) {
      current = {};
      return;
    }
    records.push({
      path: current.path,
      head: current.head ?? null,
      branch: current.branch ?? null,
      detached: current.detached ?? false,
      isBare: current.bare ?? false,
      isPrunable: current.prunable ?? false,
      locked: current.locked ?? false,
    });
    current = {};
  };

  for (const line of output.split(/\r?\n/u)) {
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) current.path = line.slice("worktree ".length);
    else if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).replace(/^refs\/heads\//u, "");
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
    else if (line.startsWith("prunable")) current.prunable = true;
    else if (line.startsWith("locked")) current.locked = true;
  }
  flush();
  return records;
}

export function parseDiff(patch: string, limits: { maxHunks: number; maxLines: number; maxLineBytes: number }): ParsedDiff {
  const hunks: GitDiffHunk[] = [];
  const files: GitDiffFile[] = [];
  let currentHunk: { header: string; lines: GitDiffLine[] } | null = null;
  let currentFile: { path: string; previousPath: string | null; additions: number; deletions: number; binary: boolean } | null = null;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let lineCount = 0;
  let bounded = false;
  let binary = false;

  const flushFile = () => {
    if (currentFile !== null) files.push({ ...currentFile });
  };

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      flushFile();
      currentHunk = null;
      const names = parseDiffNames(line.slice("diff --git ".length));
      currentFile = { path: names.path, previousPath: names.previousPath, additions: 0, deletions: 0, binary: false };
      continue;
    }
    if (currentFile === null) continue;
    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      currentFile.binary = true;
      binary = true;
      continue;
    }
    if (line.startsWith("rename from ")) {
      currentFile.previousPath = line.slice("rename from ".length);
      continue;
    }
    if (line.startsWith("rename to ")) {
      currentFile.path = line.slice("rename to ".length);
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
      if (match === null) continue;
      if (hunks.length >= limits.maxHunks) {
        bounded = true;
        break;
      }
      oldLineNumber = Number.parseInt(match[1] ?? "0", 10);
      newLineNumber = Number.parseInt(match[3] ?? "0", 10);
      currentHunk = { header: line, lines: [] };
      hunks.push(currentHunk);
      continue;
    }
    if (currentHunk === null || line.startsWith("\\")) continue;
    if (new TextEncoder().encode(line).byteLength > limits.maxLineBytes) {
      bounded = true;
      break;
    }
    let normalized: GitDiffLine | null = null;
    if (line.startsWith("+")) {
      normalized = { newLineNumber, oldLineNumber: null, type: "add", value: line.slice(1) };
      newLineNumber += 1;
      currentFile.additions += 1;
    } else if (line.startsWith("-")) {
      normalized = { newLineNumber: null, oldLineNumber, type: "delete", value: line.slice(1) };
      oldLineNumber += 1;
      currentFile.deletions += 1;
    } else if (line.startsWith(" ")) {
      normalized = { newLineNumber, oldLineNumber, type: "context", value: line.slice(1) };
      oldLineNumber += 1;
      newLineNumber += 1;
    }
    if (normalized === null) continue;
    lineCount += 1;
    if (lineCount > limits.maxLines) {
      bounded = true;
      break;
    }
    currentHunk.lines.push(normalized);
  }
  flushFile();
  return { files, hunks, binary, bounded };
}

function parseDiffNames(value: string): { path: string; previousPath: string | null } {
  const separator = value.indexOf(" b/");
  if (separator < 0) return { path: value.replace(/^b\//u, ""), previousPath: null };
  const previousPath = value.slice(2, separator);
  const path = value.slice(separator + 3);
  return {
    previousPath: previousPath === path ? null : previousPath,
    path,
  };
}

export function worktreeState(entries: readonly GitStatusEntry[], detached: boolean, prunable: boolean): GitWorktreeState {
  if (prunable) return "prunable";
  if (entries.some((entry) => entry.unmerged)) return "unmerged";
  if (entries.length > 0) return "dirty";
  if (detached) return "detached";
  return "clean";
}
