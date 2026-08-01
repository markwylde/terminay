# Server Git, worktrees, and Quick Push

## Goal

Move repository, worktree, provider-planning, commit, push, and pull-request
operations into Terminay Server while preserving explicit review and Git
safety.

## Governing specifications

- [Git worktrees and Quick Push](../features/git-worktrees-and-quick-push.md)
- [File viewer](../features/file-viewer.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Git and provider CLI work is Electron-owned and addressed by renderer-selected
paths. Remote clients need the same project-scoped status and reviewed mutation
flow without receiving server credentials or raw command authority.

## Dependencies

- [Server files and file viewer](./11-server-files-and-file-viewer.md)

## Work slices

### Repository and status

- [x] Move repository detection, branch/status, changed-file, normalized diff,
  and refresh events into server-core.
- [x] Bind every operation to a canonical project/repository/worktree.
- [x] Preserve detached-head, missing gitfile, absent remote, unmerged, and
  command-error states.
- [x] Publish bounded progress and status changes to authorized clients. The
  server Git service now emits ordered `git.progress` and
  `git.status.changed` metadata with bounded revisions; client projections
  detect gaps and request resync instead of inventing status transitions.

### Worktrees

- [x] Move list, open terminal, switch project root, rename presentation,
  remove, and pull operations to the server. `ServerGitAdapter` exposes
  project-scoped status/diff/worktree queries and opaque-ID lifecycle commands;
  `GitService.pullWorktree` performs clean/upstream/stale checks and verifies
  the post-pull status.
- [x] Revalidate worktree identity and Git invariants before mutation. The
  server resolves an opaque worktree ID from its bounded listing, checks the
  reviewed full HEAD, re-reads status immediately before `git worktree
  remove`, and verifies the identity is gone.
- [x] Prevent removal of the main worktree and unsafe dirty/unmerged deletion.
  Bare, locked, prunable, dirty, and unmerged worktrees are rejected as well.
- [x] Keep reveal/copy behaviour capability-aware for remote clients. Host
  capabilities gate native reveal and clipboard copy, callbacks receive only
  opaque identities, and callback results strip path metadata.

### Quick Push

- [x] Run provider discovery/planning and Git/remote commands on the server
  machine. `GitProviderService` resolves remotes from canonical worktree IDs,
  composes discovery with review-bound planning, and executes fixed Git/GitHub/
  Gitea actions with bounded output and cancellation.
- [x] Produce a bounded structured proposal for explicit client review. The
  server bounds status/diff context and validates the ordered action plan.
- [x] Bind approval to repository revision, target, and exact proposed actions.
  Approval carries canonical IDs, a status/revision digest, and an action
  digest, and is single-use/expiring.
- [x] Revalidate immediately before each mutation and stop with deterministic
  partial-failure reporting when state changes. A stale next-step revision is
  returned as a partial failure after already-applied actions.
- [x] Preserve default-branch and already-applied-commit semantics without
  implicit history rewriting. The default-branch Quick Push fixture proves an
  already-applied commit is skipped and the resulting branch is still pushed.

### Credentials and cancellation

- [x] Keep Git, SSH, provider CLI, GitHub, and Gitea credentials in the server
  environment/vault. Provider execution inherits the server Git environment or
  resolves provider bytes through an injected server credential callback.
- [x] Never copy credential material into protocol snapshots or client
  settings. Provider output is redacted and the client Git contract contains
  only canonical IDs, reviewed actions, and bounded proposal metadata.
- [x] Add cancellation and bounded output for long Git/provider operations.
  Planner and each executor action receive a linked abort signal, have a
  server-side deadline, and expose only bounded/redacted provider output.

### Tests

- [x] Run status, diff, worktree, default-branch, and PR tests through the
  server client. `git-framed-client.test.mjs` runs the real
  `TerminayClient`/`TerminayGitClient` over the bounded framed transport into
  `ServerGitAdapter`, covering status, branch, normalized diff, worktree
  listing/default-branch inference, reviewed proposal, and push plus
  pull-request approval semantics.
- [x] Test stale review, replayed approval, path substitution, main-worktree
  removal, detached head, missing remote, and partial failure. Git adapter,
  GitService, worktree, and Quick Push fixtures pass all of these cases with
  single-use approval and deterministic partial results.
- [x] Test two clients observing one mutation and one resulting status revision.
  `GitService` now has two subscribers asserting identical ordered events and
  revisions for the same status mutation.

## Acceptance checks

- Local and remote clients see the same project repository/worktree state.
- Quick Push mutates nothing before a review bound to the exact server state.
- A stale or replayed approval is rejected.
- Git/SSH/provider credentials never reach a remote client.
- Errors identify the exact failed proposal, Git, push, or pull-request step.

## Definition of done

Terminay Server is the only Git/worktree/Quick Push execution authority, and
the reviewed workflow is transport-independent and revision-safe.
