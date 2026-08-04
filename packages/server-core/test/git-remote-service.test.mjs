import assert from "node:assert/strict";
import test from "node:test";

test("Git provider remote parsing is bounded and exposes only provider metadata", async () => {
  const { parseGitRemote } = await import("../dist/gitService/index.js");
  assert.deepEqual(parseGitRemote("origin", "git@github.com:acme/project.git"), {
    name: "origin",
    url: "git@github.com:acme/project.git",
    host: "github.com",
    owner: "acme",
    repository: "project",
    webUrl: "https://github.com/acme/project",
    provider: "github",
  });
  assert.equal(parseGitRemote("origin", "/srv/repositories/project.git").provider, "unknown");
  assert.throws(() => parseGitRemote("bad name", "https://github.com/acme/project.git"), /remote name/);
  assert.throws(() => parseGitRemote("origin", "https://github.com/acme/project.git\nsecret"), /remote URL/);
});

test("GitProviderService resolves worktree IDs and executes fixed remote actions with bounded output", async () => {
  const { GitProviderService } = await import("../dist/gitService/index.js");
  const calls = [];
  const git = {
    async worktrees(request) {
      calls.push(["list", request]);
      return {
        projectId: request.projectId,
        repositoryId: request.repositoryId,
        repositoryRoot: "/server/repository",
        defaultBranch: "main",
        state: "ready",
        worktrees: [{ id: "worktree-a", repositoryId: request.repositoryId, path: "/server/repository", branch: "main", detached: false, head: "abc", isMain: true, isBare: false, isPrunable: false, locked: false, state: "clean", entries: [] }],
        bounded: false,
      };
    },
  };
  const gitRunner = {
    async run(args, cwd) {
      calls.push(["git", args, cwd]);
      if (args[0] === "remote") return { stdout: "git@github.com:acme/project.git\n", stderr: "", exitCode: 0, truncated: false };
      return { stdout: "", stderr: "", exitCode: 0, truncated: false };
    },
  };
  const providerRunner = {
    async run(command, args, cwd, options) {
      calls.push(["provider", command, args, cwd, options]);
      return { stdout: "https://github.com/acme/project/pull/1 token=secret", stderr: "", exitCode: 0, truncated: false };
    },
  };
  const service = new GitProviderService(git, { git: gitRunner, provider: providerRunner, maxOutputBytes: 128 });
  const context = { projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", branch: "main", head: "abc", entries: [], patch: "", bounded: false };
  const discovery = await service.discover(context);
  assert.equal(discovery.remote.provider, "github");
  assert.equal(discovery.pullRequestSupported, true);
  const result = await service.execute({ kind: "pull-request", target: "main", summary: "Reviewed PR", mutatesRevision: false }, context);
  assert.equal(result.applied, true);
  assert.equal(result.detail.includes("secret"), false);
  assert.equal(calls.some((call) => call[0] === "provider" && call[1] === "gh" && call[2].includes("--base")), true);
  assert.equal(JSON.stringify(calls).includes("/server/other"), false);
});

test("GitProviderService never accepts a client-selected cwd or raw provider command", async () => {
  const { GitProviderService, GitServiceError } = await import("../dist/gitService/index.js");
  const service = new GitProviderService({
    async worktrees() {
      return { projectId: "project-a", repositoryId: "repo-a", repositoryRoot: "/server/repository", defaultBranch: "main", state: "ready", worktrees: [], bounded: false };
    },
  }, { git: { run: async () => ({ stdout: "", stderr: "", exitCode: 0, truncated: false }) } });
  await assert.rejects(() => service.execute({ kind: "push", target: "--receive-pack=evil", summary: "Push", mutatesRevision: false }, { projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", branch: "main", head: "abc", entries: [], patch: "", bounded: false }), (error) => error instanceof GitServiceError && error.code === "worktree-not-found");
});

test("GitProviderService scopes provider credentials to the server callback and never returns them", async () => {
  const { GitProviderService } = await import("../dist/gitService/index.js");
  const context = { projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", branch: "main", head: "abc", entries: [], patch: "", bounded: false };
  const seen = [];
  const service = new GitProviderService({
    async worktrees() {
      return { projectId: "project-a", repositoryId: "repo-a", repositoryRoot: "/server/repository", defaultBranch: "main", state: "ready", worktrees: [{ id: "worktree-a", repositoryId: "repo-a", path: "/server/repository", branch: "main", detached: false, head: "abc", isMain: true, isBare: false, isPrunable: false, locked: false, state: "clean", entries: [] }], bounded: false };
    },
  }, {
    git: { run: async (args) => args[0] === "remote" ? { stdout: "https://github.com/acme/project.git", stderr: "", exitCode: 0, truncated: false } : { stdout: "", stderr: "", exitCode: 0, truncated: false } },
    credentials: { withCredential: async (_provider, callback) => callback(new TextEncoder().encode("server-secret")) },
    provider: { run: async (_command, _args, _cwd, options) => { seen.push(options.credential); return { stdout: "created", stderr: "", exitCode: 0, truncated: false }; } },
  });
  const result = await service.execute({ kind: "pull-request", target: "main", summary: "Create reviewed PR", mutatesRevision: false }, context);
  assert.equal(result.applied, true);
  assert.equal(new TextDecoder().decode(seen[0]), "server-secret");
  assert.equal(JSON.stringify(result).includes("server-secret"), false);
});

test("GitProviderService composes provider discovery/planning with review-bound Quick Push", async () => {
  const { GitProviderService } = await import("../dist/gitService/index.js");
  const worktreeId = "worktree-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const context = { projectId: "project-a", repositoryId: "repo-a", worktreeId, branch: "main", head: "abc", entries: [], patch: "", bounded: false };
  const git = {
    async worktrees() { return { projectId: "project-a", repositoryId: "repo-a", repositoryRoot: "/server/repository", defaultBranch: "main", state: "ready", worktrees: [{ id: worktreeId, repositoryId: "repo-a", path: "/server/repository", branch: "main", detached: false, head: "abc", isMain: true, isBare: false, isPrunable: false, locked: false, state: "clean", entries: [] }], bounded: false }; },
    async status() { return { ...context, state: "ready", repositoryRoot: "/server/repository", worktreeRoot: "/server/repository", branch: { name: "main", detached: false, head: "abc", upstream: "origin/main", upstreamState: "configured", ahead: 0, behind: 0 } }; },
    async diff() { return { projectId: "project-a", repositoryId: "repo-a", worktreeId, state: "ready", compareTarget: "HEAD", path: null, files: [], hunks: [], patch: "", binary: false, bounded: false }; },
  };
  const service = new GitProviderService(git, { git: { run: async (args) => args[0] === "remote" ? { stdout: "git@github.com:acme/project.git", stderr: "", exitCode: 0, truncated: false } : { stdout: "", stderr: "", exitCode: 0, truncated: false } } });
  const quickPush = service.createQuickPushService({ plan: async (_context, discovery) => {
    assert.equal(discovery.remote.provider, "github");
    return { actions: [{ kind: "push", target: "main", summary: "Push reviewed changes", mutatesRevision: false }] };
  } });
  const proposal = await quickPush.propose({ projectId: "project-a", repositoryId: "repo-a", worktreeId, provider: "codex", targetBranch: "main" });
  const result = await quickPush.approve({ proposalId: proposal.proposalId, revision: proposal.revision, actionDigest: proposal.actionDigest });
  assert.equal(result.applied, true);
  assert.equal(result.partialFailure, false);
});
