import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("Quick Push produces bounded review data and consumes exact approval once", async () => {
  const { GitService, GitQuickPushService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-quick-push-"));
  try {
    await initialise(root);
    await writeFile(join(root, "file.txt"), "changed\n");
    const git = new GitService();
    const binding = await git.bindProject("project", root);
    let plannedContext;
    const executed = [];
    const quickPush = new GitQuickPushService(
      git,
      { plan: async (context) => { plannedContext = context; return { actions: [
        { kind: "commit", target: "main", summary: "Commit reviewed changes token=topsecret", mutatesRevision: true },
        { kind: "push", target: "main", summary: "Push main", mutatesRevision: false },
      ] }; } },
      { execute: async (action) => { executed.push(action.kind); return { applied: true }; } },
      { maxContextBytes: 128 },
    );
    const proposal = await quickPush.propose({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId, provider: "codex", targetBranch: "main" });
    assert.equal(executed.length, 0);
    assert.equal(plannedContext.branch, "main");
    assert.equal(proposal.actions.length, 2);
    assert.equal(proposal.actions[0].summary.includes("topsecret"), false);
    assert.equal(proposal.context.patch.length <= 128, true);
    assert.equal(proposal.revision.repositoryId, binding.repositoryId);
    assert.equal(proposal.revision.worktreeId, binding.worktreeId);

    const result = await quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest });
    assert.equal(result.applied, true);
    assert.equal(result.partialFailure, false);
    assert.deepEqual(executed, ["commit", "push"]);
    await assert.rejects(
      () => quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest }),
      (error) => error instanceof GitServiceError && error.code === "proposal-replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Quick Push bounds provider planning and aborts the server-side planner", async () => {
  const { GitService, GitQuickPushService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-quick-push-planner-timeout-"));
  try {
    await initialise(root);
    const git = new GitService();
    const binding = await git.bindProject("project", root);
    let plannerAborted = false;
    const quickPush = new GitQuickPushService(
      git,
      { plan: (_context, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { plannerAborted = true; reject(new Error("planner aborted")); }, { once: true });
      }) },
      { execute: async () => ({ applied: true }) },
      { plannerTimeoutMs: 20 },
    );
    await assert.rejects(
      () => quickPush.propose({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId, provider: "codex", targetBranch: "main" }),
      (error) => error instanceof GitServiceError && error.code === "provider-timeout",
    );
    assert.equal(plannerAborted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Quick Push returns cancellation for an aborted server-side action", async () => {
  const { GitService, GitQuickPushService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-quick-push-cancel-"));
  try {
    await initialise(root);
    const git = new GitService();
    const binding = await git.bindProject("project", root);
    let executorAborted = false;
    let executorStartedResolve;
    const executorStarted = new Promise((resolve) => { executorStartedResolve = resolve; });
    const quickPush = new GitQuickPushService(
      git,
      { plan: () => ({ actions: [{ kind: "push", target: "main", summary: "Push", mutatesRevision: false }] }) },
      { execute: (_action, _context, signal) => new Promise((_resolve, reject) => {
        executorStartedResolve();
        signal.addEventListener("abort", () => { executorAborted = true; reject(new Error("executor aborted")); }, { once: true });
      }) },
      { executorTimeoutMs: 2_000 },
    );
    const proposal = await quickPush.propose({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId, provider: "codex", targetBranch: "main" });
    const controller = new AbortController();
    const approval = quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest, signal: controller.signal });
    await executorStarted;
    controller.abort();
    const result = await approval;
    assert.equal(executorAborted, true);
    assert.equal(result.applied, false);
    assert.equal(result.partialFailure, false);
    assert.equal(result.error.code, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Quick Push rejects stale repository state before invoking the executor", async () => {
  const { GitService, GitQuickPushService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-quick-push-stale-"));
  try {
    await initialise(root);
    const git = new GitService();
    const binding = await git.bindProject("project", root);
    let calls = 0;
    const quickPush = new GitQuickPushService(
      git,
      { plan: () => ({ actions: [{ kind: "commit", target: "main", summary: "Commit reviewed changes", mutatesRevision: true }] }) },
      { execute: async () => { calls += 1; return { applied: true }; } },
    );
    const proposal = await quickPush.propose({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId, provider: "claude", targetBranch: "main" });
    await writeFile(join(root, "new.txt"), "state changed after review\n");
    await assert.rejects(
      () => quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest }),
      (error) => error instanceof GitServiceError && error.code === "proposal-stale",
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Quick Push stops with a deterministic partial result when state changes between actions", async () => {
  const { GitService, GitQuickPushService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-quick-push-midflow-"));
  try {
    await initialise(root);
    const git = new GitService();
    const binding = await git.bindProject("project", root);
    const quickPush = new GitQuickPushService(
      git,
      { plan: () => ({ actions: [
        { kind: "push", target: "main", summary: "Push", mutatesRevision: false },
        { kind: "pull-request", target: "main", summary: "Open pull request", mutatesRevision: false },
      ] }) },
      { execute: async (action) => {
        if (action.kind === "push") await writeFile(join(root, "external-change.txt"), "changed while push was running\n");
        return { applied: true };
      } },
    );
    const proposal = await quickPush.propose({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId, provider: "codex", targetBranch: "main" });
    const result = await quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest });
    assert.equal(result.applied, true);
    assert.equal(result.partialFailure, true);
    assert.deepEqual(result.results.map((entry) => entry.action.kind), ["push"]);
    assert.equal(result.error.code, "proposal-stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Quick Push reports deterministic partial failure and still prevents replay", async () => {
  const { GitService, GitQuickPushService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-quick-push-failure-"));
  try {
    await initialise(root);
    const git = new GitService();
    const binding = await git.bindProject("project", root);
    const quickPush = new GitQuickPushService(
      git,
      { plan: () => ({ actions: [
        { kind: "commit", target: "main", summary: "Commit", mutatesRevision: true },
        { kind: "push", target: "main", summary: "Push", mutatesRevision: false },
      ] }) },
      { execute: async (action) => action.kind === "push" ? { applied: false, detail: "remote rejected password=secret" } : { applied: true } },
    );
    const proposal = await quickPush.propose({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId, provider: "codex", targetBranch: "main" });
    const result = await quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest });
    assert.equal(result.applied, true);
    assert.equal(result.partialFailure, true);
    assert.deepEqual(result.results.map((entry) => [entry.action.kind, entry.applied]), [["commit", true], ["push", false]]);
    assert.equal(result.results[1].detail.includes("secret"), false);
    assert.equal(result.error.code, "action-failed");
    await assert.rejects(
      () => quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest }),
      (error) => error instanceof GitServiceError && error.code === "proposal-replayed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function initialise(root) {
  await mkdir(root, { recursive: true });
  await git(["init", "-b", "main"], root);
  await git(["config", "user.email", "test@example.invalid"], root);
  await git(["config", "user.name", "Terminay Test"], root);
  await writeFile(join(root, "file.txt"), "base\n");
  await git(["add", "file.txt"], root);
  await git(["commit", "-m", "initial"], root);
}

async function git(args, cwd) {
  await execFileAsync("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
