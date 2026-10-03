## Context

`GitService.measureWorktrees` passed its whole request to `resolveDiscovery`,
which treats a `worktreeId` other than the project's own as a target to resolve
and throws `worktree-not-found` when the bounded listing does not contain it.
A listing never runs a command inside the worktree it names: it lists from the
repository root and uses the name only to choose which summaries to carry
forward.

## Goals / Non-Goals

**Goals:**

- A scoped listing succeeds whether or not the worktree it names still exists.

**Non-Goals:**

- Changing how status, diff, or mutations resolve a worktree. Those act inside
  the worktree and still refuse one that is not part of the repository.
- Changing the client's refresh scheduling or banner copy.

## Decisions

- **Resolve the repository, not the named worktree.** The listing drops
  `worktreeId` before discovery and keeps it only as the re-measurement scope.
  A departed worktree is absent from `git worktree list`, so every remaining
  worktree is carried forward and the departed one is not reported. Catching
  `worktree-not-found` and retrying unscoped was rejected: it spends a second
  discovery to recover from a lookup the listing never needed.
- **Boundary.** The server still derives every command's working directory
  from its own bounded listing. The named worktree is an opaque ID compared
  against that listing and is never used as a path, so the project and
  repository authorization boundary is unchanged.

## Risks / Trade-offs

- [A client names an ID that was never a worktree] → It gets an ordinary
  listing with every worktree carried forward, which discloses nothing the
  unscoped listing does not.
