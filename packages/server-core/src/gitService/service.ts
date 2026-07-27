import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
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

interface Discovery {
  readonly state: GitDiscoveryState;
  readonly repositoryId: GitRepositoryId | null;
  readonly repositoryRoot: string | null;
  readonly worktreeId: GitWorktreeId | null;
  readonly worktreeRoot: string | null;
  readonly error?: GitErrorInfo;
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
  private readonly bindings = new Map<string, GitProjectBinding>();
  private readonly listeners = new Set<GitServiceListener>();
  private readonly events: GitServiceEvent[] = [];
  private readonly maxEvents: number;
  private revisionValue = 0;
  private readonly statusFingerprints = new Map<string, string>();

  constructor(options: GitServiceOptions = {}) {
    this.runner = options.runner ?? new NodeGitCommandRunner();
    this.pathAdapter = options.pathAdapter ?? new NodeGitPathAdapter();
    this.limits = { ...DEFAULT_GIT_SERVICE_LIMITS, ...options.limits };
    validateLimits(this.limits);
    this.maxEvents = options.maxEvents ?? 1024;
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents <= 0) throw new RangeError("maxEvents must be positive");
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
    return binding;
  }

  unbindProject(projectId: string): boolean { return this.bindings.delete(projectId); }

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
      let state = worktreeState(entries, record.detached, record.isPrunable);
      if (!record.isBare && !record.isPrunable) {
        const statusResult = await this.runGit(["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all", "--ignored=no"], record.path, target.signal);
        if (statusResult.exitCode === 0 && !statusResult.truncated) {
          const parsed = parseStatus(statusResult.stdout, this.limits.maxStatusEntries);
          entries = parsed.entries;
          state = worktreeState(entries, parsed.branch.detached || record.detached, false);
        } else {
          state = "unknown";
          error = commandError("status", statusResult, statusResult.truncated ? "Worktree status output exceeded the configured limit." : "Worktree status failed.");
        }
      }
      summaries.push({
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
        entries,
        ...(error === undefined ? {} : { error }),
      });
    }
    return { ...empty, state: "ready", defaultBranch, worktrees: summaries, bounded };
  }

  listWorktrees(request: GitTargetRequest | string, signal?: AbortSignal): Promise<GitWorktreeListResult> {
    return this.worktrees(request, signal);
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

function validateRelativePath(value: string, maxBytes: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxBytes || value.includes("\0") || isAbsolute(value) || value.split(/[\\/]+/u).some((part) => part === "..")) throw new GitServiceError("path-escape", "Git path must be project-relative");
}

function validateLimits(limits: Required<GitServiceLimits>): void {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Git service limits must be positive safe integers");
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
