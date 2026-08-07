# Git worktrees and Quick Push

## Summary

Terminay makes Git a project-side workflow rather than a separate terminal
chore. The Git sidebar is worktree-first: it shows repository state and changed
files alongside a Worktrees panel. Quick Push can use a configured local coding
agent to propose and execute a reviewed commit, push, and pull-request flow.

## Git sidebar

- Explorer, Agents, and Git are independently collapsible sidebar panes. Their
  vertical order is user-configurable and persists across projects.
- Git reports the current repository/branch and working-tree changes, with list
  and tree presentations. Selecting a change opens the relevant file/diff using
  the file-viewer contract. When the change belongs to another listed worktree,
  Terminay first switches the project to that worktree so the file read remains
  inside the project security boundary.
- Changed-file rows and their synthetic folder rows follow the Explorer's
  filesystem interaction contract. Double-clicking a file opens its file panel
  (using Diff mode when Git can provide it), while double-clicking a folder
  opens its Folder panel; a folder's single-click disclosure control continues
  to collapse or expand the Git tree. Their context menus expose the same
  applicable create, rename, delete, copy-path, shell, and OS-reveal actions as
  Explorer entries. Folder-only actions are omitted for files, and every action
  remains scoped to the worktree/project that owns the selected path.
- The Worktrees panel shows known worktrees and their state. Users can open a
  terminal at a worktree, switch the project root, copy/reveal its path, rename
  its presentation, remove a worktree, or pull a worktree from origin when
  Git permits it.
- A worktree is shown as clean only when it has no effective committed changes
  relative to the repository default branch and no displayed working-tree
  delta. Commit ancestry alone is insufficient: a squash-merged branch whose
  resulting tree is already present on the default branch is clean, while a
  clean working directory with unmerged committed changes is not.
- Operations make Git's constraints visible: detached heads, missing gitfiles,
  unmerged changes, absent remotes, and failed commands are reported rather than
  guessed around. Removing a worktree must not target the main worktree.

## Quick Push

Quick Push is an optional AI-assisted Git workflow, not autonomous source
control. The user chooses a configured Codex or Claude Code provider and starts
the flow from the relevant Git UI.

1. Terminay gathers bounded repository status, diff, and commit context using
   the user's shell environment.
2. The provider returns a structured commit plan for user review.
3. The user chooses a branch target and confirms the proposed actions.
4. Terminay creates the requested commits, pushes them, and can create a
   provider-aware pull request (GitHub or Gitea) when the repository supports it.

Push targets are grouped by branch intent, including safe handling for the
repository default branch. Terminay skips already-applied commits where that is
the explicitly selected default-branch workflow; it never silently rebases or
rewrites history.

The server-side Quick Push coordinator gives the configured provider only a
bounded status/diff context and accepts a bounded, ordered action plan. The
review response carries the canonical project/repository/worktree IDs, the
observed branch/HEAD/status digest, and an action digest. Approval is
single-use, expires, and is rejected when any of those values no longer match.
Before each injected server-side Git/provider executor action, the coordinator
captures status again; a changed revision produces a deterministic partial
failure instead of silently continuing. Provider planning and execution
callbacks run in the server environment, receive a linked cancellation signal,
and are bounded by server-side deadlines. Provider output returned to the
proposal or action result is bounded and redacted, so credentials never enter
the proposal or protocol response.

## Safety and boundaries

Git commands run in the selected Terminay Server with the target
worktree/repository path, never in the client. Quick Push sends only the bounded
context needed to the selected provider, requires explicit user confirmation
before mutation, and reports the exact failed Git/remote step. Credentials
remain in the server machine's existing Git/SSH/CLI environment rather than
being copied into Terminay settings.

## Ownership

Git, worktree, provider CLI, and Quick Push execution run in the selected
Terminay Server under
[server-owned workspace state](./server-owned-workspace-state.md). Local and
remote clients submit the same scoped commands. Review/confirmation remains a
client interaction, while the server revalidates repository state and
authorization immediately before every mutation.

Read-only repository queries are bound to the canonical project, repository,
and worktree identities held by that server. Status, branch, worktree, and
diff responses are bounded and report detached heads, missing Git metadata,
absent repositories/remotes, unmerged entries, and command failures as
structured state; a client cannot substitute an arbitrary path or command
working directory.

The server Git protocol adapter exposes stable, project-scoped operations for
listing and removing worktrees plus host-gated open-terminal, switch-project,
presentation-rename, reveal, and copy actions. Requests carry only canonical
repository/worktree IDs; host callbacks receive those opaque IDs and fail
closed when a capability is unavailable. Quick Push proposals resolve an
omitted target branch from the server's canonical default-branch listing, and
the adapter binds the resulting proposal to the authorized project before
approval.

Authorized clients also receive bounded, ordered Git progress and status-change
metadata. `git.progress` indicates the start/completion/failure of a read-only
operation without command output, while `git.status.changed` carries only the
canonical project/repository/worktree IDs, branch/head, state, changed-file
count, and bounded flag. Clients advance the shared revision for events from
other projects without retaining their status; a revision gap requires a fresh
status query rather than a locally invented transition.

Worktree removal is also server-owned and identity-bound. The client submits
only the project, repository, and opaque worktree IDs (optionally the full
HEAD it reviewed); the server obtains the canonical path from a fresh bounded
worktree listing, rechecks status immediately before invoking Git, and then
verifies that the exact identity disappeared. If the registered worktree path
has already disappeared and Git marks the entry prunable, removal cleans up
that stale registration without trying to run status inside the missing path.
Main, bare, and locked worktrees are rejected, and a changed reviewed HEAD is
reported as stale rather than being removed. The removal confirmation explicitly
warns that the worktree folder, including uncommitted, untracked, and unmerged
changes, will be permanently deleted. Once the user confirms, the server uses
Git's forced worktree removal so those visible changes do not block the action.

The production shared Git route consumes `TerminayGitClient` for its current
server-owned project. It renders bounded worktree state and exposes Pull,
explicitly confirmed removal, and a two-step Quick Push proposal/approval
review. Native terminal opening is rendered only when the host advertises that
capability. This is an integration body during migration; changed-file detail,
remaining worktree actions, and canonical Workspace sidebar placement still
remain explicit parity work.

## Acceptance outcomes

- The current project shows the correct repository/worktree state without
  confusing it with another project or window.
- Worktree clean/changed presentation reflects effective changes against the
  default branch, including squash-merged and unmerged committed work.
- Switching the project root immediately refreshes the Git sidebar for the new
  root, even when an earlier Git status request is still pending.
- Selecting a changed file in another listed worktree switches to that worktree
  and opens the file only after the project root change is authoritative.
- Double-clicking a Git tree folder opens one Folder panel without leaving the
  folder in an unintended disclosure state, and Git file/folder context menus
  offer the same applicable filesystem actions as Explorer entries.
- Worktree lifecycle actions preserve the main worktree and present Git errors
  accurately.
- Confirming worktree deletion removes dirty and unmerged worktrees, including
  their uncommitted and untracked files.
- Deleting a prunable worktree whose folder is already absent removes its stale
  Git registration and does not report a worktree-list or status error.
- Quick Push produces a reviewable plan before commits, pushes, or PR creation,
  and is unavailable until a provider is deliberately configured.
