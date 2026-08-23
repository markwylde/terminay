import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROTOCOL_LIMITS, encodeFrame } from "@terminay/protocol";

function hugeWorktreeList() {
  const entries = Array.from({ length: 2_000 }, (_, index) => ({
    path: `src/generated/file-${String(index).padStart(4, "0")}.ts`,
    previousPath: null,
    indexStatus: " ",
    worktreeStatus: "M",
    kind: "modified",
    staged: false,
    unstaged: true,
    unmerged: false,
  }));
  return {
    projectId: "project-a",
    repositoryId: "repo-a",
    repositoryRoot: "/repo",
    defaultBranch: "main",
    state: "ready",
    worktrees: [
      {
        id: "worktree-a",
        repositoryId: "repo-a",
        path: "/repo",
        branch: "main",
        detached: false,
        head: "abc1234",
        isMain: true,
        isBare: false,
        isPrunable: false,
        locked: false,
        state: "dirty",
        aheadOfDefaultBranchCount: 0,
        lineAdditions: 2_000,
        lineDeletions: 0,
        hasCommittedChanges: false,
        entries,
      },
    ],
    bounded: false,
  };
}

test("bound Git query results fit inside protocol header limits", async () => {
  const { boundGitQueryResult, gitQueryResultFits } = await import("../dist/gitService/index.js");
  const unbounded = hugeWorktreeList();
  assert.equal(gitQueryResultFits(unbounded), false);
  const bounded = boundGitQueryResult(unbounded);
  assert.equal(bounded.bounded, true);
  assert.ok(Array.isArray(bounded.worktrees[0].entries));
  assert.ok(bounded.worktrees[0].entries.length < unbounded.worktrees[0].entries.length);
  assert.equal(gitQueryResultFits(bounded), true);
  assert.doesNotThrow(() =>
    encodeFrame(
      {
        type: "query_result",
        queryId: "g".repeat(128),
        ok: true,
        result: bounded,
      },
      new Uint8Array(),
      DEFAULT_PROTOCOL_LIMITS,
    ),
  );
});
