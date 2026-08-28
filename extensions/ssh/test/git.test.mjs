import assert from "node:assert/strict";
import test from "node:test";
import { RemoteGitService } from "../dist/index.js";

function channel(stdout, code = 0) {
  const listeners = new Map();
  const stderrListeners = new Map();
  const value = {
    on(event, listener) { listeners.set(event, listener); return value; },
    once(event, listener) { listeners.set(`once:${event}`, listener); queueMicrotask(() => { listeners.get("data")?.(Buffer.from(stdout)); listeners.get("once:close")?.(code); }); return value; },
    stderr: { on(event, listener) { stderrListeners.set(event, listener); return value.stderr; } },
    write() { return true; }, setWindow() {}, signal() {}, end() {},
  };
  return value;
}

function serviceFor(replies) {
  const commands = [];
  const service = new RemoteGitService({
    async acquire() {
      return {
        client: {
          exec(command, callback) {
            commands.push(command);
            const reply = replies.find((candidate) => candidate.match.test(command));
            callback(null, channel(reply?.stdout ?? "", reply?.code ?? 0));
          },
        },
        release() {},
      };
    },
  });
  return { service, commands };
}

const missingRepo = [{ match: /rev-parse --is-inside-work-tree/u, stdout: "fatal: not a git repository", code: 128 }];
const readyRepo = [
  { match: /rev-parse --is-inside-work-tree/u, stdout: "true\n" },
  { match: /rev-parse --show-toplevel/u, stdout: "/home/vms/repo\n" },
  { match: /symbolic-ref/u, stdout: "main\n" },
  { match: /rev-parse HEAD/u, stdout: "abcdef1234567890abcdef1234567890abcdef12\n" },
  { match: /worktree list/u, stdout: "worktree /home/vms/repo\nHEAD abcdef1234567890abcdef1234567890abcdef12\nbranch refs/heads/main\n" },
];
const input = { profileId: "profile", revision: 1, root: "/home/vms", payload: { projectId: "project" } };
const emptyBranch = { name: null, detached: false, head: null, upstream: null, upstreamState: "none", ahead: null, behind: null };

test("remote Git reports a VM home directory as a normal non-repository", async () => {
  const { service, commands } = serviceFor(missingRepo);
  const result = await service.invoke("worktrees", input);
  assert.deepEqual(result, { projectId: "project", repositoryId: null, repositoryRoot: null, defaultBranch: null, state: "not-repository", worktrees: [], bounded: false });
  assert.match(commands[0], /git -C '\/home\/vms' rev-parse/);
});

test("remote Git status, branch, and diff use the application protocol for a missing repository", async () => {
  const { service } = serviceFor(missingRepo);
  const status = await service.invoke("status", input);
  assert.deepEqual(status, {
    projectId: "project", repositoryId: null, repositoryRoot: null, worktreeId: null, worktreeRoot: null,
    state: "not-repository", branch: emptyBranch, head: null, entries: [], bounded: false,
  });
  assert.deepEqual(await service.invoke("branches", input), { ...status, operation: "branch" });
  assert.deepEqual(await service.invoke("diff", { ...input, payload: { projectId: "project", path: "src/file.ts" } }), {
    projectId: "project", repositoryId: null, worktreeId: null, state: "not-repository",
    compareTarget: "HEAD", path: "src/file.ts", files: [], hunks: [], patch: "", binary: false, bounded: false,
  });
});

test("remote Git status, branch, worktrees, and diff carry protocol identities for a repository", async () => {
  const { service } = serviceFor(readyRepo);
  const status = await service.invoke("status", { ...input, root: "/home/vms/repo" });
  assert.equal(status.state, "ready");
  assert.equal(status.projectId, "project");
  assert.equal(status.repositoryRoot, "/home/vms/repo");
  assert.equal(status.worktreeRoot, "/home/vms/repo");
  assert.match(status.repositoryId, /^repository:[0-9a-f]{32}$/u);
  assert.match(status.worktreeId, /^worktree:[0-9a-f]{32}$/u);
  assert.equal(status.branch.name, "main");
  assert.equal(status.head, "abcdef1234567890abcdef1234567890abcdef12");
  assert.equal(status.bounded, false);
  assert.deepEqual(status.entries, []);

  const branch = await service.invoke("branches", { ...input, root: "/home/vms/repo" });
  assert.equal(branch.operation, "branch");
  assert.equal(branch.projectId, "project");
  assert.equal(branch.worktreeRoot, "/home/vms/repo");
  assert.equal(branch.branch.name, "main");

  const worktrees = await service.invoke("worktrees", { ...input, root: "/home/vms/repo" });
  assert.equal(worktrees.state, "ready");
  assert.equal(worktrees.projectId, "project");
  assert.equal(worktrees.repositoryRoot, "/home/vms/repo");
  assert.equal(worktrees.defaultBranch, "main");
  assert.equal(worktrees.worktrees.length, 1);
  assert.equal(worktrees.worktrees[0].path, "/home/vms/repo");
  assert.equal(worktrees.worktrees[0].isMain, true);
  assert.equal(worktrees.worktrees[0].branch, "main");

  const diff = await service.invoke("diff", { ...input, root: "/home/vms/repo" });
  assert.equal(diff.projectId, "project");
  assert.equal(diff.state, "ready");
  assert.equal(diff.compareTarget, "HEAD");
  assert.equal(diff.path, null);
  assert.deepEqual(diff.files, []);
  assert.deepEqual(diff.hunks, []);
});

test("unknown remote Git operations fail closed", async () => {
  const { service } = serviceFor(readyRepo);
  await assert.rejects(() => service.invoke("fetch", { ...input, root: "/home/vms/repo" }), /unavailable/);
});
