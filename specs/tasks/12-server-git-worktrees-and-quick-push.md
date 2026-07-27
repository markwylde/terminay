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

- [ ] Move repository detection, branch/status, changed-file, normalized diff,
  and refresh events into server-core.
- [ ] Bind every operation to a canonical project/repository/worktree.
- [ ] Preserve detached-head, missing gitfile, absent remote, unmerged, and
  command-error states.
- [ ] Publish bounded progress and status changes to authorized clients.

### Worktrees

- [ ] Move list, open terminal, switch project root, rename presentation,
  remove, and pull operations to the server.
- [ ] Revalidate worktree identity and Git invariants before mutation.
- [ ] Prevent removal of the main worktree and unsafe dirty/unmerged deletion.
- [ ] Keep reveal/copy behaviour capability-aware for remote clients.

### Quick Push

- [ ] Run provider discovery/planning and Git/remote commands on the server
  machine.
- [ ] Produce a bounded structured proposal for explicit client review.
- [ ] Bind approval to repository revision, target, and exact proposed actions.
- [ ] Revalidate immediately before each mutation and stop with deterministic
  partial-failure reporting when state changes.
- [ ] Preserve default-branch and already-applied-commit semantics without
  implicit history rewriting.

### Credentials and cancellation

- [ ] Keep Git, SSH, provider CLI, GitHub, and Gitea credentials in the server
  environment/vault.
- [ ] Never copy credential material into protocol snapshots or client
  settings.
- [ ] Add cancellation and bounded output for long Git/provider operations.

### Tests

- [ ] Run status, diff, worktree, default-branch, and PR tests through the
  server client.
- [ ] Test stale review, replayed approval, path substitution, main-worktree
  removal, detached head, missing remote, and partial failure.
- [ ] Test two clients observing one mutation and one resulting status revision.

## Acceptance checks

- Local and remote clients see the same project repository/worktree state.
- Quick Push mutates nothing before a review bound to the exact server state.
- A stale or replayed approval is rejected.
- Git/SSH/provider credentials never reach a remote client.
- Errors identify the exact failed proposal, Git, push, or pull-request step.

## Definition of done

Terminay Server is the only Git/worktree/Quick Push execution authority, and
the reviewed workflow is transport-independent and revision-safe.
