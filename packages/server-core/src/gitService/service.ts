import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import {
  DEFAULT_GIT_SERVICE_LIMITS,
  GitServiceError,
  type GitBranchResult,
  type GitBranchStatus,
  type GitCommandResult,
  type GitCommandRunner,
  type GitDiffResult,
  type GitDiscoveryState,
  type GitErrorInfo,
  type GitPathAdapter,
  type GitProjectBinding,
  type GitReadOnlyRequest,
  type GitRepositoryId,
  type GitServiceOptions,
  type GitServiceLimits,
  type GitServiceEvent,
  type GitServiceListener,
  type GitServiceReplay,
  type GitServiceOperation,
  type GitProgressPhase,
  type GitStatusChangeEvent,
  type GitStatusResult,
  type GitWorktreeId,
  type GitWorktreeListResult,
  type GitWorktreeRemoveRequest,
  type GitWorktreeRemoveResult,
  type GitWorktreeMoveRequest,
  type GitWorktreeMoveResult,
  type GitWorktreePullRequest,
  type GitWorktreePullResult,
  type GitWorktreeSummary,
} from "./types.js";
import { NodeGitCommandRunner } from "./runner.js";
import { parseDiff, parseStatus, parseWorktreeList, worktreeState } from "./parse.js";

export class NodeGitPathAdapter implements GitPathAdapter {
  realpath(path: string): Promise<string> { return realpath(path); }
  async stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean }> {
    const result = await stat(path);
    return { isDirectory: result.isDirectory(), isFile: result.isFile() };
  }
}

type GitTargetRequest = Omit<GitReadOnlyRequest, "operation">;
type GitStatusPollTimer = ReturnType<typeof setTimeout>;

interface Discovery {
  readonly state: GitDiscoveryState;
  readonly repositoryId: GitRepositoryId | null;
  readonly repositoryRoot: string | null;
  readonly worktreeId: GitWorktreeId | null;
  readonly worktreeRoot: string | null;
  readonly error?: GitErrorInfo;
}

interface NumstatDelta {
  readonly additions: number;
  readonly deletions: number;
  readonly hasChanges: boolean;
}

/**
 * Server-owned, read-only Git operations. Every command is selected by this
 * class, receives a canonical project/worktree cwd, and uses a bounded runner.
 * There is intentionally no method accepting an arbitrary executable or cwd.
 */
export class GitService {
  private readonly runner: GitCommandRunner;
  private readonly pathAdapter: GitPathAdapter;
  private readonly limits: Required<GitServiceLimits>;
  private readonly statusPollIntervalMs: number | false;
  private readonly bindings = new Map<string, GitProjectBinding>();
  private readonly listeners = new Set<GitServiceListener>();
  private readonly worktreeMutations = new Set<string>();
  private readonly events: GitServiceEvent[] = [];
  private readonly maxEvents: number;
  private readonly statusPollTimers = new Map<string, GitStatusPollTimer>();
  private revisionValue = 0;
  private readonly statusFingerprints = new Map<string, string>();
  private closed = false;

  constructor(options: GitServiceOptions = {}) {
    this.runner = options.runner ?? new NodeGitCommandRunner();
    this.pathAdapter = options.pathAdapter ?? new NodeGitPathAdapter();
    this.limits = { ...DEFAULT_GIT_SERVICE_LIMITS, ...options.limits };
    validateLimits(this.limits);
    this.maxEvents = options.maxEvents ?? 1024;
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents <= 0) throw new RangeError("maxEvents must be positive");
    this.statusPollIntervalMs = options.statusPollIntervalMs ?? 10_000;
    if (this.statusPollIntervalMs !== false && (!Number.isSafeInteger(this.statusPollIntervalMs) || this.statusPollIntervalMs < 1_000 || this.statusPollIntervalMs > 300_000)) throw new RangeError("statusPollIntervalMs must be false or between 1000 and 300000");
  }

  get revision(): number { return this.revisionValue; }

  subscribe(listener: GitServiceListener): () => void {
    if (typeof listener !== "function") throw new TypeError("Git event listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replay(afterRevision = 0): GitServiceReplay {
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0 || afterRevision > this.revisionValue) throw new RangeError("Git replay revision is invalid");
    const oldest = this.events[0]?.revision;
    if (oldest !== undefined && afterRevision < oldest - 1) return { kind: "resync", events: [] };
    return { kind: "events", events: this.events.filter((event) => event.revision > afterRevision) };
  }

  /** Canonicalize and bind one server-owned workspace project. */
  async bindProject(projectId: string, projectRoot: string, signal?: AbortSignal): Promise<GitProjectBinding> {
    validateProjectId(projectId);
    const canonicalRoot = await this.canonicalDirectory(projectRoot);
    const discovered = await this.discover(canonicalRoot, signal);
    const binding: GitProjectBinding = {
      projectId,
      projectRoot: canonicalRoot,
      repositoryId: discovered.repositoryId,
      repositoryRoot: discovered.repositoryRoot,
      worktreeId: discovered.worktreeId,
      worktreeRoot: discovered.worktreeRoot,
      state: discovered.state,
    };
    this.bindings.set(projectId, binding);
    this.startStatusPoll(projectId);
    return binding;
  }

  unbindProject(projectId: string): boolean {
    this.stopStatusPoll(projectId);
    return this.bindings.delete(projectId);
  }

  close(): void {
    this.closed = true;
    for (const projectId of [...this.statusPollTimers.keys()]) this.stopStatusPoll(projectId);
    this.listeners.clear();
  }

  getBinding(projectId: string): GitProjectBinding | undefined { return this.bindings.get(projectId); }

  async status(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitStatusResult> {
    const target = normalizeTarget(request, signal);
    const discovery = await this.resolveDiscovery(target);
    this.publishProgress("status", "started", target.projectId, discovery.repositoryId, discovery.worktreeId, discovery.state, false);
    const empty = this.emptyStatus(target.projectId, discovery);
    let status: GitStatusResult = empty;
    if (discovery.state === "ready" && discovery.worktreeRoot !== null) {
      const result = await this.runGit(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all", "--ignored=no"], discovery.worktreeRoot, target.signal);
      if (result.exitCode !== 0 || result.truncated) {
        status = {
          ...empty,
          state: "command-error",
          bounded: result.truncated,
          error: commandError("status", result, result.truncated ? "Git status output exceeded the configured limit." : "Git status failed."),
        };
      } else {
        const parsed = parseStatus(result.stdout, this.limits.maxStatusEntries);
        const head = await this.readHead(discovery.worktreeRoot, target.signal);
        const branch: GitBranchStatus = { ...parsed.branch, head };
        status = {
          ...empty,
          state: "ready",
          branch,
          entries: parsed.entries,
          head,
          bounded: parsed.bounded,
        };
      }
    }
    this.publishProgress("status", status.state === "ready" ? "completed" : "failed", target.projectId, status.repositoryId, status.worktreeId, status.state, status.bounded);
    this.publishStatusChange(status);
    return status;
  }

  async branch(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitBranchResult> {
    const status = await this.status(request, signal);
    return { ...status, operation: "branch" };
  }

  getStatus(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitStatusResult> {
    return this.status(request, signal);
  }

  getBranch(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitBranchResult> {
    return this.branch(request, signal);
  }

  async diff(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitDiffResult> {
    const target = normalizeTarget(request, signal);
    const discovery = await this.resolveDiscovery(target);
    const empty: GitDiffResult = {
      projectId: target.projectId,
      repositoryId: discovery.repositoryId,
      worktreeId: discovery.worktreeId,
      state: discovery.state,
      compareTarget: "HEAD",
      path: target.path ?? null,
      files: [],
      hunks: [],
      patch: "",
      binary: false,
      bounded: false,
      ...(discovery.error === undefined ? {} : { error: discovery.error }),
    };
    if (discovery.state !== "ready" || discovery.worktreeRoot === null) return empty;
    const path = target.path === undefined ? undefined : await this.resolveProjectRelativePath(target.path, discovery.worktreeRoot, target.projectId);
    const args = ["diff", "--no-ext-diff", "--binary", "--unified=3", "HEAD", "--", ...(path === undefined ? [] : [path])];
    const result = await this.runGit(args, discovery.worktreeRoot, target.signal, this.limits.maxDiffBytes);
    if (result.exitCode !== 0 || result.truncated) {
      return {
        ...empty,
        state: "command-error",
        patch: result.stdout,
        bounded: result.truncated,
        error: commandError("diff", result, result.truncated ? "Git diff output exceeded the configured limit." : "Git diff failed."),
      };
    }
    const patch = truncateUtf8(result.stdout, this.limits.maxDiffBytes);
    const parsed = parseDiff(patch, {
      maxHunks: this.limits.maxDiffHunks,
      maxLines: this.limits.maxDiffLines,
      maxLineBytes: this.limits.maxDiffLineBytes,
    });
    const bounded = result.truncated || parsed.bounded || patch.length !== result.stdout.length;
    return { ...empty, state: "ready", files: parsed.files, hunks: parsed.hunks, patch, binary: parsed.binary, bounded };
  }

  getDiff(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitDiffResult> {
    return this.diff(request, signal);
  }

  async worktrees(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitWorktreeListResult> {
    const target = normalizeTarget(request, signal);
    const discovery = await this.resolveDiscovery(target);
    const empty: GitWorktreeListResult = {
      projectId: target.projectId,
      repositoryId: discovery.repositoryId,
      repositoryRoot: discovery.repositoryRoot,
      defaultBranch: null,
      state: discovery.state,
      worktrees: [],
      bounded: false,
      ...(discovery.error === undefined ? {} : { error: discovery.error }),
    };
    if (discovery.state !== "ready" || discovery.repositoryRoot === null) return empty;
    const result = await this.runGit(["worktree", "list", "--porcelain"], discovery.worktreeRoot ?? discovery.repositoryRoot, target.signal);
    if (result.exitCode !== 0 || result.truncated) {
      return { ...empty, state: "command-error", bounded: result.truncated, error: commandError("worktrees", result, result.truncated ? "Git worktree output exceeded the configured limit." : "Git worktree list failed.") };
    }
    const records = parseWorktreeList(result.stdout);
    const bounded = records.length > this.limits.maxWorktrees;
    const selected = records.slice(0, this.limits.maxWorktrees);
    const defaultBranch = await this.defaultBranch(discovery.repositoryRoot, target.signal);
    const mainPath = records.find((record) => !record.isBare)?.path;
    const summaries: GitWorktreeSummary[] = [];
    for (const record of selected) {
      const canonicalPath = await this.canonicalWorktreePath(record.path);
      const id = worktreeId(discovery.repositoryId as GitRepositoryId, canonicalPath);
      let entries: readonly import("./types.js").GitStatusEntry[] = [];
      let error: GitErrorInfo | undefined;
      let statusBounded = false;
      let branch: GitBranchStatus = { name: record.branch, detached: record.detached, head: record.head, upstream: null, upstreamState: "none", ahead: null, behind: null };
      let state = worktreeState(entries, record.detached, record.isPrunable);
      let aheadOfDefaultBranchCount: number | null = null;
      let lineAdditions: number | null = null;
      let lineDeletions: number | null = null;
      let hasCommittedChanges: boolean | null = null;
      let discoveryState: GitDiscoveryState = "ready";
      if (!record.isBare && !record.isPrunable) {
        const statusResult = await this.runGit(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all", "--ignored=no"], record.path, target.signal);
        if (statusResult.exitCode === 0 && !statusResult.truncated) {
          const parsed = parseStatus(statusResult.stdout, this.limits.maxStatusEntries);
          entries = parsed.entries;
          statusBounded = parsed.bounded;
          branch = { ...parsed.branch, name: parsed.branch.name ?? record.branch, detached: parsed.branch.detached || record.detached, head: record.head };
          state = worktreeState(entries, parsed.branch.detached || record.detached, false);
          const delta = await this.worktreeDelta(record.path, defaultBranch, target.signal);
          aheadOfDefaultBranchCount = delta.aheadCount;
          lineAdditions = delta.additions;
          lineDeletions = delta.deletions;
          hasCommittedChanges = delta.hasCommittedChanges;
        } else {
          state = "unknown";
          discoveryState = "command-error";
          statusBounded = statusResult.truncated;
          error = commandError("status", statusResult, statusResult.truncated ? "Worktree status output exceeded the configured limit." : "Worktree status failed.");
        }
      }
      const summary = {
        id,
        repositoryId: discovery.repositoryId as GitRepositoryId,
        path: canonicalPath,
        branch: record.branch,
        detached: record.detached,
        head: record.head,
        isMain: mainPath !== undefined && samePath(mainPath, record.path),
        isBare: record.isBare,
        isPrunable: record.isPrunable,
        locked: record.locked,
        state,
        aheadOfDefaultBranchCount,
        lineAdditions,
        lineDeletions,
        hasCommittedChanges,
        entries,
        ...(error === undefined ? {} : { error }),
      } satisfies GitWorktreeSummary;
      summaries.push(summary);
      this.publishStatusChange({
        projectId: target.projectId,
        repositoryId: discovery.repositoryId,
        repositoryRoot: discovery.repositoryRoot,
        worktreeId: id,
        worktreeRoot: canonicalPath,
        state: discoveryState,
        branch,
        entries,
        head: record.head,
        bounded: statusBounded,
        ...(error === undefined ? {} : { error }),
      });
    }
    return { ...empty, state: "ready", defaultBranch, worktrees: summaries, bounded };
  }

  listWorktrees(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitWorktreeListResult> {
    return this.worktrees(request, signal);
  }

  async moveWorktree(request: GitWorktreeMoveRequest): Promise<GitWorktreeMoveResult> {
    validateProjectId(request.projectId);
    const name = validateWorktreeDirectoryName(request.name);
    const mutationKey = `${request.projectId}\0${request.repositoryId}\0${request.worktreeId}`;
    if (this.worktreeMutations.has(mutationKey)) throw new GitServiceError("mutation-failed", "a worktree mutation is already in progress", { worktreeId: request.worktreeId });
    this.worktreeMutations.add(mutationKey);
    try {
      const listing = await this.worktrees({ projectId: request.projectId, repositoryId: request.repositoryId, signal: request.signal });
      const base = { operation: "move" as const, projectId: request.projectId, repositoryId: request.repositoryId, worktreeIdBefore: request.worktreeId };
      if (listing.state !== "ready" || listing.repositoryId !== request.repositoryId) return { ...base, worktreeId: request.worktreeId, applied: false, state: "command-error", headBefore: null, headAfter: null, path: null, error: listing.error ?? { code: "repository-mismatch", message: "worktree repository is no longer bound to this project", operation: "worktree.move" } };
      const selected = listing.worktrees.find((value) => value.id === request.worktreeId);
      if (selected === undefined) throw new GitServiceError("worktree-not-found", "worktree is not part of the project repository");
      if (selected.isMain || selected.isBare || selected.locked || selected.isPrunable) throw new GitServiceError("mutation-failed", "worktree cannot be moved in its current state", { worktreeId: request.worktreeId });
      if (request.expectedHead !== undefined && selected.head !== request.expectedHead) throw new GitServiceError("stale-revision", "worktree HEAD changed since the move was reviewed", { expectedHead: request.expectedHead, actualHead: selected.head });
      const fresh = await this.status({ projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, signal: request.signal });
      if (fresh.state !== "ready" || fresh.entries.length > 0) throw new GitServiceError("worktree-dirty", "refusing to move a dirty or unmerged worktree", { worktreeId: request.worktreeId });
      const destination = resolve(dirname(selected.path), name);
      if (dirname(destination) !== dirname(selected.path) || samePath(destination, selected.path)) throw new GitServiceError("mutation-failed", "worktree destination is invalid");
      if (listing.worktrees.some((value) => samePath(value.path, destination))) throw new GitServiceError("mutation-failed", "worktree destination already exists");
      if (await filesystemPathExists(destination)) throw new GitServiceError("mutation-failed", "worktree destination already exists");
      const binding = this.getBinding(request.projectId);
      const cwd = binding?.repositoryRoot ?? binding?.projectRoot;
      if (cwd === undefined) return { ...base, worktreeId: request.worktreeId, applied: false, state: "command-error", headBefore: selected.head, headAfter: selected.head, path: selected.path, error: { code: "invalid-project", message: "project is no longer bound to this server", operation: "worktree.move" } };
      const moved = await this.runGit(["worktree", "move", "--", selected.path, destination], cwd, request.signal);
      if (moved.exitCode !== 0 || moved.truncated) return { ...base, worktreeId: request.worktreeId, applied: false, state: "command-error", headBefore: selected.head, headAfter: selected.head, path: selected.path, error: commandError("worktree.move", moved, moved.truncated ? "Git worktree move exceeded the configured output limit." : "Git worktree move failed.") };
      const after = await this.worktrees({ projectId: request.projectId, repositoryId: request.repositoryId, signal: request.signal });
      const canonicalDestination = await this.canonicalWorktreePath(destination);
      const replacement = after.worktrees.find((value) => samePath(value.path, canonicalDestination));
      if (after.state !== "ready" || replacement === undefined || after.worktrees.some((value) => value.id === request.worktreeId)) return { ...base, worktreeId: request.worktreeId, applied: false, state: "command-error", headBefore: selected.head, headAfter: null, path: null, error: { code: "mutation-failed", message: "Git reported movement but canonical registration did not change", operation: "worktree.move" } };
      return { ...base, worktreeId: replacement.id, applied: true, state: "moved", headBefore: selected.head, headAfter: replacement.head, path: replacement.path };
    } finally {
      this.worktreeMutations.delete(mutationKey);
    }
  }

  /**
   * Remove a clean, non-main worktree after revalidating its server-owned
   * identity and current Git state.  The request never carries a filesystem
   * path; the path passed to Git comes from the immediately preceding
   * canonical `worktree list` result.
   */
  async removeWorktree(request: GitWorktreeRemoveRequest): Promise<GitWorktreeRemoveResult> {
    validateProjectId(request.projectId);
    const target = normalizeTarget({
      projectId: request.projectId,
      repositoryId: request.repositoryId,
      worktreeId: request.worktreeId,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const listing = await this.worktrees(target);
    const base = {
      operation: "remove" as const,
      projectId: request.projectId,
      repositoryId: request.repositoryId,
      worktreeId: request.worktreeId,
    };
    if (listing.state !== "ready" || listing.repositoryId !== request.repositoryId) {
      return {
        ...base,
        applied: false,
        state: "command-error",
        headBefore: null,
        error: listing.error ?? {
          code: "repository-mismatch",
          message: "worktree repository is no longer bound to this project",
          operation: "worktree.remove",
        },
      };
    }
    const selected = listing.worktrees.find((worktree) => worktree.id === request.worktreeId);
    if (selected === undefined) throw new GitServiceError("worktree-not-found", "worktree is not part of the project repository");
    assertRemovableWorktree(selected, request.expectedHead);

    // `worktrees` includes a status read, but perform a second status read
    // directly against the selected opaque ID immediately before mutation.
    // This closes the common stale-review window where a dirty change lands
    // after the list response was rendered to a client.
    const fresh = await this.status({
      projectId: request.projectId,
      repositoryId: request.repositoryId,
      worktreeId: request.worktreeId,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (fresh.state !== "ready") {
      return {
        ...base,
        applied: false,
        state: "command-error",
        headBefore: selected.head,
        error: fresh.error ?? { code: "mutation-failed", message: "worktree status could not be revalidated", operation: "worktree.remove" },
      };
    }
    if (fresh.entries.some((entry) => entry.unmerged || entry.unstaged || entry.staged)) {
      throw new GitServiceError("worktree-dirty", "refusing to remove a dirty or unmerged worktree", { worktreeId: request.worktreeId });
    }
    if (request.expectedHead !== undefined && selected.head !== request.expectedHead) {
      throw new GitServiceError("stale-revision", "worktree HEAD changed since the removal was reviewed", {
        worktreeId: request.worktreeId,
        expectedHead: request.expectedHead,
        actualHead: selected.head,
      });
    }

    const binding = this.getBinding(request.projectId);
    const cwd = binding?.repositoryRoot ?? binding?.projectRoot;
    if (cwd === undefined || cwd.length === 0) {
      return {
        ...base,
        applied: false,
        state: "command-error",
        headBefore: selected.head,
        error: { code: "invalid-project", message: "project is no longer bound to this server", operation: "worktree.remove" },
      };
    }
    const result = await this.runGit(["worktree", "remove", "--", selected.path], cwd, request.signal);
    if (result.exitCode !== 0 || result.truncated) {
      return {
        ...base,
        applied: false,
        state: "command-error",
        headBefore: selected.head,
        error: commandError("worktree.remove", result, result.truncated ? "Git worktree removal exceeded the configured output limit." : "Git worktree removal failed."),
      };
    }

    // Verify that the exact identity disappeared; a successful command that
    // leaves the worktree registered is reported as a deterministic failure.
    const after = await this.worktrees({ projectId: request.projectId, repositoryId: request.repositoryId });
    if (after.state !== "ready" || after.worktrees.some((worktree) => worktree.id === request.worktreeId)) {
      return {
        ...base,
        applied: false,
        state: "command-error",
        headBefore: selected.head,
        error: { code: "mutation-failed", message: "Git reported removal but the worktree is still registered", operation: "worktree.remove" },
      };
    }
    return { ...base, applied: true, state: "removed", headBefore: selected.head };
  }

  /** Pull one clean, attached worktree using its configured upstream. The
   * caller supplies only opaque identities; the canonical path is re-read
   * immediately before Git mutates it and status is verified afterwards. */
  async pullWorktree(request: GitWorktreePullRequest): Promise<GitWorktreePullResult> {
    validateProjectId(request.projectId);
    const base = { operation: "pull" as const, projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId };
    const listing = await this.worktrees({ projectId: request.projectId, repositoryId: request.repositoryId, ...(request.signal === undefined ? {} : { signal: request.signal }) });
    if (listing.state !== "ready" || listing.repositoryId !== request.repositoryId) {
      return { ...base, applied: false, state: "command-error", headBefore: null, headAfter: null, error: listing.error ?? { code: "repository-mismatch", message: "worktree repository is no longer bound to this project", operation: "worktree.pull" } };
    }
    const selected = listing.worktrees.find((worktree) => worktree.id === request.worktreeId);
    if (selected === undefined) throw new GitServiceError("worktree-not-found", "worktree is not part of the project repository");
    if (selected.isBare) throw new GitServiceError("worktree-bare", "refusing to pull a bare worktree", { worktreeId: request.worktreeId });
    if (selected.isPrunable || selected.locked) throw new GitServiceError("worktree-locked", "refusing to pull a locked or prunable worktree", { worktreeId: request.worktreeId });
    if (selected.detached || selected.branch === null) throw new GitServiceError("mutation-failed", "refusing to pull a detached worktree", { worktreeId: request.worktreeId });
    if (request.expectedHead !== undefined && request.expectedHead !== selected.head) throw new GitServiceError("stale-revision", "worktree HEAD changed since the pull was reviewed", { worktreeId: request.worktreeId, expectedHead: request.expectedHead, actualHead: selected.head });

    const fresh = await this.status({ projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, ...(request.signal === undefined ? {} : { signal: request.signal }) });
    if (fresh.state !== "ready") return { ...base, applied: false, state: "command-error", headBefore: selected.head, headAfter: fresh.head, error: fresh.error ?? { code: "mutation-failed", message: "worktree status could not be revalidated", operation: "worktree.pull" } };
    if (fresh.entries.some((entry) => entry.unmerged || entry.unstaged || entry.staged)) throw new GitServiceError("worktree-dirty", "refusing to pull a dirty or unmerged worktree", { worktreeId: request.worktreeId });
    if (!headsMatch(selected.head, fresh.head) || (request.expectedHead !== undefined && !headsMatch(request.expectedHead, fresh.head))) throw new GitServiceError("stale-revision", "worktree changed since the pull was reviewed", { worktreeId: request.worktreeId, expectedHead: request.expectedHead ?? selected.head, actualHead: fresh.head });
    if (fresh.branch.upstreamState !== "configured") return { ...base, applied: false, state: "command-error", headBefore: fresh.head, headAfter: fresh.head, error: { code: "command-error", message: fresh.branch.upstreamState === "missing" ? "worktree upstream remote is unavailable" : "worktree has no configured upstream remote", operation: "worktree.pull" } };

    const result = await this.runGit(["pull", "--ff-only"], selected.path, request.signal);
    if (result.exitCode !== 0 || result.truncated) return { ...base, applied: false, state: "command-error", headBefore: fresh.head, headAfter: fresh.head, error: commandError("worktree.pull", result, result.truncated ? "Git pull output exceeded the configured limit." : "Git pull failed.") };
    const after = await this.status({ projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, ...(request.signal === undefined ? {} : { signal: request.signal }) });
    if (after.state !== "ready" || after.entries.some((entry) => entry.unmerged || entry.unstaged || entry.staged)) return { ...base, applied: false, state: "command-error", headBefore: fresh.head, headAfter: after.head, error: after.error ?? { code: "mutation-failed", message: "Git pull did not leave a clean worktree", operation: "worktree.pull" } };
    return { ...base, applied: true, state: "pulled", headBefore: fresh.head, headAfter: after.head };
  }

  pullWorktreeFromOrigin(request: GitWorktreePullRequest): Promise<GitWorktreePullResult> { return this.pullWorktree(request); }

  async readOnly(request: GitReadOnlyRequest): Promise<GitStatusResult | GitBranchResult | GitDiffResult | GitWorktreeListResult> {
    if (request.operation === "status") return this.status(request);
    if (request.operation === "branch") return this.branch(request);
    if (request.operation === "diff") return this.diff(request);
    if (request.operation === "worktrees") return this.worktrees(request);
    throw new GitServiceError("invalid-operation", "unsupported Git read-only operation");
  }

  runReadOnly(request: GitReadOnlyRequest): Promise<GitStatusResult | GitBranchResult | GitDiffResult | GitWorktreeListResult> {
    return this.readOnly(request);
  }

  readOnlyCommand(request: GitReadOnlyRequest): Promise<GitStatusResult | GitBranchResult | GitDiffResult | GitWorktreeListResult> {
    return this.readOnly(request);
  }

  private async resolveDiscovery(target: GitTargetRequest): Promise<Discovery> {
    const binding = this.bindings.get(target.projectId);
    if (binding === undefined) throw new GitServiceError("invalid-project", "project is not bound to this server", { projectId: target.projectId });
    const discovery = await this.discover(binding.projectRoot, target.signal);
    if (target.repositoryId !== undefined && target.repositoryId !== discovery.repositoryId) {
      throw new GitServiceError("repository-mismatch", "repository does not belong to the project binding", { expected: target.repositoryId, actual: discovery.repositoryId ?? null });
    }
    if (target.worktreeId !== undefined && target.worktreeId !== discovery.worktreeId) {
      // A project request may address another worktree in the same repository.
      // Resolve it only through the bounded worktree listing; arbitrary paths
      // are never accepted as command cwd values.
      const listed = await this.findWorktree(target, discovery);
      return { ...discovery, worktreeId: listed.id, worktreeRoot: listed.path };
    }
    this.bindings.set(target.projectId, {
      projectId: target.projectId,
      projectRoot: binding.projectRoot,
      repositoryId: discovery.repositoryId,
      repositoryRoot: discovery.repositoryRoot,
      worktreeId: discovery.worktreeId,
      worktreeRoot: discovery.worktreeRoot,
      state: discovery.state,
    });
    return discovery;
  }

  private async findWorktree(target: GitTargetRequest, discovery: Discovery): Promise<{ id: GitWorktreeId; path: string }> {
    if (discovery.state !== "ready" || discovery.repositoryRoot === null || discovery.repositoryId === null) throw new GitServiceError("worktree-not-found", "worktree is not available for this repository");
    const result = await this.runGit(["worktree", "list", "--porcelain"], discovery.worktreeRoot ?? discovery.repositoryRoot, target.signal);
    if (result.exitCode !== 0 || result.truncated) throw new GitServiceError("worktree-not-found", "worktree list could not be read");
    for (const record of parseWorktreeList(result.stdout).slice(0, this.limits.maxWorktrees)) {
      const canonical = await this.canonicalWorktreePath(record.path);
      if (worktreeId(discovery.repositoryId, canonical) === target.worktreeId) return { id: target.worktreeId as GitWorktreeId, path: canonical };
    }
    throw new GitServiceError("worktree-not-found", "worktree is not part of the project repository");
  }

  private async discover(projectRoot: string, signal?: AbortSignal): Promise<Discovery> {
    // Distinguish an ordinary non-repository from a project whose `.git`
    // indirection exists but points at missing metadata. This check stays on
    // the server-side canonical path and never accepts a client-supplied cwd.
    let gitMetadataPresent = false;
    try {
      const metadata = await this.pathAdapter.stat(resolve(projectRoot, ".git"));
      gitMetadataPresent = metadata.isFile === true || metadata.isDirectory === true;
    } catch {
      gitMetadataPresent = false;
    }
    const result = await this.runGit(["rev-parse", "--show-toplevel"], projectRoot, signal);
    if (result.exitCode !== 0 || result.truncated) {
      const code = classifyDiscoveryError(result, result.truncated, gitMetadataPresent);
      return { state: code, repositoryId: null, repositoryRoot: null, worktreeId: null, worktreeRoot: null, error: commandError("discover", result, discoveryMessage(code)) };
    }
    const rawRoot = result.stdout.trim();
    if (rawRoot.length === 0) return { state: "command-error", repositoryId: null, repositoryRoot: null, worktreeId: null, worktreeRoot: null, error: { code: "command-error", message: "Git returned an empty repository root.", operation: "discover" } };
    let repositoryRoot: string;
    try {
      repositoryRoot = await this.canonicalDirectory(rawRoot);
    } catch {
      return { state: "missing-gitfile", repositoryId: null, repositoryRoot: null, worktreeId: null, worktreeRoot: null, error: { code: "missing-gitfile", message: "Git repository metadata is missing.", operation: "discover" } };
    }
    const repositoryId = repositoryIdFor(repositoryRoot);
    const worktreeRoot = repositoryRoot;
    return { state: "ready", repositoryId, repositoryRoot, worktreeId: worktreeId(repositoryId, worktreeRoot), worktreeRoot };
  }

  private async canonicalDirectory(value: string): Promise<string> {
    if (typeof value !== "string" || value.length === 0 || value.length > this.limits.maxPathBytes || value.includes("\0")) throw new GitServiceError("invalid-project", "project path is invalid");
    let canonical: string;
    try { canonical = await this.pathAdapter.realpath(value); } catch { throw new GitServiceError("invalid-project", "project path does not exist"); }
    let pathStat: Awaited<ReturnType<GitPathAdapter["stat"]>>;
    try { pathStat = await this.pathAdapter.stat(canonical); } catch { throw new GitServiceError("invalid-project", "project path does not exist"); }
    if (pathStat.isDirectory === false) throw new GitServiceError("invalid-project", "project path is not a directory");
    return canonical;
  }

  private async canonicalWorktreePath(value: string): Promise<string> {
    try { return await this.pathAdapter.realpath(value); } catch { return normalize(resolve(value)); }
  }

  private async resolveProjectRelativePath(path: string, worktreeRoot: string, projectId: string): Promise<string> {
    validateRelativePath(path, this.limits.maxPathBytes);
    const binding = this.bindings.get(projectId);
    if (binding === undefined) throw new GitServiceError("invalid-project", "project is not bound to this server");
    const candidate = resolve(binding.projectRoot, path);
    if (!isWithin(binding.projectRoot, candidate)) throw new GitServiceError("path-escape", "Git path is outside the project binding");
    try {
      const canonical = await this.pathAdapter.realpath(candidate);
      if (!isWithin(binding.projectRoot, canonical)) throw new GitServiceError("path-escape", "Git path resolves outside the project binding");
    } catch (error) {
      if (error instanceof GitServiceError) throw error;
      // Deleted files remain valid Git diff selectors. Lexical containment was
      // checked above, and Git receives only the relative selector.
    }
    // Git's cwd is the selected worktree root, while the request path is
    // relative to the bound project root. Translate only after containment
    // checks; the resulting selector remains relative and cannot escape.
    const repositoryRoot = binding.repositoryRoot ?? worktreeRoot;
    const gitPath = relative(repositoryRoot, candidate).replace(/\\/gu, "/");
    if (gitPath.length === 0 || gitPath.startsWith("../") || gitPath === ".." || isAbsolute(gitPath)) throw new GitServiceError("path-escape", "Git path is outside the repository binding");
    return gitPath;
  }

  private async readHead(cwd: string, signal?: AbortSignal): Promise<string | null> {
    const result = await this.runGit(["rev-parse", "--short", "HEAD"], cwd, signal);
    return result.exitCode === 0 && !result.truncated ? result.stdout.trim() || null : null;
  }

  private async defaultBranch(cwd: string, signal?: AbortSignal): Promise<string | null> {
    const remote = await this.runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd, signal);
    if (remote.exitCode === 0 && !remote.truncated) {
      const value = remote.stdout.trim();
      if (value.startsWith("origin/")) return value.slice("origin/".length);
      if (value.length > 0) return value;
    }
    for (const candidate of ["main", "master"]) {
      const local = await this.runGit(["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], cwd, signal);
      if (local.exitCode === 0) return candidate;
    }
    const branches = await this.runGit(["branch", "--format=%(refname:short)"], cwd, signal);
    if (branches.exitCode !== 0 || branches.truncated) return null;
    return branches.stdout.split(/\r?\n/u).map((value) => value.trim()).find((value) => value.length > 0) ?? null;
  }

  private async worktreeDelta(cwd: string, defaultBranch: string | null, signal?: AbortSignal): Promise<{
    readonly aheadCount: number | null;
    readonly additions: number | null;
    readonly deletions: number | null;
    readonly hasCommittedChanges: boolean | null;
  }> {
    const ahead = defaultBranch === null
      ? null
      : await this.runGit(["rev-list", "--count", `${defaultBranch}..HEAD`], cwd, signal);
    const aheadCount = ahead !== null && ahead.exitCode === 0 && !ahead.truncated
      ? parseNonNegativeInteger(ahead.stdout)
      : null;
    const branchDelta = await this.committedDelta(cwd, defaultBranch, signal);
    const workingDelta = await this.numstat(cwd, ["diff", "--numstat", "HEAD"], signal);
    if (branchDelta === null && workingDelta === null) {
      return { aheadCount, additions: null, deletions: null, hasCommittedChanges: null };
    }
    return {
      aheadCount,
      additions: (branchDelta?.additions ?? 0) + (workingDelta?.additions ?? 0),
      deletions: (branchDelta?.deletions ?? 0) + (workingDelta?.deletions ?? 0),
      hasCommittedChanges: branchDelta?.hasChanges ?? null,
    };
  }

  private async committedDelta(cwd: string, defaultBranch: string | null, signal?: AbortSignal): Promise<NumstatDelta | null> {
    if (defaultBranch === null) return null;
    const [defaultTree, mergedTree] = await Promise.all([
      this.runGit(["rev-parse", `${defaultBranch}^{tree}`], cwd, signal),
      this.runGit(["merge-tree", "--write-tree", "--no-messages", defaultBranch, "HEAD"], cwd, signal),
    ]);
    const defaultTreeId = validObjectId(defaultTree);
    const mergedTreeId = validObjectId(mergedTree);
    if (defaultTreeId !== null && mergedTreeId !== null) {
      if (defaultTreeId === mergedTreeId) return { additions: 0, deletions: 0, hasChanges: false };
      return this.numstat(cwd, ["diff", "--numstat", defaultTreeId, mergedTreeId], signal);
    }
    return this.numstat(cwd, ["diff", "--numstat", `${defaultBranch}...HEAD`], signal);
  }

  private async numstat(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<NumstatDelta | null> {
    const result = await this.runGit(args, cwd, signal);
    if (result.exitCode !== 0 || result.truncated) return null;
    let additions = 0;
    let deletions = 0;
    let hasChanges = false;
    for (const line of result.stdout.split(/\r?\n/u)) {
      if (line.length === 0) continue;
      hasChanges = true;
      const [rawAdditions, rawDeletions] = line.split("\t", 3);
      if (rawAdditions === undefined || rawDeletions === undefined) return null;
      if (rawAdditions !== "-") {
        const value = parseNonNegativeInteger(rawAdditions);
        if (value === null) return null;
        additions += value;
      }
      if (rawDeletions !== "-") {
        const value = parseNonNegativeInteger(rawDeletions);
        if (value === null) return null;
        deletions += value;
      }
      if (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions)) return null;
    }
    return { additions, deletions, hasChanges };
  }

  private async runGit(args: readonly string[], cwd: string, signal?: AbortSignal, maxOutputBytes = this.limits.maxOutputBytes): Promise<GitCommandResult> {
    try {
      return await this.runner.run(args, cwd, { signal, maxOutputBytes });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (typeof error === "object" && error !== null && ["ENOENT", "GIT_UNAVAILABLE"].includes((error as { readonly code?: unknown }).code as string)) {
        return { stdout: "", stderr: "git executable is unavailable", exitCode: null, truncated: false };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: "", stderr: message, exitCode: null, truncated: false };
    }
  }

  private emptyStatus(projectId: string, discovery: Discovery): GitStatusResult {
    return {
      projectId,
      repositoryId: discovery.repositoryId,
      repositoryRoot: discovery.repositoryRoot,
      worktreeId: discovery.worktreeId,
      worktreeRoot: discovery.worktreeRoot,
      state: discovery.state,
      branch: { name: null, detached: false, head: null, upstream: null, upstreamState: "none", ahead: null, behind: null },
      entries: [],
      head: null,
      bounded: false,
      ...(discovery.error === undefined ? {} : { error: discovery.error }),
    };
  }

  private publishProgress(
    operation: GitServiceOperation,
    phase: GitProgressPhase,
    projectId: string,
    repositoryId: string | null,
    worktreeId: string | null,
    state: GitDiscoveryState | "removed",
    bounded: boolean,
  ): void {
    this.record(Object.freeze({
      revision: this.nextRevision(),
      cursor: String(this.revisionValue),
      type: "git.progress",
      operation,
      phase,
      projectId,
      repositoryId,
      worktreeId,
      state,
      bounded,
    }));
  }

  private publishStatusChange(status: GitStatusResult): void {
    const key = `${status.projectId}\0${status.repositoryId ?? ""}\0${status.worktreeId ?? ""}`;
    const fingerprint = JSON.stringify({
      state: status.state,
      branch: status.branch,
      head: status.head,
      entries: status.entries,
      bounded: status.bounded,
    });
    if (this.statusFingerprints.get(key) === fingerprint) return;
    this.statusFingerprints.set(key, fingerprint);
    const event: GitStatusChangeEvent = Object.freeze({
      revision: this.nextRevision(),
      cursor: String(this.revisionValue),
      type: "git.status.changed",
      projectId: status.projectId,
      repositoryId: status.repositoryId,
      worktreeId: status.worktreeId,
      state: status.state,
      branch: status.branch.name,
      head: status.head,
      changedFiles: status.entries.length,
      bounded: status.bounded,
    });
    this.record(event);
  }

  private nextRevision(): number {
    if (this.revisionValue === Number.MAX_SAFE_INTEGER) throw new RangeError("Git event revision exhausted");
    this.revisionValue += 1;
    return this.revisionValue;
  }

  private record(event: GitServiceEvent): void {
    this.events.push(event);
    while (this.events.length > this.maxEvents) this.events.shift();
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* observer failures cannot roll back Git state */ }
    }
  }

  private startStatusPoll(projectId: string): void {
    if (this.statusPollIntervalMs === false || this.statusPollTimers.has(projectId) || this.closed) return;
    const schedule = (): void => {
      if (this.statusPollIntervalMs === false || this.closed || !this.bindings.has(projectId)) return;
      const timer = setTimeout(() => {
        this.statusPollTimers.delete(projectId);
        if (this.closed || !this.bindings.has(projectId)) return;
        void this.worktrees({ projectId }).catch(() => undefined).finally(schedule);
      }, this.statusPollIntervalMs);
      timer.unref?.();
      this.statusPollTimers.set(projectId, timer);
    };
    schedule();
  }

  private stopStatusPoll(projectId: string): void {
    const timer = this.statusPollTimers.get(projectId);
    if (timer !== undefined) clearTimeout(timer);
    this.statusPollTimers.delete(projectId);
  }
}

export { GitService as ServerGitService, GitService as GitRepositoryService };

export function createGitService(options: GitServiceOptions = {}): GitService {
  return new GitService(options);
}

function normalizeTarget(value: GitTargetRequest | string, signal?: AbortSignal): GitTargetRequest {
  if (typeof value === "string") {
    validateProjectId(value);
    return { projectId: value, ...(signal === undefined ? {} : { signal }) };
  }
  validateProjectId(value.projectId);
  return signal === undefined || value.signal !== undefined ? value : { ...value, signal };
}

function validateProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId)) throw new GitServiceError("invalid-project", "project id is invalid");
}

function validateWorktreeDirectoryName(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || value === "." || value === ".." || /[/\\\0\r\n]/u.test(value) || value.trim() !== value) {
    throw new GitServiceError("mutation-failed", "worktree directory name is invalid");
  }
  return value;
}

async function filesystemPathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw new GitServiceError("mutation-failed", "worktree destination could not be inspected");
  }
}

function validateRelativePath(value: string, maxBytes: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxBytes || value.includes("\0") || isAbsolute(value) || value.split(/[\\/]+/u).some((part) => part === "..")) throw new GitServiceError("path-escape", "Git path must be project-relative");
}

function validateLimits(limits: Required<GitServiceLimits>): void {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Git service limits must be positive safe integers");
}

function parseNonNegativeInteger(value: string): number | null {
  if (!/^\d+$/u.test(value.trim())) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validObjectId(result: GitCommandResult): string | null {
  if (result.exitCode !== 0 || result.truncated) return null;
  const value = result.stdout.trim();
  return /^[0-9a-f]{40,64}$/iu.test(value) ? value : null;
}

function assertRemovableWorktree(worktree: GitWorktreeSummary, expectedHead: string | null | undefined): void {
  if (worktree.isMain) throw new GitServiceError("worktree-main", "refusing to remove the repository main worktree", { worktreeId: worktree.id });
  if (worktree.isBare) throw new GitServiceError("worktree-bare", "refusing to remove a bare worktree", { worktreeId: worktree.id });
  if (worktree.locked) throw new GitServiceError("worktree-locked", "refusing to remove a locked worktree", { worktreeId: worktree.id });
  if (worktree.isPrunable) throw new GitServiceError("worktree-locked", "refusing to remove a prunable worktree", { worktreeId: worktree.id });
  // Detached worktrees can be removed safely when clean; only dirty and
  // unmerged state is unsafe.  Unknown state is treated conservatively.
  if (worktree.state !== "clean" && worktree.state !== "detached") {
    throw new GitServiceError("worktree-dirty", "refusing to remove a dirty or unmerged worktree", { worktreeId: worktree.id });
  }
  if (expectedHead !== undefined && worktree.head !== expectedHead) {
    throw new GitServiceError("stale-revision", "worktree HEAD changed since the removal was reviewed", {
      worktreeId: worktree.id,
      expectedHead,
      actualHead: worktree.head,
    });
  }
}

function repositoryIdFor(path: string): GitRepositoryId { return `repo-${digest(path)}`; }
function worktreeId(repositoryId: GitRepositoryId, path: string): GitWorktreeId { return `worktree-${digest(`${repositoryId}\0${path}`)}`; }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 32); }

function samePath(first: string, second: string): boolean { return resolve(first) === resolve(second); }
function isWithin(root: string, candidate: string): boolean { const rest = relative(resolve(root), resolve(candidate)); return rest === "" || (rest.length > 0 && !rest.startsWith("..") && !isAbsolute(rest)); }
function headsMatch(first: string | null | undefined, second: string | null | undefined): boolean {
  if (first === second) return true;
  if (first === null || first === undefined || second === null || second === undefined) return false;
  return first.startsWith(second) || second.startsWith(first);
}

function classifyDiscoveryError(result: GitCommandResult, truncated: boolean, gitMetadataPresent = false): GitDiscoveryState {
  if (truncated) return "command-error";
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (text.includes("git: not found") || text.includes("executable is unavailable")) return "git-unavailable";
  if (text.includes("not a git repository")) {
    if (gitMetadataPresent) return "missing-gitfile";
    const pointsAtGitMetadata = /not a git repository:\s+\S+/u.test(text);
    const reportsMissingMetadata = /\.git(?:[\\/]|$)/u.test(text) && /(does not exist|no such file|not a file|cannot open)/u.test(text);
    return pointsAtGitMetadata || reportsMissingMetadata ? "missing-gitfile" : "not-repository";
  }
  return "command-error";
}

function discoveryMessage(state: GitDiscoveryState): string {
  if (state === "not-repository") return "Project is not a Git repository.";
  if (state === "git-unavailable") return "Git executable is unavailable on the server.";
  if (state === "missing-gitfile") return "Git worktree metadata is missing or unreadable.";
  return "Git repository discovery failed.";
}

function commandError(operation: string, result: GitCommandResult, message: string): GitErrorInfo {
  const stderr = result.stderr.trim();
  return { code: result.truncated ? "output-too-large" : "command-error", message, ...(stderr.length === 0 ? {} : { stderr: truncateUtf8(stderr, 4 * 1024) }), operation };
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { readonly name?: unknown; readonly code?: unknown };
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return value;
  const bytes = new TextEncoder().encode(value).slice(0, maxBytes);
  return new TextDecoder().decode(bytes);
}
