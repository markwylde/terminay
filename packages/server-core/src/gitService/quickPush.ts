import { createHash, randomUUID } from "node:crypto";
import { type GitService } from "./service.js";
import type {
  GitQuickPushAction,
  GitQuickPushActionResult,
  GitQuickPushApprovalRequest,
  GitQuickPushApprovalResult,
  GitQuickPushContext,
  GitQuickPushExecutionResult,
  GitQuickPushExecutor,
  GitQuickPushPlan,
  GitQuickPushPlanner,
  GitQuickPushProposal,
  GitQuickPushProposalRequest,
  GitQuickPushRevision,
} from "./types.js";
import { GitServiceError } from "./types.js";

export interface GitQuickPushServiceOptions {
  readonly maxActions?: number;
  readonly maxContextBytes?: number;
  /** Deadline for server-side provider planning. */
  readonly plannerTimeoutMs?: number;
  /** Deadline for each server-side Git/provider mutation action. */
  readonly executorTimeoutMs?: number;
  readonly proposalTtlMs?: number;
  readonly maxProposals?: number;
  readonly now?: () => number;
}

const DEFAULT_OPTIONS: Required<GitQuickPushServiceOptions> = {
  maxActions: 16,
  maxContextBytes: 512 * 1024,
  plannerTimeoutMs: 30_000,
  executorTimeoutMs: 120_000,
  proposalTtlMs: 10 * 60 * 1000,
  maxProposals: 128,
  now: () => Date.now(),
};

interface StoredProposal {
  readonly proposal: GitQuickPushProposal;
  consumed: boolean;
}

/**
 * Review-bound Quick Push orchestration. Planning and execution are injected
 * server-side callbacks: neither callback crosses the transport boundary or
 * receives client credentials. This class only supplies bounded context and
 * enforces the one-time repository-revision/action binding.
 */
export class GitQuickPushService {
  private readonly options: Required<GitQuickPushServiceOptions>;
  private readonly proposals = new Map<string, StoredProposal>();

  constructor(
    private readonly git: GitService,
    private readonly planner: GitQuickPushPlanner,
    private readonly executor: GitQuickPushExecutor,
    options: GitQuickPushServiceOptions = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    validateOptions(this.options);
  }

  async propose(request: GitQuickPushProposalRequest): Promise<GitQuickPushProposal> {
    validateProposalRequest(request);
    const context = this.boundContext(await this.snapshot(request, request.signal));
    let planned: GitQuickPushPlan;
    try {
      planned = await this.runProvider(
        (signal) => this.planner.plan(context, signal),
        request.signal,
        this.options.plannerTimeoutMs,
        "Quick Push provider planning",
      );
    } catch (error) {
      throw providerPlanError(error);
    }
    const actions = validatePlan(planned, request.targetBranch, this.options.maxActions);
    const revision = makeRevision(context);
    const proposal: GitQuickPushProposal = {
      proposalId: randomUUID(),
      provider: request.provider,
      targetBranch: request.targetBranch,
      revision,
      actionDigest: digest(JSON.stringify(actions)),
      actions,
      context,
      expiresAt: this.options.now() + this.options.proposalTtlMs,
    };
    this.pruneProposals();
    this.proposals.set(proposal.proposalId, { proposal, consumed: false });
    return proposal;
  }

  async approve(request: GitQuickPushApprovalRequest): Promise<GitQuickPushApprovalResult> {
    const stored = this.proposals.get(request.proposalId);
    if (stored === undefined) throw new GitServiceError("proposal-not-found", "Quick Push proposal was not found");
    if (stored.consumed) throw new GitServiceError("proposal-replayed", "Quick Push approval has already been consumed");
    if (this.options.now() >= stored.proposal.expiresAt) {
      stored.consumed = true;
      throw new GitServiceError("proposal-stale", "Quick Push proposal has expired");
    }
    if (request.actionDigest !== stored.proposal.actionDigest || !sameRevision(request.revision, stored.proposal.revision)) {
      throw new GitServiceError("proposal-stale", "Quick Push approval does not match the reviewed proposal");
    }

    // Consume before invoking any executor so retries cannot replay a commit,
    // push, or pull-request operation after a timeout or client disconnect.
    stored.consumed = true;
    let context = this.boundContext(await this.snapshot({
      projectId: stored.proposal.context.projectId,
      repositoryId: stored.proposal.revision.repositoryId,
      worktreeId: stored.proposal.revision.worktreeId,
      provider: stored.proposal.provider,
      targetBranch: stored.proposal.targetBranch,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    }, request.signal));
    if (!sameRevision(makeRevision(context), stored.proposal.revision)) {
      throw new GitServiceError("proposal-stale", "repository state changed after Quick Push review");
    }

    let baseline = stored.proposal.revision;
    const results: GitQuickPushActionResult[] = [];
    for (let index = 0; index < stored.proposal.actions.length; index += 1) {
      const action = stored.proposal.actions[index];
      if (action === undefined) break;
      context = this.boundContext(await this.snapshot({
        projectId: stored.proposal.context.projectId,
        repositoryId: stored.proposal.revision.repositoryId,
        worktreeId: stored.proposal.revision.worktreeId,
        provider: stored.proposal.provider,
        targetBranch: stored.proposal.targetBranch,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }, request.signal));
      const current = makeRevision(context);
      if (!sameRevision(current, baseline)) {
        return {
          proposalId: request.proposalId,
          applied: results.length > 0,
          partialFailure: results.length > 0,
          results,
          error: {
            code: "proposal-stale",
            message: "repository state changed before the next Quick Push action",
            operation: `quick-push.${action.kind}`,
          },
        };
      }
      let execution: GitQuickPushExecutionResult;
      try {
        execution = await this.runProvider(
          (signal) => this.executor.execute(action, context, signal),
          request.signal,
          this.options.executorTimeoutMs,
          `Quick Push ${action.kind}`,
        );
      } catch (error) {
        const providerFailure = providerFailureInfo(error, action.kind);
        return {
          proposalId: request.proposalId,
          applied: results.length > 0,
          partialFailure: results.length > 0,
          results,
          error: {
            code: providerFailure.code,
            message: providerFailure.message,
            operation: `quick-push.${action.kind}`,
          },
        };
      }
      const actionResult: GitQuickPushActionResult = {
        index,
        action,
        applied: execution.applied === true,
        ...(execution.detail === undefined ? {} : { detail: redactQuickPushText(truncateUtf8(execution.detail, 2048).value) }),
      };
      results.push(actionResult);
      if (!execution.applied) {
        return {
          proposalId: request.proposalId,
          applied: results.some((result) => result.applied),
          partialFailure: true,
          results,
          error: { code: "action-failed", message: "Quick Push action was not applied", operation: `quick-push.${action.kind}` },
        };
      }
      if (action.mutatesRevision) {
        // A commit is expected to advance HEAD. Establish its resulting
        // revision as the baseline for the following push/PR action.
        context = this.boundContext(await this.snapshot({
          projectId: stored.proposal.context.projectId,
          repositoryId: stored.proposal.revision.repositoryId,
          worktreeId: stored.proposal.revision.worktreeId,
          provider: stored.proposal.provider,
          targetBranch: stored.proposal.targetBranch,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }, request.signal));
        baseline = makeRevision(context);
      }
    }
    return { proposalId: request.proposalId, applied: true, partialFailure: false, results };
  }

  private async snapshot(request: GitQuickPushProposalRequest, signal?: AbortSignal): Promise<GitQuickPushContext> {
    const status = await this.git.status({ projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, ...(signal === undefined ? {} : { signal }) });
    if (status.state !== "ready" || status.repositoryId !== request.repositoryId || status.worktreeId !== request.worktreeId) {
      throw new GitServiceError("repository-mismatch", "Git target is no longer bound to this project");
    }
    const diff = await this.git.diff({ projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId }, signal);
    if (diff.state !== "ready" || diff.repositoryId !== request.repositoryId || diff.worktreeId !== request.worktreeId) {
      throw new GitServiceError("command-error", "Git diff could not be captured for Quick Push");
    }
    return {
      projectId: request.projectId,
      repositoryId: request.repositoryId,
      worktreeId: request.worktreeId,
      branch: status.branch.name,
      head: status.head,
      entries: status.entries,
      patch: diff.patch,
      bounded: status.bounded || diff.bounded,
    };
  }

  private boundContext(context: GitQuickPushContext): GitQuickPushContext {
    const patch = truncateUtf8(context.patch, this.options.maxContextBytes);
    return {
      ...context,
      patch: redactQuickPushText(patch.value),
      bounded: context.bounded || patch.truncated,
    };
  }

  private runProvider<T>(
    operation: (signal: AbortSignal) => T | PromiseLike<T>,
    parentSignal: AbortSignal | undefined,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    return runBoundedProvider(operation, parentSignal, timeoutMs, label);
  }

  private pruneProposals(): void {
    const now = this.options.now();
    for (const [id, stored] of this.proposals) if (stored.proposal.expiresAt <= now || stored.consumed) this.proposals.delete(id);
    while (this.proposals.size >= this.options.maxProposals) {
      const oldest = this.proposals.keys().next().value;
      if (oldest === undefined) break;
      this.proposals.delete(oldest);
    }
  }
}

export function createGitQuickPushService(
  git: GitService,
  planner: GitQuickPushPlanner,
  executor: GitQuickPushExecutor,
  options: GitQuickPushServiceOptions = {},
): GitQuickPushService {
  return new GitQuickPushService(git, planner, executor, options);
}

function validateProposalRequest(request: GitQuickPushProposalRequest): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.projectId)) throw new GitServiceError("invalid-proposal", "Quick Push project ID is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.repositoryId) || !/^worktree-[a-f0-9]{32}$/u.test(request.worktreeId)) throw new GitServiceError("invalid-proposal", "Quick Push target identity is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(request.provider)) throw new GitServiceError("invalid-proposal", "Quick Push provider is invalid");
  validateBranch(request.targetBranch);
}

function validatePlan(plan: GitQuickPushPlan, targetBranch: string, maxActions: number): readonly GitQuickPushAction[] {
  if (plan === null || typeof plan !== "object" || !Array.isArray(plan.actions) || plan.actions.length === 0 || plan.actions.length > maxActions) throw new GitServiceError("invalid-proposal", "Quick Push plan is empty or exceeds the action limit");
  const order: Record<string, number> = { commit: 0, push: 1, "pull-request": 2 };
  let previous = -1;
  const actions = plan.actions.map((action) => {
    if (action === null || typeof action !== "object" || !(action.kind in order) || typeof action.target !== "string" || typeof action.summary !== "string" || typeof action.mutatesRevision !== "boolean") throw new GitServiceError("invalid-proposal", "Quick Push plan contains an invalid action");
    const kind = action.kind;
    const current = order[kind];
    if (current === undefined || current < previous) throw new GitServiceError("invalid-proposal", "Quick Push actions are out of order");
    previous = current;
    if (action.target.length === 0 || action.target.length > 256 || action.summary.length === 0 || action.summary.length > 512 || hasControlCharacter(action.target) || hasControlCharacter(action.summary)) throw new GitServiceError("invalid-proposal", "Quick Push action text is invalid or too long");
    if ((kind === "commit") !== action.mutatesRevision) throw new GitServiceError("invalid-proposal", "Quick Push commit mutation flag is invalid");
    if ((kind === "push" || kind === "pull-request") && action.target !== targetBranch) throw new GitServiceError("invalid-proposal", "Quick Push action target differs from the reviewed branch");
    return Object.freeze({ kind, target: action.target, summary: redactQuickPushText(action.summary), mutatesRevision: action.mutatesRevision });
  });
  return Object.freeze(actions);
}

function validateBranch(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.includes("..") || value.includes("@{") || hasBranchControlCharacter(value) || [...value].some((character) => "~^:?*[\\]".includes(character))) throw new GitServiceError("invalid-proposal", "Quick Push branch target is invalid");
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasBranchControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 0x20 || value.charCodeAt(index) === 0x7f) return true;
  }
  return false;
}

function makeRevision(context: GitQuickPushContext): GitQuickPushRevision {
  return {
    repositoryId: context.repositoryId,
    worktreeId: context.worktreeId,
    head: context.head,
    branch: context.branch,
    statusDigest: digest(JSON.stringify({ head: context.head, branch: context.branch, entries: context.entries, patch: context.patch })),
  };
}

function sameRevision(first: GitQuickPushRevision, second: GitQuickPushRevision): boolean {
  return first.repositoryId === second.repositoryId && first.worktreeId === second.worktreeId && first.head === second.head && first.branch === second.branch && first.statusDigest === second.statusDigest;
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function truncateUtf8(value: string, maxBytes: number): { readonly value: string; readonly truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return { value, truncated: false };
  return { value: new TextDecoder().decode(bytes.slice(0, maxBytes)), truncated: true };
}

function redactQuickPushText(value: string): string {
  return value
    .replace(/((?:token|secret|password|passphrase|private[_-]?key|api[_-]?key|grant|proof)[=:]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/gu, "[redacted]");
}

function validateOptions(options: Required<GitQuickPushServiceOptions>): void {
  if (!Number.isSafeInteger(options.maxActions) || options.maxActions <= 0 || !Number.isSafeInteger(options.maxContextBytes) || options.maxContextBytes <= 0 || !Number.isSafeInteger(options.plannerTimeoutMs) || options.plannerTimeoutMs <= 0 || !Number.isSafeInteger(options.executorTimeoutMs) || options.executorTimeoutMs <= 0 || !Number.isSafeInteger(options.proposalTtlMs) || options.proposalTtlMs <= 0 || !Number.isSafeInteger(options.maxProposals) || options.maxProposals <= 0) throw new RangeError("Quick Push limits must be positive safe integers");
}

async function runBoundedProvider<T>(
  operation: (signal: AbortSignal) => T | PromiseLike<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (parentSignal?.aborted === true) throw new GitServiceError("cancelled", `${label} was cancelled`);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeParentAbort: (() => void) | undefined;
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  const cancellationPromise = new Promise<never>((_, reject) => {
    if (parentSignal !== undefined) {
      const onAbort = () => {
        controller.abort();
        reject(new GitServiceError("cancelled", `${label} was cancelled`));
      };
      parentSignal.addEventListener("abort", onAbort, { once: true });
      removeParentAbort = () => parentSignal.removeEventListener("abort", onAbort);
    }
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GitServiceError("provider-timeout", `${label} exceeded its server deadline`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operationPromise, cancellationPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeParentAbort?.();
    controller.abort();
    // A promise that loses the race can still settle later. Keep its rejection
    // observed so an uncooperative provider cannot create an unhandled error.
    operationPromise.catch(() => undefined);
  }
}

function providerFailureInfo(error: unknown, actionKind: string): { readonly code: "provider-timeout" | "cancelled" | "action-failed"; readonly message: string } {
  if (error instanceof GitServiceError && (error.code === "provider-timeout" || error.code === "cancelled")) {
    return { code: error.code, message: redactQuickPushText(truncateUtf8(error.message, 2048).value) };
  }
  return {
    code: "action-failed",
    message: redactQuickPushText(truncateUtf8(error instanceof Error ? error.message : `Quick Push ${actionKind} failed`, 2048).value),
  };
}

function providerPlanError(error: unknown): GitServiceError {
  if (error instanceof GitServiceError && (error.code === "provider-timeout" || error.code === "cancelled")) return error;
  return new GitServiceError("action-failed", redactQuickPushText(truncateUtf8(error instanceof Error ? error.message : "Quick Push provider planning failed", 2048).value));
}
