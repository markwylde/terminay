## MODIFIED Requirements

### Requirement: Gitea status refresh is bounded

`terminay-gitea` SHALL use HTTPS requests to the Gitea API and SHALL NOT spawn
processes. Per repository context and refresh it SHALL list the repository's
open pull requests once and its most recently updated closed pull requests once,
and fetch one combined commit status per worktree on a
branch. A worktree's tracked branch is its configured upstream branch, or, when
none is configured, the remote branch of the same name. It SHALL refresh when a context is issued, when its
content changes, and when its project becomes active; otherwise it SHALL refresh
at most once every 10 seconds for an active project and once every 45 seconds
for any other. It SHALL schedule nothing for cancelled contexts, and SHALL widen
the interval after consecutive request failures.

#### Scenario: Several worktrees in one repository

- **WHEN** a repository context has five worktrees on branches and one detached
  worktree
- **THEN** one refresh makes two pull-request listing requests and five commit
  status requests

#### Scenario: Idle inactive project

- **WHEN** a project stays open, is not active, and nothing changes locally
- **THEN** the extension refreshes at most once every 45 seconds

#### Scenario: Active project

- **WHEN** a project is active in a client
- **THEN** the extension refreshes it at most once every 10 seconds

#### Scenario: Project gains focus

- **WHEN** a project becomes active
- **THEN** the extension refreshes it at once

#### Scenario: Project closed

- **WHEN** a repository context is cancelled
- **THEN** no further requests are made for it

### Requirement: Gitea pull request and checks mapping

`terminay-gitea` SHALL match a worktree to an open pull request whose head
branch equals the worktree's tracked branch, or, when there is none, to the most
recently updated merged pull request whose head branch equals it, and SHALL
publish it as the worktree's pull request, with `merged` for a merged pull
request and `draft` for work-in-progress pull requests. A pull request closed
without being merged SHALL NOT be matched. It
SHALL map the commit statuses for the pull request head, or for the tracked
branch when there is no pull request, to checks: `success` to passed, `failure`
and `error` to failed, `pending` to pending, and `skipped` or `warning` to
skipped, each with the status's target URL.

#### Scenario: Worktree with an open pull request

- **WHEN** a worktree's upstream branch is the head of open pull request #287
- **THEN** the worktree's properties include pull request #287 with its URL and
  the checks for its head commit

#### Scenario: Worktree without a pull request

- **WHEN** a worktree's upstream branch has commit statuses and no open or
  merged pull request
- **THEN** the worktree's properties include checks and no pull request

#### Scenario: Branch without a configured upstream

- **WHEN** the default branch `main` has no configured upstream and the remote's
  `main` has commit statuses
- **THEN** the worktree's properties include the checks for the remote's `main`

#### Scenario: Worktree whose pull request was merged

- **WHEN** a worktree's upstream branch is the head of merged pull request #22
  and of no open pull request
- **THEN** the worktree's properties include pull request #22 with state
  `merged`

#### Scenario: Open pull request after a merged one

- **WHEN** a worktree's upstream branch is the head of merged pull request #22
  and open pull request #30
- **THEN** the worktree's properties include pull request #30 with state `open`
