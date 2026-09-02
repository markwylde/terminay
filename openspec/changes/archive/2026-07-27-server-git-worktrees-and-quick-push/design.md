## Context

See proposal.md. This change depends on the server files and file viewer work,
which established server-side path resolution; Git operations reuse that canonical
addressing rather than accepting renderer paths.

## Goals / Non-Goals

Goals: one Git execution authority on the server, identical project state for
local and remote clients, and a reviewed mutation flow that is revision-safe and
transport-independent.

Non-Goals: implicit history rewriting, giving clients raw command authority, and
any client-side Git execution.

## Decisions

- Every operation binds to a canonical project, repository, and worktree. Opaque
  worktree identities are resolved from the server's own bounded listing, so a
  client cannot name a path.
- Detached-head, missing gitfile, absent remote, unmerged, and command-error
  states are preserved rather than collapsed into a generic failure, because they
  drive different user actions.
- Status changes are published as ordered events with bounded revisions.
  A client projection that detects a gap requests a resync instead of inventing an
  intermediate status. Two clients observing one mutation see identical ordered
  events and the same resulting revision.
- Worktree removal revalidates identity and Git invariants immediately before
  mutating: the server re-resolves the opaque identity, checks the reviewed full
  HEAD, re-reads status, then verifies the identity is gone afterwards. The main
  worktree cannot be removed, and bare, locked, prunable, dirty, and unmerged
  worktrees are rejected.
- `GitService.pullWorktree` performs clean, upstream, and stale checks and
  verifies the post-pull status rather than trusting the command's exit code
  alone.
- Reveal and clipboard copy remain capability-aware: host capabilities gate native
  reveal and copy, callbacks receive only opaque identities, and callback results
  strip path metadata, so a remote client cannot learn server paths.
- Quick Push approval carries canonical identities, a status and revision digest,
  and an action digest, and is single-use and expiring. A stale next-step revision
  is reported as a partial failure after the actions already applied, rather than
  rolling back or continuing blindly.
- Default-branch semantics are preserved without implicit history rewriting: an
  already-applied commit is skipped and the resulting branch is still pushed.
- Provider execution inherits the server Git environment or resolves provider
  bytes through an injected server credential callback. Provider output is
  redacted and bounded, and the client Git contract contains only canonical
  identities, reviewed actions, and bounded proposal metadata.
- The planner and each executor action receive a linked abort signal and a
  server-side deadline, so a long Git or provider operation can be cancelled and
  cannot produce unbounded output.

## Risks / Trade-offs

Deterministic partial-failure reporting means a Quick Push can stop midway with
some actions applied. That is preferred to either an implicit rewrite or a silent
retry against changed state; the report identifies the exact failed proposal, Git,
push, or pull-request step.
