## MODIFIED Requirements

### Requirement: Gitea pull request and checks mapping

`terminay-gitea` SHALL match a worktree to an open pull request whose head
branch equals the worktree's tracked branch, or, when there is none, to the most
recently updated merged pull request whose head branch equals it, and SHALL
publish it as the worktree's pull request, with `merged` for a merged pull
request and `draft` for work-in-progress pull requests. A pull request's head
branch equals the tracked branch when either its head ref or its head label
equals the branch name, so a merged pull request whose branch was deleted, which
Gitea reports with head ref `refs/pull/<number>/head`, still matches. A pull
request closed without being merged SHALL NOT be matched. It SHALL map the
commit statuses for the pull request head, or for the tracked branch when there
is no pull request, to checks: `success` to passed, `failure` and `error` to
failed, `pending` to pending, and `skipped` or `warning` to skipped, each with
the status's target URL.

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

#### Scenario: Merged pull request whose branch was deleted

- **WHEN** merged pull request #311 reports head ref `refs/pull/311/head` and
  head label `fix/mention-menu-arrow-keys`, and a worktree tracks
  `fix/mention-menu-arrow-keys`
- **THEN** the worktree's properties include pull request #311 with state
  `merged`

#### Scenario: Open pull request after a merged one

- **WHEN** a worktree's upstream branch is the head of merged pull request #22
  and open pull request #30
- **THEN** the worktree's properties include pull request #30 with state `open`

### Requirement: GitHub status refresh is bounded

`terminay-github` SHALL use HTTPS requests to the GitHub GraphQL API. Per
repository context and refresh it SHALL make one GraphQL request for every 50
distinct tracked branches, which returns those branches' open pull requests and
check rollups together with the repository's 50 most recently updated merged
pull requests, and SHALL pass branch names as query variables. A worktree's
tracked branch is its configured upstream branch, or, when none is configured,
the remote branch of the same name. It SHALL refresh when a context is issued,
when its content changes, and when its project becomes active; otherwise it
SHALL refresh at most once every 10 seconds for an active project and once every
45 seconds for any other. It SHALL schedule nothing for cancelled contexts, and
SHALL widen the interval after consecutive request failures. When GitHub reports
its rate limit exhausted, it SHALL make no request to that origin before the
reset time GitHub reports.

#### Scenario: Several worktrees in one repository

- **WHEN** a repository context has five worktrees on branches and one detached
  worktree
- **THEN** one refresh makes exactly one GraphQL request

#### Scenario: Idle inactive project

- **WHEN** a project stays open, is not active, and nothing changes locally
- **THEN** the extension refreshes at most once every 45 seconds

#### Scenario: Active project

- **WHEN** a project is active in a client
- **THEN** the extension refreshes it at most once every 10 seconds

#### Scenario: Project gains focus

- **WHEN** a project becomes active
- **THEN** the extension refreshes it at once

#### Scenario: Rate limit exhausted

- **WHEN** GitHub answers with `x-ratelimit-remaining: 0` and a reset time
- **THEN** the extension makes no request to that origin until the reset time

#### Scenario: Project closed

- **WHEN** a repository context is cancelled
- **THEN** no further requests are made for it

### Requirement: GitHub pull request and checks mapping

`terminay-github` SHALL match a worktree to an open pull request whose head
branch equals the worktree's tracked branch and whose head repository is the
repository itself, or, when there is none, to the most recently updated merged
pull request with that head branch and head repository, and SHALL publish it as
the worktree's pull request: `merged` for a merged pull request, `draft` when
GitHub reports it as a draft, otherwise `open`, with `mergeable` true for
`MERGEABLE`, false for `CONFLICTING`, and absent otherwise. A merged pull
request SHALL be matched whether or not its head branch still exists on GitHub.
A pull request closed without being merged SHALL NOT be matched. It SHALL map
the check rollup of an open pull request's head commit, or of the tracked
branch's head commit when there is no open pull request, to checks; when the
tracked branch no longer exists on GitHub, no checks are published. Check runs
map as follows: not completed to pending; `SUCCESS` to passed; `FAILURE`,
`TIMED_OUT`, `CANCELLED`, `STARTUP_FAILURE`, and `ACTION_REQUIRED` to failed;
`NEUTRAL`, `SKIPPED`, and `STALE` to skipped. Commit statuses map as follows:
`SUCCESS` to passed; `FAILURE` and `ERROR` to failed; `PENDING` and `EXPECTED`
to pending. Each item SHALL carry the check's details or target URL. Counts
SHALL cover every check in the rollup even when fewer items are listed.

#### Scenario: Worktree with an open pull request

- **WHEN** a worktree's upstream branch is the head of open pull request #42
- **THEN** the worktree's properties include pull request #42 with its URL and
  the checks for its head commit

#### Scenario: Pull request from a fork

- **WHEN** an open pull request's head branch has the worktree's branch name
  but its head repository is a fork
- **THEN** it is not the worktree's pull request

#### Scenario: Actions and commit statuses together

- **WHEN** a commit has two GitHub Actions check runs, one succeeded and one in
  progress, and one failed commit status
- **THEN** the worktree's checks are one passed, one pending, and one failed

#### Scenario: Branch without a configured upstream

- **WHEN** the default branch `main` has no configured upstream and the remote's
  `main` has checks
- **THEN** the worktree's properties include the checks for the remote's `main`

#### Scenario: Worktree whose pull request was merged

- **WHEN** a worktree's upstream branch is the head of merged pull request #51
  and of no open pull request, and the branch still exists on GitHub
- **THEN** the worktree's properties include pull request #51 with state
  `merged` and the checks for the branch's head commit

#### Scenario: Merged pull request whose branch was deleted

- **WHEN** a worktree tracks a branch that no longer exists on GitHub and that
  was the head of merged pull request #51
- **THEN** the worktree's properties include pull request #51 with state
  `merged` and no checks

#### Scenario: Open pull request after a merged one

- **WHEN** a worktree's upstream branch is the head of merged pull request #51
  and open pull request #60
- **THEN** the worktree's properties include pull request #60 with state `open`

#### Scenario: Pull request closed without merging

- **WHEN** a worktree's upstream branch was the head only of a pull request
  closed without being merged
- **THEN** the worktree's properties include no pull request
