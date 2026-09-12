## Context

`GitService.executePullWorktree` resolves the branch to pull entirely from the
status projection's `branch.upstreamState`. That field is `configured` only when
`git status --porcelain=v2 --branch` prints a `...<remote>/<branch>` tracking
pair, which requires `branch.<name>.remote` and `branch.<name>.merge` in the
repository config. A branch pushed without `-u`, or one only ever updated with
`git pull origin main`, has neither, so the service returns a `command-error`
result with "worktree has no configured upstream remote" and never runs Git.

The renderer discards that result. `TerminayGitClient.pull` resolves with the
server's result object; only transport faults reject. `handlePullWorktreeFromOrigin`
awaits it, then calls `onSetError(null)`, so a refusal is indistinguishable from
a successful pull. Worktree removal already avoids this: `assertWorktreeRemoved`
turns a non-applied result into a thrown error that `onOperationError` renders.

There is also no in-progress state for a pull. Removal has
`deletingWorktreePaths`, which the panel renders as `deleting…` with
`aria-busy`; pull has no equivalent, so a slow network fetch looks like a no-op.

## Goals / Non-Goals

**Goals:**

- Pull a clean, attached branch whose upstream is not configured but whose name
  matches a remote branch.
- Report every non-applied pull result to the user.
- Show pull progress on the worktree row, and prevent a second concurrent pull
  of the same worktree.

**Non-Goals:**

- Writing `branch.<name>.remote` into the user's repository config. Pulling is
  not the moment to change how their branch tracks.
- Anything other than fast-forward. Merge and rebase pulls stay out of scope.
- Changing removal, Quick Push, or the status projection.

## Decisions

**Resolve the pull ref on the server, from Git, not from the client.** The
client keeps sending opaque identities only (ADR 0011's trust boundary: the
renderer never supplies a path or a ref). When `branch.upstreamState` is not
`configured`, the server asks Git which remote branches match the worktree's
branch name via `git for-each-ref --format=%(refname:short) refs/remotes/*/<branch>`,
run in the canonical path re-read immediately before the pull, as the existing
flow already does. Exactly one match is fast-forwarded with
`git pull --ff-only <remote> <branch>`; zero or more than one is reported as an
absent remote, because picking between two remotes would be a guess and
"constraints are reported, not guessed" is already the spec's rule.

Alternative considered: default to `origin` when it exists. Rejected — it
silently prefers a remote the branch may have nothing to do with, and the
for-each-ref probe costs one bounded Git call.

Alternative considered: run `git pull --ff-only origin <branch>` and let Git
fail. Rejected — the failure text would be Git's remote-side error rather than
the specific, actionable "no matching remote branch".

**Surface the failure by mirroring removal.** Add an exported
`assertWorktreePulled` beside `assertWorktreeRemoved` in
`useFileExplorerController`, throwing the server's `error.message` when the
result is not an applied pull. The existing `onOperationError('Git', error)`
path then renders it, so no new error channel crosses the renderer boundary,
and the assertion is a pure function the existing unit test file can cover.

**Track pulling paths as removal tracks deleting paths.** A
`pullingWorktreePaths` set in the controller, passed to `WorktreesPanel`, which
renders `pulling…` in the row meta and sets `aria-busy`. Reusing the established
shape keeps one mental model for in-flight worktree work. The pull context-menu
item is disabled while the worktree is in that set, which is what stops a
second pull; the server's per-repository mutation queue remains the real
serialization.

## Risks / Trade-offs

- A repository with two remotes carrying the same branch name and no configured
  upstream now reports an absent remote instead of pulling → the message names
  the branch, and configuring an upstream resolves it permanently.
- The extra `for-each-ref` adds one Git invocation to pulls on branches without
  an upstream → it is bounded, read-only, and skipped entirely when an upstream
  is configured.
- `pulling…` occupies the same row slot as the `+N -N` line deltas while the
  pull runs → consistent with how `deleting…` already behaves.

## Migration Plan

None. Behaviour-only change with no persisted state, protocol, or config
migration; rollback is reverting the commit.

## Open Questions

None. No in-force ADR needs revisiting.
