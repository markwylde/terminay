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
  the file-viewer contract.
- The Worktrees panel shows known worktrees and their state. Users can open a
  terminal at a worktree, switch the project root, copy/reveal its path, rename
  its presentation, remove a safe worktree, or pull a worktree from origin when
  Git permits it.
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
3. The user chooses a branch target and confirms the planned actions.
4. Terminay creates the requested commits, pushes them, and can create a
   provider-aware pull request (GitHub or Gitea) when the repository supports it.

Push targets are grouped by branch intent, including safe handling for the
repository default branch. Terminay skips already-applied commits where that is
the explicitly selected default-branch workflow; it never silently rebases or
rewrites history.

## Safety and boundaries

Git commands run in Electron with the target worktree/repository path, never in
the renderer. Quick Push sends only the bounded context needed to the selected
provider, requires explicit user confirmation before mutation, and reports the
exact failed Git/remote step. Credentials continue to be handled by the user's
existing Git/SSH/CLI environment rather than copied into Terminay settings.

## Acceptance outcomes

- The current project shows the correct repository/worktree state without
  confusing it with another project or window.
- Worktree lifecycle actions preserve the main worktree and present Git errors
  accurately.
- Quick Push produces a reviewable plan before commits, pushes, or PR creation,
  and is unavailable until a provider is deliberately configured.
