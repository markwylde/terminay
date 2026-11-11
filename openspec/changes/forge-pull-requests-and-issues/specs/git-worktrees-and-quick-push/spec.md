## ADDED Requirements

### Requirement: Server-owned worktree creation

The Git service SHALL offer a worktree creation operation for an open project.
It SHALL take a branch name, the forge repository it is for, and either a new
branch from the repository's default branch or a remote branch to track. It
SHALL require write scope and authority for the project. The server SHALL
choose the remote: the project's remote claimed for that repository, preferring
`origin` and then the remote of the repository's current branch's upstream
when several are claimed. The server SHALL validate the branch name with
`git check-ref-format --branch` and SHALL choose the worktree path itself: a
sibling of the repository root named `<repository directory name>-<branch with
/ replaced by ->`, with a numeric suffix when that path exists.

When the branch is already checked out in a worktree, the operation SHALL fail
with a typed reason that names that worktree's path. When the branch exists
locally and is not checked out, the operation SHALL refuse it unless the
client asked to reuse it, and then SHALL add the worktree on the existing
branch without moving it. Otherwise it SHALL fetch the base or tracked branch
from the remote and run `git worktree add` with fixed arguments and no shell,
creating the branch from the remote's default branch or tracking the remote
branch. It SHALL return the new worktree's path and branch.

Creation operations for one repository SHALL run one at a time, and each SHALL
repeat its branch and path checks when it runs. When a step fails, the server
SHALL remove a branch and a directory it created in that operation and SHALL
leave everything else as it was. Asked to plan only, it SHALL return the path
it would choose, whether the branch name is valid, and whether the branch
exists or is checked out, without fetching or creating anything. The new
worktree SHALL appear in the project's folders as any worktree created in a
terminal does.

#### Scenario: Planning a worktree

- **WHEN** a client asks to plan a worktree for branch `issue-541-home-sidebar`
- **THEN** it receives the path the server would use and nothing is created

#### Scenario: New branch for an issue

- **WHEN** a client creates a worktree for branch `issue-541-home-sidebar` from
  the default branch in a project at `/src/terminay`
- **THEN** `/src/terminay-issue-541-home-sidebar` is created on a new branch
  `issue-541-home-sidebar` from the remote default branch

#### Scenario: Tracking a pull request branch

- **WHEN** a client creates a worktree tracking remote branch `change/13-events`
- **THEN** a worktree on local branch `change/13-events` tracking the remote
  branch is created

#### Scenario: Existing local branch

- **WHEN** a client asks for branch `change/13-events`, which exists locally and
  is not checked out, without asking to reuse it
- **THEN** the operation fails saying the branch exists, and nothing is created

#### Scenario: Branch already checked out

- **WHEN** a client asks for a branch already checked out at
  `/src/terminay-change-13-events`
- **THEN** the operation fails with a reason naming that path

#### Scenario: Two requests at once

- **WHEN** two clients create a worktree for the same new branch at the same
  time
- **THEN** one succeeds and the other fails saying the branch is checked out

#### Scenario: Fetch fails

- **WHEN** the fetch from the remote fails
- **THEN** the operation fails with the reason and no branch or directory is
  left behind

#### Scenario: Invalid branch name

- **WHEN** a client asks for branch `bad..name`
- **THEN** the operation fails with a visible reason and nothing is created

#### Scenario: Read-only client

- **WHEN** a client with read scope asks to create a worktree
- **THEN** the operation is refused
