## ADDED Requirements

### Requirement: GitHub extension detects GitHub repositories

`terminay-github` SHALL contribute a worktree insight source. For each
repository context it SHALL derive an HTTPS origin from the `origin` remote, or
the first remote when there is no `origin`, whether that remote uses HTTPS,
`ssh://`, or scp-style syntax, discarding any user and SSH port. It SHALL treat
`https://github.com` as GitHub without a probe, with its API at
`https://api.github.com`. For any other origin it SHALL treat the repository as
GitHub Enterprise Server only when an unauthenticated request to
`<origin>/api/v3/meta` answers with an `x-github-enterprise-version` header or
a JSON object with an `installed_version`, whatever its status, with its API
under `<origin>/api`. It SHALL publish nothing and request nothing for
any other repository.

#### Scenario: github.com over SSH

- **WHEN** a project's `origin` is `git@github.com:owner/repo.git`
- **THEN** the repository is treated as the GitHub repository `owner/repo` on
  `https://github.com` and no detection request is made

#### Scenario: GitHub Enterprise Server

- **WHEN** a project's `origin` is `https://ghe.example.com/owner/repo.git` and
  `https://ghe.example.com/api/v3/meta` returns an `installed_version`
- **THEN** the repository is treated as the GitHub repository `owner/repo` on
  `https://ghe.example.com`

#### Scenario: Private-mode GitHub Enterprise Server

- **WHEN** `<origin>/api/v3/meta` answers 401 with an
  `x-github-enterprise-version` header
- **THEN** the repository is treated as GitHub and the extension looks for a
  credential

#### Scenario: Non-GitHub remote

- **WHEN** the origin is not `github.com` and the meta probe fails, or answers
  with neither the header nor an `installed_version`
- **THEN** the extension publishes no properties and requests no sign-in for
  that repository

### Requirement: GitHub credentials come from the environment, gh, or sign-in

For a GitHub origin, `terminay-github` SHALL use, in order: a token from the
server's environment (`GH_TOKEN`, then `GITHUB_TOKEN` for `github.com`;
`GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN` for any other host); an
`oauth_token` for the host in the `gh` CLI's `hosts.yml`, read from
`$GH_CONFIG_DIR`, else `$XDG_CONFIG_HOME/gh`, else the platform default
(`%AppData%\GitHub CLI` on Windows and `~/.config/gh` elsewhere), and held only
in memory; a token from `gh auth token --hostname <host>`; and then a token
stored for the origin through sign-in. It SHALL run `gh` only when `hosts.yml`
lists the host without an `oauth_token`. It SHALL run it at most once per host
until that token is rejected or `hosts.yml` changes, without a shell and with a
timeout, and SHALL NOT run it from a refresh. With no credential it SHALL request
sign-in with the provider name `GitHub` and a token-page link: on `github.com`
the page for creating a fine-grained personal access token, and on any other
host `<origin>/settings/tokens`. When the API answers 401 to a token, the
extension SHALL stop using it and, for a stored token, report it rejected.

#### Scenario: gh login with the token in hosts.yml

- **WHEN** `hosts.yml` has an `oauth_token` for the host
- **THEN** the extension uses that token without requesting sign-in and without
  running `gh`

#### Scenario: gh login with the token in the keychain

- **WHEN** `hosts.yml` lists the host without an `oauth_token`
- **THEN** the extension runs `gh auth token --hostname <host>` once, uses the
  token it prints, and runs it again only after that token is rejected or
  `hosts.yml` changes

#### Scenario: No gh login

- **WHEN** no environment token is set and `hosts.yml` is missing or does not
  list the host
- **THEN** the extension does not run `gh` and falls back to a stored token, or
  requests sign-in

#### Scenario: Token revoked

- **WHEN** the API answers 401 to the stored token
- **THEN** the extension reports the credential rejected and requests sign-in
  again

### Requirement: GitHub status refresh is bounded

`terminay-github` SHALL use HTTPS requests to the GitHub GraphQL API. Per
repository context and refresh it SHALL make one GraphQL request for every 50
distinct tracked branches, which returns those branches' open pull requests and
check rollups together, and SHALL pass branch names as query variables. A
worktree's tracked branch is its configured upstream branch, or, when none is
configured, the remote branch of the same name. It SHALL refresh when a context
is issued, when its content changes, and when its project becomes active;
otherwise it SHALL refresh at most once every 10 seconds for an active project
and once every 45 seconds for any other. It SHALL schedule nothing for cancelled
contexts, and SHALL widen the interval after consecutive request failures. When
GitHub reports its rate limit exhausted, it SHALL make no request to that origin
before the reset time GitHub reports.

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
repository itself, and SHALL publish it as the worktree's pull request: `draft`
when GitHub reports it as a draft, otherwise `open`, with `mergeable` true for
`MERGEABLE`, false for `CONFLICTING`, and absent otherwise. It SHALL map the
check rollup of the pull request's head commit, or of the tracked branch's head
commit when there is no pull request, to checks. Check runs map as follows: not
completed to pending; `SUCCESS` to passed; `FAILURE`, `TIMED_OUT`, `CANCELLED`,
`STARTUP_FAILURE`, and `ACTION_REQUIRED` to failed; `NEUTRAL`, `SKIPPED`, and
`STALE` to skipped. Commit statuses map as follows: `SUCCESS` to passed;
`FAILURE` and `ERROR` to failed; `PENDING` and `EXPECTED` to pending. Each item
SHALL carry the check's details or target URL. Counts SHALL cover every check in
the rollup even when fewer items are listed.

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
