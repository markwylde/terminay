/**
 * Transport-neutral Git service contracts.  The service deliberately accepts
 * a runner and a small path adapter instead of importing Electron, IPC, or a
 * network transport.  A runner is allowed to inherit the server process's
 * Git/SSH environment; no environment values are copied into these types or
 * returned from the service.
 */

export type GitReadOnlyOperation = "status" | "branch" | "diff" | "worktrees";

export type GitRepositoryId = string;
export type GitWorktreeId = string;

export interface GitPathStat {
  readonly isDirectory?: boolean;
  readonly isFile?: boolean;
}

export interface GitPathAdapter {
  readonly realpath: (path: string) => string | PromiseLike<string>;
  readonly stat: (path: string) => GitPathStat | PromiseLike<GitPathStat>;
}

export interface GitCommandOptions {
  readonly signal?: AbortSignal;
  /** Combined stdout/stderr cap. The runner must stop collecting at the cap. */
  readonly maxOutputBytes?: number;
}

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  /** null means the process was terminated before Git supplied an exit code. */
  readonly exitCode: number | null;
  readonly signal?: string;
  /** True when the runner stopped collecting at maxOutputBytes. */
  readonly truncated: boolean;
}

export interface GitCommandRunner {
  run(args: readonly string[], cwd: string, options?: GitCommandOptions): Promise<GitCommandResult>;
}

export interface GitServiceLimits {
  readonly maxOutputBytes?: number;
  readonly maxDiffBytes?: number;
  readonly maxDiffHunks?: number;
  readonly maxDiffLines?: number;
  readonly maxDiffLineBytes?: number;
  readonly maxStatusEntries?: number;
  readonly maxWorktrees?: number;
  readonly maxPathBytes?: number;
}

export const DEFAULT_GIT_SERVICE_LIMITS: Required<GitServiceLimits> = Object.freeze({
  maxOutputBytes: 4 * 1024 * 1024,
  maxDiffBytes: 4 * 1024 * 1024,
  maxDiffHunks: 10_000,
  maxDiffLines: 100_000,
  maxDiffLineBytes: 64 * 1024,
  maxStatusEntries: 10_000,
  maxWorktrees: 256,
  maxPathBytes: 4 * 1024,
});

export type GitDiscoveryState =
  | "ready"
  | "not-repository"
  | "git-unavailable"
  | "missing-gitfile"
  | "command-error";

export interface GitProjectBinding {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly repositoryId: GitRepositoryId | null;
  readonly repositoryRoot: string | null;
  readonly worktreeId: GitWorktreeId | null;
  readonly worktreeRoot: string | null;
  readonly state: GitDiscoveryState;
}

export interface GitErrorInfo {
  readonly code:
    | GitDiscoveryState
    | "invalid-project"
    | "path-escape"
    | "invalid-operation"
    | "worktree-not-found"
    | "repository-mismatch"
    | "output-too-large"
    | "worktree-main"
    | "worktree-dirty"
    | "worktree-locked"
    | "worktree-bare"
    | "stale-revision"
    | "mutation-failed"
    | "proposal-not-found"
    | "proposal-replayed"
    | "proposal-stale"
    | "invalid-proposal"
    | "action-failed"
    | "provider-timeout"
    | "cancelled";
  readonly message: string;
  readonly stderr?: string;
  readonly operation?: string;
}

export type GitServiceErrorCode = GitErrorInfo["code"];

export class GitServiceError extends Error {
  readonly code: GitErrorInfo["code"];
  readonly details: Readonly<Record<string, string | number | boolean | null>> | undefined;

  constructor(code: GitErrorInfo["code"], message: string, details?: Readonly<Record<string, string | number | boolean | null>>) {
    super(message);
    this.name = "GitServiceError";
    this.code = code;
    this.details = details;
  }
}

export interface GitBranchStatus {
  readonly name: string | null;
  readonly detached: boolean;
  readonly head: string | null;
  readonly upstream: string | null;
  /** Whether the branch has no upstream, a live upstream, or a gone one. */
  readonly upstreamState: "none" | "configured" | "missing";
  readonly ahead: number | null;
  readonly behind: number | null;
}

export type GitChangeKind = "added" | "copied" | "deleted" | "modified" | "renamed" | "unmerged" | "untracked" | "unknown";

export interface GitStatusEntry {
  readonly path: string;
  readonly previousPath: string | null;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
  readonly kind: GitChangeKind;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly unmerged: boolean;
}

export interface GitStatusResult {
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId | null;
  readonly repositoryRoot: string | null;
  readonly worktreeId: GitWorktreeId | null;
  readonly worktreeRoot: string | null;
  readonly state: GitDiscoveryState;
  readonly branch: GitBranchStatus;
  readonly entries: readonly GitStatusEntry[];
  readonly head: string | null;
  readonly bounded: boolean;
  readonly error?: GitErrorInfo;
}

export interface GitBranchResult extends GitStatusResult {
  readonly operation: "branch";
}

export interface GitDiffLine {
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly type: "add" | "delete" | "context";
  readonly value: string;
}

export interface GitDiffHunk {
  readonly header: string;
  readonly lines: readonly GitDiffLine[];
}

export interface GitDiffFile {
  readonly path: string;
  readonly previousPath: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

export interface GitDiffResult {
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId | null;
  readonly worktreeId: GitWorktreeId | null;
  readonly state: GitDiscoveryState;
  readonly compareTarget: "HEAD";
  readonly path: string | null;
  readonly files: readonly GitDiffFile[];
  readonly hunks: readonly GitDiffHunk[];
  readonly patch: string;
  readonly binary: boolean;
  readonly bounded: boolean;
  readonly error?: GitErrorInfo;
}

export type GitWorktreeState = "clean" | "dirty" | "unmerged" | "detached" | "prunable" | "unknown";

export interface GitWorktreeSummary {
  readonly id: GitWorktreeId;
  readonly repositoryId: GitRepositoryId;
  readonly path: string;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly head: string | null;
  readonly isMain: boolean;
  readonly isBare: boolean;
  readonly isPrunable: boolean;
  readonly locked: boolean;
  readonly state: GitWorktreeState;
  readonly entries: readonly GitStatusEntry[];
  readonly error?: GitErrorInfo;
}

export interface GitWorktreeListResult {
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId | null;
  readonly repositoryRoot: string | null;
  readonly defaultBranch: string | null;
  readonly state: GitDiscoveryState;
  readonly worktrees: readonly GitWorktreeSummary[];
  readonly bounded: boolean;
  readonly error?: GitErrorInfo;
}

/**
 * A server-owned worktree removal request.  The caller supplies only the
 * opaque project/repository/worktree identities returned by this service;
 * paths are intentionally absent so a client cannot substitute a cwd.
 */
export interface GitWorktreeRemoveRequest {
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId;
  readonly worktreeId: GitWorktreeId;
  /** Full HEAD from a prior worktree snapshot, when the caller has one. */
  readonly expectedHead?: string | null;
  readonly signal?: AbortSignal;
}

export interface GitWorktreeRemoveResult {
  readonly operation: "remove";
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId;
  readonly worktreeId: GitWorktreeId;
  readonly applied: boolean;
  readonly state: "removed" | "command-error";
  readonly headBefore: string | null;
  readonly error?: GitErrorInfo;
}

export type GitQuickPushActionKind = "commit" | "push" | "pull-request";

/** One exact, reviewable action; no raw command or filesystem path is exposed. */
export interface GitQuickPushAction {
  readonly kind: GitQuickPushActionKind;
  readonly target: string;
  readonly summary: string;
  /** Commit creation can intentionally advance HEAD; push/PR normally cannot. */
  readonly mutatesRevision: boolean;
}

export interface GitQuickPushContext {
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId;
  readonly worktreeId: GitWorktreeId;
  readonly branch: string | null;
  readonly head: string | null;
  readonly entries: readonly GitStatusEntry[];
  readonly patch: string;
  readonly bounded: boolean;
}

export interface GitQuickPushPlan {
  readonly actions: readonly GitQuickPushAction[];
}

/** Provider planning happens in the server process and returns only bounded data. */
export interface GitQuickPushPlanner {
  readonly plan: (context: GitQuickPushContext, signal?: AbortSignal) => GitQuickPushPlan | PromiseLike<GitQuickPushPlan>;
}

export interface GitQuickPushExecutionResult {
  readonly applied: boolean;
  readonly detail?: string;
}

/** Executor is injected by the server; credentials stay in that process. */
export interface GitQuickPushExecutor {
  readonly execute: (action: GitQuickPushAction, context: GitQuickPushContext, signal?: AbortSignal) => GitQuickPushExecutionResult | PromiseLike<GitQuickPushExecutionResult>;
}

export interface GitQuickPushRevision {
  readonly repositoryId: GitRepositoryId;
  readonly worktreeId: GitWorktreeId;
  readonly head: string | null;
  readonly branch: string | null;
  readonly statusDigest: string;
}

export interface GitQuickPushProposalRequest {
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId;
  readonly worktreeId: GitWorktreeId;
  readonly provider: string;
  readonly targetBranch: string;
  readonly signal?: AbortSignal;
}

export interface GitQuickPushProposal {
  readonly proposalId: string;
  readonly provider: string;
  readonly targetBranch: string;
  readonly revision: GitQuickPushRevision;
  readonly actionDigest: string;
  readonly actions: readonly GitQuickPushAction[];
  readonly context: GitQuickPushContext;
  readonly expiresAt: number;
}

export interface GitQuickPushApprovalRequest {
  readonly proposalId: string;
  readonly revision: GitQuickPushRevision;
  readonly actionDigest: string;
  readonly signal?: AbortSignal;
}

export interface GitQuickPushActionResult {
  readonly index: number;
  readonly action: GitQuickPushAction;
  readonly applied: boolean;
  readonly detail?: string;
}

export interface GitQuickPushApprovalResult {
  readonly proposalId: string;
  readonly applied: boolean;
  readonly partialFailure: boolean;
  readonly results: readonly GitQuickPushActionResult[];
  readonly error?: GitErrorInfo;
}

export type GitStatus = GitStatusResult;
export type GitBranch = GitBranchResult;
export type GitDiff = GitDiffResult;
export type GitWorktrees = GitWorktreeListResult;

export interface GitReadOnlyRequest {
  readonly operation: GitReadOnlyOperation;
  readonly projectId: string;
  readonly repositoryId?: GitRepositoryId;
  readonly worktreeId?: GitWorktreeId;
  /** Project-relative path for diff. Absolute paths and `..` are rejected. */
  readonly path?: string;
  readonly signal?: AbortSignal;
}

export interface GitServiceOptions {
  readonly runner?: GitCommandRunner;
  readonly pathAdapter?: GitPathAdapter;
  readonly limits?: GitServiceLimits;
  /** Maximum retained progress/status events for authorized subscribers. */
  readonly maxEvents?: number;
}

export type GitServiceOperation = GitReadOnlyOperation | "worktree.remove" | "quick-push";
export type GitProgressPhase = "started" | "completed" | "failed";

/** Bounded progress metadata; command output and credentials stay server-side. */
export interface GitProgressEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: "git.progress";
  readonly operation: GitServiceOperation;
  readonly phase: GitProgressPhase;
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId | null;
  readonly worktreeId: GitWorktreeId | null;
  readonly state: GitDiscoveryState | "removed";
  readonly bounded: boolean;
}

/** Status metadata emitted when a canonical project/worktree status changes. */
export interface GitStatusChangeEvent {
  readonly revision: number;
  readonly cursor: string;
  readonly type: "git.status.changed";
  readonly projectId: string;
  readonly repositoryId: GitRepositoryId | null;
  readonly worktreeId: GitWorktreeId | null;
  readonly state: GitDiscoveryState;
  readonly branch: string | null;
  readonly head: string | null;
  readonly changedFiles: number;
  readonly bounded: boolean;
}

export type GitServiceEvent = GitProgressEvent | GitStatusChangeEvent;
export type GitServiceListener = (event: GitServiceEvent) => void;

export interface GitServiceReplay {
  readonly kind: "events" | "resync";
  readonly events: readonly GitServiceEvent[];
}
