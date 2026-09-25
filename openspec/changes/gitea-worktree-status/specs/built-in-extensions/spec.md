## ADDED Requirements

### Requirement: Gitea extension detects Gitea repositories

`terminay-gitea` SHALL contribute a worktree insight source. For each repository
context it SHALL derive an HTTPS origin from the `origin` remote, whether that
remote uses HTTPS, `ssh://`, or scp-style syntax, discarding any user and SSH
port. It SHALL treat the repository as Gitea only when an unauthenticated
request to `<origin>/api/v1/version` returns a version, and SHALL publish nothing
and request nothing for any other repository.

#### Scenario: SSH remote on a Gitea host

- **WHEN** a project's `origin` is `ssh://git@git.example.net:4222/owner/repo.git`
  and `https://git.example.net/api/v1/version` returns a version
- **THEN** the repository is treated as the Gitea repository `owner/repo` on
  `https://git.example.net`

#### Scenario: Non-Gitea remote

- **WHEN** the version probe fails or returns no version
- **THEN** the extension publishes no properties and requests no sign-in for that
  repository

### Requirement: Gitea credentials come from tea or sign-in

For a Gitea origin, `terminay-gitea` SHALL use, in order, a token from a `tea`
login whose URL matches the origin, read from the `tea` configuration file and
held only in memory, then a token stored for the origin through sign-in. It
SHALL NOT run the `tea` executable. With neither, it SHALL request sign-in for
the origin with a token-page link to `<origin>/user/settings/applications`. When
the origin rejects a token with 401, the extension SHALL stop using it and, for a
stored token, report it rejected.

#### Scenario: tea login present

- **WHEN** the `tea` configuration has a login for the origin
- **THEN** the extension uses that token without requesting sign-in and without
  running `tea`

#### Scenario: No credential

- **WHEN** neither a `tea` login nor a stored token exists for the origin
- **THEN** the extension requests sign-in for the origin

#### Scenario: Token revoked

- **WHEN** the origin answers 401 to the stored token
- **THEN** the extension reports the credential rejected and requests sign-in
  again

### Requirement: Gitea status refresh is bounded

`terminay-gitea` SHALL use HTTPS requests to the Gitea API and SHALL NOT spawn
processes. Per repository context and refresh it SHALL list the repository's
open pull requests once and fetch one combined commit status per worktree on a
branch. A worktree's tracked branch is its configured upstream branch, or, when
none is configured, the remote branch of the same name. It SHALL refresh when a context is issued, when its
content changes, and when its project becomes active; otherwise it SHALL refresh
at most once every 10 seconds for an active project and once every 45 seconds
for any other. It SHALL schedule nothing for cancelled contexts, and SHALL widen
the interval after consecutive request failures.

#### Scenario: Several worktrees in one repository

- **WHEN** a repository context has five worktrees on branches and one detached
  worktree
- **THEN** one refresh makes one pull-request listing request and five commit
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
branch equals the worktree's tracked branch, and SHALL publish it as the
worktree's pull request, with `draft` for work-in-progress pull requests. It
SHALL map the commit statuses for the pull request head, or for the tracked
branch when there is no pull request, to checks: `success` to passed, `failure`
and `error` to failed, `pending` to pending, and `skipped` or `warning` to
skipped, each with the status's target URL.

#### Scenario: Worktree with an open pull request

- **WHEN** a worktree's upstream branch is the head of open pull request #287
- **THEN** the worktree's properties include pull request #287 with its URL and
  the checks for its head commit

#### Scenario: Worktree without a pull request

- **WHEN** a worktree's upstream branch has commit statuses and no open pull
  request
- **THEN** the worktree's properties include checks and no pull request

#### Scenario: Branch without a configured upstream

- **WHEN** the default branch `main` has no configured upstream and the remote's
  `main` has commit statuses
- **THEN** the worktree's properties include the checks for the remote's `main`
