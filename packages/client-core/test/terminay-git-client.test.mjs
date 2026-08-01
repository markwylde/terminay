import assert from "node:assert/strict";
import test from "node:test";
import { TerminayGitClient } from "../dist/index.js";

function transport() {
  const calls = [];
  return {
    calls,
    async query(operation, payload, options) {
      calls.push(["query", operation, payload, options]);
      return { worktrees: [] };
    },
    async command(operation, payload, options) {
      calls.push(["command", operation, payload, options]);
      return { ok: true };
    },
  };
}

const reference = { projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a" };

test("TerminayGitClient sends opaque references and reviewed Quick Push data", async () => {
  const fake = transport();
  const client = new TerminayGitClient(fake, { capabilities: { nativeWindows: true, clipboard: true } });
  await client.list({ projectId: "project-a", repositoryId: "repo-a" });
  await client.openTerminal(reference);
  await client.renamePresentation(reference, "Feature worktree");
  await client.copy(reference);
  await client.remove(reference, "abc123");
  await client.move(reference, "renamed", "abc123");
  await client.proposeQuickPush({ ...reference, provider: "codex", targetBranch: "main" });
  await client.approveQuickPush({ proposalId: "proposal-a", revision: { head: "abc" }, actionDigest: "digest-a" });
  assert.deepEqual(fake.calls.map(([kind, operation]) => [kind, operation]), [
    ["query", "git.worktrees.list"],
    ["command", "git.worktree.open-terminal"],
    ["command", "git.worktree.rename"],
    ["command", "git.worktree.copy"],
    ["command", "git.worktree.remove"],
    ["command", "git.worktree.move"],
    ["command", "git.quick-push.propose"],
    ["command", "git.quick-push.approve"],
  ]);
  assert.equal(Object.hasOwn(fake.calls[1][2], "path"), false);
  assert.equal(fake.calls[4][2].expectedHead, "abc123");
  assert.equal(fake.calls[5][2].name, "renamed");
  assert.equal(fake.calls[6][2].targetBranch, "main");
});

test("TerminayGitClient fails closed for unavailable reveal/copy capabilities", async () => {
  const fake = transport();
  const client = new TerminayGitClient(fake, { capabilities: {} });
  assert.throws(() => client.reveal(reference), /capability is unavailable: nativeWindows/);
  assert.throws(() => client.copy(reference), /capability is unavailable: clipboard/);
  assert.equal(fake.calls.length, 0);
});

test("TerminayGitClient rejects path-like and unsafe reviewed values before transport", async () => {
  const fake = transport();
  const client = new TerminayGitClient(fake, { capabilities: { clipboard: true } });
  assert.throws(() => client.copy({ ...reference, worktreeId: "../../outside" }), /worktreeId/);
  assert.throws(() => client.proposeQuickPush({ ...reference, provider: "codex", targetBranch: "--evil" }), /targetBranch/);
  assert.throws(() => client.renamePresentation(reference, "bad\nname"), /presentation name/);
  assert.throws(() => client.move(reference, "../escape"), /directory name/);
  assert.equal(fake.calls.length, 0);
});
