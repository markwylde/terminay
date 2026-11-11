import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repository = { origin: "https://git.example.net", owner: "acme", name: "app" };

async function fixture(prefix) {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), prefix));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  await mkdir(remote);
  await git(["init", "--bare", "-b", "main", remote], root);
  await initialise(repo);
  await git(["remote", "add", "origin", remote], repo);
  await git(["push", "origin", "main"], repo);
  const service = new GitService();
  await service.bindProject("project-a", repo);
  return { root, remote, repo, service };
}

const create = (service, branch, extra = {}) =>
  service.createWorktree({ projectId: "project-a", branch, base: { kind: "default" }, remotes: ["origin"], ...extra });

test("planning returns the sibling path and creates nothing", async () => {
  const { root, repo, service } = await fixture("terminay-wt-plan-");
  try {
    const result = await create(service, "issue-541-home-sidebar", { plan: true });
    assert.equal(result.applied, false);
    assert.equal(result.error, undefined);
    assert.equal(basename(result.path), "repo-issue-541-home-sidebar");
    assert.equal(result.branchValid, true);
    assert.equal(result.branchExists, false);
    assert.equal(result.remote, "origin");
    assert.equal(await exists(result.path), false);
    assert.equal(await branchExists(repo, "issue-541-home-sidebar"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a new branch is created from the remote default branch without tracking it", async () => {
  const { root, repo, service } = await fixture("terminay-wt-new-");
  try {
    const result = await create(service, "feature/issue-541");
    assert.equal(result.error, undefined);
    assert.equal(result.applied, true);
    assert.equal(basename(result.path), "repo-feature-issue-541");
    assert.ok(result.worktreeId);
    assert.equal(await branchExists(repo, "feature/issue-541"), true);
    assert.equal(await config(repo, "branch.feature/issue-541.merge"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a remote branch is tracked", async () => {
  const { root, repo, service } = await fixture("terminay-wt-track-");
  try {
    await git(["switch", "-c", "change/13-events"], repo);
    await git(["push", "origin", "change/13-events"], repo);
    await git(["switch", "main"], repo);
    await git(["branch", "-D", "change/13-events"], repo);
    const result = await create(service, "change/13-events", { base: { kind: "track", remoteBranch: "change/13-events" } });
    assert.equal(result.error, undefined);
    assert.equal(result.applied, true);
    assert.equal(await config(repo, "branch.change/13-events.merge"), "refs/heads/change/13-events");
    assert.equal(await config(repo, "branch.change/13-events.remote"), "origin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an existing local branch is refused unless reuse is asked for", async () => {
  const { root, repo, service } = await fixture("terminay-wt-reuse-");
  try {
    await git(["branch", "change/13-events"], repo);
    const refused = await create(service, "change/13-events");
    assert.equal(refused.error?.code, "branchExists");
    assert.equal(await exists(refused.path), false);
    const reused = await create(service, "change/13-events", { reuseExisting: true });
    assert.equal(reused.error, undefined);
    assert.equal(reused.applied, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a checked-out branch returns its worktree path", async () => {
  const { root, repo, service } = await fixture("terminay-wt-checked-");
  try {
    const elsewhere = join(root, "elsewhere");
    await git(["worktree", "add", "-b", "taken", elsewhere], repo);
    const result = await create(service, "taken", { reuseExisting: true });
    assert.equal(result.error?.code, "checkedOut");
    assert.equal(basename(result.error.path), "elsewhere");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two creations of one branch at once: one succeeds, the other is told it is checked out", async () => {
  const { root, service } = await fixture("terminay-wt-race-");
  try {
    const results = await Promise.all([create(service, "same"), create(service, "same")]);
    assert.equal(results.filter((result) => result.applied).length, 1);
    const loser = results.find((result) => !result.applied);
    assert.equal(loser.error?.code, "checkedOut");
    assert.equal(loser.error.path, results.find((result) => result.applied).path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed fetch leaves no branch or directory behind", async () => {
  const { root, repo, service } = await fixture("terminay-wt-fetch-");
  try {
    await git(["remote", "set-url", "origin", join(root, "missing.git")], repo);
    const result = await create(service, "doomed");
    assert.equal(result.applied, false);
    assert.equal(result.error?.code, "fetchFailed");
    assert.equal(await exists(result.path), false);
    assert.equal(await branchExists(repo, "doomed"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an invalid branch name or one that reads as a flag is refused", async () => {
  const { root, service } = await fixture("terminay-wt-invalid-");
  try {
    for (const branch of ["bad..name", "-b", "with space"]) {
      const result = await create(service, branch);
      assert.equal(result.error?.code, "invalidBranch", branch);
      assert.equal(result.applied, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no claimed remote present gives remoteMissing", async () => {
  const { root, service } = await fixture("terminay-wt-remote-");
  try {
    const result = await create(service, "x", { remotes: ["upstream"] });
    assert.equal(result.error?.code, "remoteMissing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the adapter refuses read scope and uses the claimed remotes", async () => {
  const { ServerGitAdapter } = await import("../dist/gitService/index.js");
  const { root, repo, service } = await fixture("terminay-wt-adapter-");
  try {
    const asked = [];
    const adapter = new ServerGitAdapter({
      serverId: "server-a",
      git: service,
      resolveProjectRoot: () => repo,
      forgeRemotes: async (projectId, value) => {
        asked.push([projectId, value]);
        return ["origin"];
      },
    });
    const handler = adapter.operations().commands["git.worktree.create"];
    const request = (authScope, payload) => ({ envelope: { payload }, body: new Uint8Array(), context: { authScope, clientId: "c" } });
    const payload = { projectId: "project-a", repository, branch: "issue-1", plan: true };
    await assert.rejects(handler(request("read", payload)), /write scope/);
    const planned = (await handler(request("write", payload))).result;
    assert.equal(planned.plan, true);
    assert.deepEqual(asked, [["project-a", repository]]);
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(cwd, branch) {
  try {
    await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function config(cwd, key) {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", key], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function git(args, cwd) {
  await execFileAsync("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
