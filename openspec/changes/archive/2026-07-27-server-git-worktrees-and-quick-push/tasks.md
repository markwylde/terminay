## 1. Repository and status

- [x] 1.1 Move repository detection, branch/status, changed-file, normalized diff,
  and refresh events into server-core, verified by the server Git service tests
- [x] 1.2 Bind every operation to a canonical project, repository, and worktree,
  verified by rejection of client-supplied paths
- [x] 1.3 Preserve detached-head, missing gitfile, absent remote, unmerged, and
  command-error states, verified by the per-state fixtures
- [x] 1.4 Publish bounded progress and status changes to authorized clients: the
  server Git service emits ordered `git.progress` and `git.status.changed`
  metadata with bounded revisions, and client projections detect gaps and request
  resync instead of inventing status transitions

## 2. Worktrees

- [x] 2.1 Move list, open terminal, switch project root, rename presentation,
  remove, and pull operations to the server. `ServerGitAdapter` exposes
  project-scoped status/diff/worktree queries and opaque-ID lifecycle commands;
  `GitService.pullWorktree` performs clean/upstream/stale checks and verifies the
  post-pull status
- [x] 2.2 Revalidate worktree identity and Git invariants before mutation: the
  server resolves an opaque worktree ID from its bounded listing, checks the
  reviewed full HEAD, re-reads status immediately before `git worktree remove`, and
  verifies the identity is gone
- [x] 2.3 Prevent removal of the main worktree and unsafe dirty or unmerged
  deletion; bare, locked, prunable, dirty, and unmerged worktrees are rejected
- [x] 2.4 Keep reveal and copy behaviour capability-aware for remote clients: host
  capabilities gate native reveal and clipboard copy, callbacks receive only opaque
  identities, and callback results strip path metadata

## 3. Quick Push

- [x] 3.1 Run provider discovery, planning, and Git/remote commands on the server
  machine. `GitProviderService` resolves remotes from canonical worktree IDs,
  composes discovery with review-bound planning, and executes fixed Git, GitHub,
  and Gitea actions with bounded output and cancellation
- [x] 3.2 Produce a bounded structured proposal for explicit client review; the
  server bounds status and diff context and validates the ordered action plan
- [x] 3.3 Bind approval to repository revision, target, and exact proposed actions:
  approval carries canonical IDs, a status/revision digest, and an action digest,
  and is single-use and expiring
- [x] 3.4 Revalidate immediately before each mutation and stop with deterministic
  partial-failure reporting when state changes; a stale next-step revision is
  returned as a partial failure after already-applied actions
- [x] 3.5 Preserve default-branch and already-applied-commit semantics without
  implicit history rewriting, verified by the default-branch Quick Push fixture
  proving an already-applied commit is skipped and the resulting branch is still
  pushed

## 4. Credentials and cancellation

- [x] 4.1 Keep Git, SSH, provider CLI, GitHub, and Gitea credentials in the server
  environment and vault; provider execution inherits the server Git environment or
  resolves provider bytes through an injected server credential callback
- [x] 4.2 Never copy credential material into protocol snapshots or client
  settings; provider output is redacted and the client Git contract contains only
  canonical IDs, reviewed actions, and bounded proposal metadata
- [x] 4.3 Add cancellation and bounded output for long Git and provider operations:
  the planner and each executor action receive a linked abort signal, have a
  server-side deadline, and expose only bounded and redacted provider output

## 5. Tests

- [x] 5.1 Run status, diff, worktree, default-branch, and PR tests through the
  server client: `git-framed-client.test.mjs` runs the real
  `TerminayClient`/`TerminayGitClient` over the bounded framed transport into
  `ServerGitAdapter`, covering status, branch, normalized diff, worktree
  listing/default-branch inference, reviewed proposal, and push plus pull-request
  approval semantics
- [x] 5.2 Test stale review, replayed approval, path substitution, main-worktree
  removal, detached head, missing remote, and partial failure; the Git adapter,
  `GitService`, worktree, and Quick Push fixtures pass all of these with single-use
  approval and deterministic partial results
- [x] 5.3 Test two clients observing one mutation and one resulting status
  revision, verified by two `GitService` subscribers asserting identical ordered
  events and revisions

## 6. Acceptance

- [x] 6.1 Local and remote clients see the same project repository and worktree
  state
- [x] 6.2 Quick Push mutates nothing before a review bound to the exact server state
- [x] 6.3 A stale or replayed approval is rejected
- [x] 6.4 Git, SSH, and provider credentials never reach a remote client
- [x] 6.5 Errors identify the exact failed proposal, Git, push, or pull-request step
