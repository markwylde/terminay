## ADDED Requirements

### Requirement: Listing scoped to a departed worktree

A worktree listing MAY name the worktree whose change raised it. The server SHALL use that name only to choose which worktrees to re-measure. When the named worktree is not part of the project's repository, the listing SHALL report the repository's current worktrees rather than fail.

#### Scenario: Refresh raised by a removed worktree

- **WHEN** a worktree is removed and a listing names it
- **THEN** the listing reports the remaining worktrees
- **AND** no Git failure is reported

#### Scenario: Worktree removed outside Terminay

- **WHEN** a worktree is removed by a Git command in a terminal and a listing names it
- **THEN** the listing reports the remaining worktrees
