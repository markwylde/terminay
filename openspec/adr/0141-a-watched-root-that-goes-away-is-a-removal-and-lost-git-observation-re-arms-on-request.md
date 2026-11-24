# ADR-0141: A Git watch whose root goes away is a removal, and lost Git observation re-arms on request

Status: accepted
Date: 2026-11-24

## Context

ADR-0028 made Git status change-driven and said a watch that fails degrades to
on-demand measurement. ADR-0114 built Linux recursion from one-level watches
and kept that failure path. Neither said what a failure is, or whether
observation ever comes back.

In practice, deleting one linked worktree (`git worktree remove`, or `rm -rf`
before `prune`) failed that worktree's tree watch. The Git service treated that
as a repository-wide failure: it closed every watch and marked the repository
unavailable until the project was rebound. Nothing then told the renderer about
the registry change that followed, so the deleted worktree stayed in the
sidebar until a remount forced a fresh listing (issue #652). Deleting a
worktree is ordinary use, not a fault. A rule that turns it into a permanent
loss of observation makes the cache untrustworthy, and so pushes clients
towards fresh measurement on every mount. That is exactly the cost ADR-0028
set out to remove.

## Decision

This decision applies to the Git service's observation of repositories.

1. **A Git watch whose root goes away is a change, not a failure.** When the
   root of a working-tree watch no longer exists, is replaced by a different
   directory, or is already gone when the watch is armed, the watcher reports
   that distinctly on every platform. The Git service closes that one watch and
   re-lists the repository. The repository's other watches stay live.
2. **Only a real loss of coverage is a failure.** Exhausted watch capacity, the
   directory ceiling, an unsupported filesystem, or a Git-directory watch error
   still makes the repository's observation unavailable and measured on demand
   (ADR-0028 Decision 4, ADR-0114 Decision 4).
3. **Unavailable Git observation re-arms only on request.** A client's listing
   request against an unavailable repository starts one attempt to
   re-establish its watches, at most one in flight per repository. Nothing
   else starts one: no timer, retry loop or backoff (ADR-0028 Decision 1). An
   attempt succeeds only when every watch observes its whole scope. The
   repository then returns to change-driven status and cached listings.

## Alternatives rejected

- **Ignore working-tree watch errors and rely on the Git-directory watch to
  see the registry change.** That would also hide genuine coverage losses
  (ENOSPC, the directory ceiling), and those must degrade to on demand.
- **Re-arm on a timer or with backoff.** That is a poll under ADR-0028.
- **Keep failures permanent and have clients re-measure fresh on every mount.**
  That is how things behaved before this decision. It hid the defect and made
  every connection re-measure every worktree.
- **Watch each linked worktree's parent directory to notice a deleted root
  being restored.** Those parents are often outside the project, and the next
  measurement already re-derives the watch set.

## Consequences

- A cached Git listing can be trusted after a worktree removal, so a mount or
  reconnect can be answered from the cache without running Git.
- Each Git watcher implementation has to tell "root gone" apart from other
  errors. On native watches that takes an `lstat` of the root when the watch
  errors, closes, or reports a rename of the root itself.
- On a host that is out of watch capacity, each client request repeats a
  bounded, asynchronous re-arm attempt. That is the accepted cost of recovering
  without a timer.
- Other server watchers (file explorer, agent discovery, extensions) are not
  bound by this record. Each of them decides its own failure and recovery
  semantics against ADR-0028.
