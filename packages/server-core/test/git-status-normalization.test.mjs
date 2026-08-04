import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("Git status parser preserves detached, absent-upstream, and exact unmerged states", async () => {
  const { parseBranchHeader, parseStatus } = await import("../dist/gitService/index.js");

  assert.deepEqual(parseBranchHeader("HEAD (no branch)"), {
    name: null,
    detached: true,
    head: null,
    upstream: null,
    upstreamState: "none",
    ahead: null,
    behind: null,
  });
  assert.deepEqual(parseBranchHeader("main"), {
    name: "main",
    detached: false,
    head: null,
    upstream: null,
    upstreamState: "none",
    ahead: null,
    behind: null,
  });
  assert.deepEqual(parseBranchHeader("main...origin/main [gone]"), {
    name: "main",
    detached: false,
    head: null,
    upstream: "origin/main",
    upstreamState: "missing",
    ahead: null,
    behind: null,
  });

  const parsed = parseStatus("## main\0D  staged-delete\0 D unstaged-delete\0A  staged-add\0UU conflict\0", 20);
  assert.equal(parsed.entries.find((entry) => entry.path === "staged-delete")?.kind, "deleted");
  assert.equal(parsed.entries.find((entry) => entry.path === "unstaged-delete")?.kind, "deleted");
  assert.equal(parsed.entries.find((entry) => entry.path === "staged-add")?.unmerged, false);
  assert.equal(parsed.entries.find((entry) => entry.path === "conflict")?.kind, "unmerged");
  assert.equal(parsed.entries.find((entry) => entry.path === "conflict")?.unmerged, true);

  const bounded = parseStatus("## main\0 M one\0 M two\0", 1);
  assert.equal(bounded.entries.length, 1);
  assert.equal(bounded.bounded, true);
});

test("GitService reports detached HEAD and an upstream whose remote ref is gone", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-state-"));
  try {
    await initRepository(root);
    await git(["remote", "add", "origin", "https://example.invalid/terminay.git"], root);
    await git(["config", "branch.main.remote", "origin"], root);
    await git(["config", "branch.main.merge", "refs/heads/main"], root);

    const service = new GitService();
    const binding = await service.bindProject("project", root);
    const missingRemote = await service.status({ projectId: "project", repositoryId: binding.repositoryId });
    assert.equal(missingRemote.state, "ready");
    assert.equal(missingRemote.branch.name, "main");
    assert.equal(missingRemote.branch.upstream, "origin/main");
    assert.equal(missingRemote.branch.upstreamState, "missing");

    await git(["checkout", "--detach", "HEAD"], root);
    const detached = await service.status({ projectId: "project", repositoryId: binding.repositoryId });
    assert.equal(detached.state, "ready");
    assert.equal(detached.branch.detached, true);
    assert.equal(detached.branch.name, null);
    assert.equal(detached.branch.upstreamState, "none");
    assert.ok(detached.head);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService distinguishes a missing gitfile from an ordinary non-repository", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-metadata-"));
  const missingGitfile = join(root, "missing-gitfile");
  const plainDirectory = join(root, "plain");
  try {
    await mkdir(missingGitfile);
    await mkdir(plainDirectory);
    await writeFile(join(missingGitfile, ".git"), "gitdir: /definitely/missing/terminay-gitdir\n");

    const service = new GitService();
    const missing = await service.bindProject("missing", missingGitfile);
    assert.equal(missing.state, "missing-gitfile");
    const missingStatus = await service.status("missing");
    assert.equal(missingStatus.state, "missing-gitfile");

    const plain = await service.bindProject("plain", plainDirectory);
    assert.equal(plain.state, "not-repository");
    const plainStatus = await service.status("plain");
    assert.equal(plainStatus.state, "not-repository");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService normalizes command failures and unavailable Git without leaking runner errors", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-errors-"));
  try {
    const failingRunner = {
      run(args, cwd) {
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { stdout: `${cwd}\n`, stderr: "", exitCode: 0, truncated: false };
        if (args[0] === "status") return { stdout: "", stderr: "fatal: index is unreadable", exitCode: 128, truncated: false };
        return { stdout: "", stderr: "", exitCode: 0, truncated: false };
      },
    };
    const service = new GitService({ runner: failingRunner });
    await service.bindProject("failing", root);
    const status = await service.status("failing");
    assert.equal(status.state, "command-error");
    assert.equal(status.error?.code, "command-error");
    assert.match(status.error?.stderr ?? "", /index is unreadable/u);

    const unavailableRunner = {
      run() {
        const error = new Error("git executable is unavailable");
        error.code = "GIT_UNAVAILABLE";
        throw error;
      },
    };
    const unavailable = new GitService({ runner: unavailableRunner });
    const binding = await unavailable.bindProject("unavailable", root);
    assert.equal(binding.state, "git-unavailable");
    const unavailableStatus = await unavailable.status("unavailable");
    assert.equal(unavailableStatus.state, "git-unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function initRepository(root) {
  await git(["init", "-b", "main"], root);
  await git(["config", "user.email", "test@example.invalid"], root);
  await git(["config", "user.name", "Terminay Test"], root);
  await writeFile(join(root, "tracked.txt"), "base\n");
  await git(["add", "tracked.txt"], root);
  await git(["commit", "-m", "initial"], root);
}

async function git(args, cwd) {
  await execFileAsync("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
