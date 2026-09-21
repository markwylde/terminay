## Context

The Git pane is a `SidebarPane` described in `src/App.tsx`. Its header has two
trailing slots, `accessory` and `actions`; Git fills `accessory` with
`<span className="sidebar-pane__branch">{currentGitBranch}</span>` and leaves
`actions` empty. Files uses `actions` for its refresh button.

Worktree rows come from `WorktreesPanel.tsx`. A row reads `clean` when
`isDirtyBranch` is false, `entries` is empty, and both line counts are zero.
`isDirtyBranch` is the server's `hasCommittedChanges`, so the label already
follows the effective-cleanliness requirement.

Single removal runs `useFileExplorerController.ts` → `gitClient.remove(ref, head)`
→ `git.worktree.remove` → `service.ts` `executeRemoveWorktree`, which relists,
rechecks status, compares `expectedHead`, and runs
`git worktree remove --force --force`. The force is deliberate: the confirmation
the user just read says dirty and unmerged work will be destroyed. The controller
already serializes deletions through `worktreeDeleteQueueRef` and marks rows via
`deletingWorktreePaths`.

Constraints from the in-force ADRs: Git executes on the project's server
(ADR-0017); the renderer holds no authority and supplies only opaque IDs
(ADR-0011); the workspace bundle may be connected to a server older than itself
(ADR-0018).

## Goals / Non-Goals

**Goals:**

- One action in the Git pane header that removes every clean worktree after one
  confirmation.
- A bulk action that cannot destroy work, even when the client's listing is
  stale or the server predates this change.

**Non-Goals:**

- Deleting branches, local or remote.
- Closing or relocating terminals whose working directory is inside a removed
  worktree. Single removal does not do this either; it is a separate change.
- Cleaning up prunable (already-missing) registrations in bulk.
- A pane menu for the shared production Git route (`SharedGitRouteBody.tsx`).
- Moving the branch name elsewhere. The current worktree's row shows it.

## Decisions

### The menu button goes in the `actions` slot, and the branch accessory is removed

`actions` is the slot the Files pane already uses for a header button, so the
click handling that keeps a header button from toggling the pane collapse is
already solved there. The button is a `MoreHorizontal` icon from `lucide-react`
at size 14, with `aria-label="Git actions"` and `aria-haspopup="menu"`. It opens
the shared `ContextMenu` anchored at the button's bounding rect, the same way
`useGitPushMenuController` anchors the push menu.

Alternative considered: keep the branch label and add the button beside it. The
header is about 350px wide with a title, a count badge, and a drag handle; the
user asked for the swap, and the branch is one row below.

`currentGitBranch` and `.sidebar-pane__branch` lose their only consumer and are
deleted rather than left dead.

### A distinct server operation, not a flag on `git.worktree.remove`

This is the one decision that crosses the trust boundary. The obvious shape is
`git.worktree.remove` with `requireClean: true`. It fails badly under ADR-0018:
a newer bundle talking to an older server sends the flag, the older server
ignores the unknown field, and runs a double-forced removal on a worktree the
user was told was clean. An unknown *operation* is rejected by an older server,
so `git.worktree.remove-clean` fails closed with no capability negotiation to
get wrong. The batch surfaces that rejection as the skip reason for every
target.

### The server decides cleanliness; the client only nominates

The client's eligibility filter chooses which IDs to send and what the
confirmation lists. It is not trusted. `removeCleanWorktree`:

1. relists worktrees and resolves the canonical path, as forced removal does;
2. rejects main, bare, locked, and prunable entries;
3. requires `expectedHead` and returns `stale-revision` on mismatch — this is
   what catches a new commit, since a commit moves HEAD;
4. runs the same status and `worktreeDelta` computation the listing uses and
   refuses with the existing `worktree-dirty` error if there are entries or
   `hasCommittedChanges` is anything but false;
5. runs `git worktree remove -- <path>` with no `--force`;
6. verifies the identity disappeared.

Step 5 is a second guard, not a convenience: between step 4 and the removal an
agent can still write a file, and unforced removal makes Git refuse a worktree
with modified or untracked files. The remaining window is Git's own.

The relist/resolve/verify steps are shared by giving `executeRemoveWorktree` a
`cleanOnly` mode rather than copying them. The operation goes through
`enqueueRepositoryMutation` and `requireScope('write')` like forced removal.

Alternative considered: a single server-side `git.worktrees.remove-all-clean`
that picks its own targets. Rejected because the user confirms a named list, and
the server deleting a worktree that was not on that list breaks the
review-then-mutate shape the rest of the Git surface follows.

### One eligibility predicate, shared with the row label

`src/workspace/cleanWorktreeSweep.ts` exports `isWorktreeShownClean(worktree)` and
the row's `clean` branch calls it, so "shown as clean" in the spec is one function, not two
expressions that drift. `isBulkDeletableWorktree` adds: not `isMain`, `isBare`,
`isCurrent`, `isLocked`, `isPrunable`, a known HEAD, no status error, and not in
`deletingWorktreePaths` or the pulling set.

Locked worktrees are excluded even though single removal deletes them. A lock is
a user's explicit "keep this"; overriding it is reasonable after a per-worktree
warning and not as a side effect of a sweep.

### Confirmation and outcome use `window.confirm` / `window.alert`

Single removal confirms with `window.confirm`; the bulk action does the same so
the two read alike and no dialog component is introduced. Text:

```
Delete 3 clean worktrees?

  terminay-com-documentation
  terminay-com-extensions
  terminay-com-header-width

These worktrees have no uncommitted or unmerged changes. Their folders are
permanently removed. Branches are kept.
```

Names use the presentation name shown on the row. Beyond 20 targets the list is
truncated with "…and N more". The outcome is silent when everything was deleted
— the rows disappearing is the feedback — and an alert only when something was
skipped, listing each skipped worktree with the server's own message.

### The batch reuses the existing deletion queue

`deleteCleanWorktrees` snapshots the eligible set at click time, confirms, adds
every target path to `deletingWorktreePaths` up front, then chains one
`removeClean` per target onto `worktreeDeleteQueueRef`, collecting results with
per-item `try/catch`. One `loadDirectory` + `refreshGitStatusesForRoot` runs
after the batch instead of once per item. Marking all rows up front also takes
them out of eligibility, so a second click mid-batch finds nothing to do.

## Risks / Trade-offs

- [A worktree that is clean per Git still holds ignored files — `node_modules`,
  build output, `.env`] → Git's unforced removal deletes ignored files without
  complaint, exactly as it does for single removal. The confirmation says the
  folders are permanently removed. Accepted: ignored files are by definition not
  work Git is tracking, and treating them as dirt would make no agent worktree
  ever eligible.
- [A terminal is open inside a removed worktree] → Same exposure as single
  removal today; the shell keeps a dangling cwd. Out of scope, called out in
  Non-Goals.
- [Connected to an older server] → Every target reports the server's
  unknown-operation error and nothing is removed. Noisy but safe.
- [Large batches are slow because removals are serialized] → Required by the
  existing serialization contract; rows show `deleting…` throughout.
- [Removing the branch label loses at-a-glance branch when the Git pane is
  scrolled] → The current worktree sorts first; accepted at the user's request.

## Migration Plan

Additive protocol operation; nothing to migrate. Rollback is reverting the
change — no persisted state is introduced.

## Open Questions

None. No in-force ADR needs revisiting.
