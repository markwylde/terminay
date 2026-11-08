## MODIFIED Requirements

### Requirement: Gitea pull request and checks mapping

`terminay-gitea` SHALL first match a worktree's local branch name to an matching
pull request in the selected repository. Only when there is no matching pull request
for that name SHALL it try the configured upstream branch. Within each branch,
an open pull request SHALL win over the most recently updated merged pull
request. Pull requests from a different head repository SHALL NOT match.
Missing head-repository metadata SHALL remain acceptable. Branch selection SHALL
precede publication validation; invalid publication fields SHALL suppress the PR
without selecting another branch. A head ref or head label equal to the candidate branch SHALL match, including
merged PRs whose deleted head branch is reported as `refs/pull/<number>/head`.
Detached worktrees SHALL have no matching pull request. The extension SHALL
publish the selected pull request with `merged` for a merged pull request and
`draft` for work-in-progress pull requests. A pull request closed
without being merged SHALL NOT be matched. It
SHALL map the commit statuses for the pull request head, or for the tracked
branch when there is no pull request, to checks: `success` to passed, `failure`
and `error` to failed, `pending` to pending, and `skipped` or `warning` to
skipped, each with the status's target URL.

#### Scenario: Worktree with an open pull request

- **WHEN** there is no matching local pull request and a worktree's upstream branch is the head of open pull request #287
- **THEN** the worktree's properties include pull request #287 with its URL and
  the checks for its head commit

#### Scenario: Worktree without a pull request

- **WHEN** neither local nor upstream branch matches an open or merged pull request and the upstream has commit statuses
- **THEN** the worktree's properties include checks and no pull request

#### Scenario: Branch without a configured upstream

- **WHEN** the default branch `main` has no configured upstream and the remote's
  `main` has commit statuses
- **THEN** the worktree's properties include the checks for the remote's `main`

#### Scenario: Worktree whose pull request was merged

- **WHEN** there is no matching local pull request and a worktree's upstream branch is the head of merged pull request #22
  and of no open pull request
- **THEN** the worktree's properties include pull request #22 with state
  `merged`

#### Scenario: Open pull request after a merged one

- **WHEN** there is no matching local pull request and a worktree's upstream branch is the head of merged pull request #22
  and open pull request #30
- **THEN** the worktree's properties include pull request #30 with state `open`

#### Scenario: Feature branch tracks the base branch

- **WHEN** local branch `feature` tracks `origin/main` and `feature` has open pull request #523
- **THEN** the worktree publishes #523 and the checks for its head commit

#### Scenario: Both names have pull requests

- **WHEN** local branch `feature` and its different upstream each have an matching pull request
- **THEN** the local branch's pull request wins regardless of listing order

#### Scenario: Differently named upstream fallback

- **WHEN** local branch `local` has no matching pull request and tracks `origin/feature` with open pull request #287
- **THEN** the worktree publishes #287 and its head commit checks

#### Scenario: Local merged pull request precedes upstream open pull request

- **WHEN** the local branch has a merged pull request and only its different upstream has an open pull request
- **THEN** the local branch's merged pull request wins

#### Scenario: Fork does not mask upstream fallback

- **WHEN** a local branch name matches only a pull request from a different head repository and its upstream has an matching pull request in the selected repository
- **THEN** the upstream pull request is selected

#### Scenario: Deleted local branch matches by label

- **WHEN** a merged local PR has head ref `refs/pull/22/head` and a head label equal to the local branch name, while its different upstream has an open PR
- **THEN** the local merged PR is selected

#### Scenario: Missing head repository metadata

- **WHEN** a PR's head branch matches the local branch and head repository metadata is absent
- **THEN** the PR is selected before any upstream match

#### Scenario: Invalid local publication fields

- **WHEN** a local branch match has an invalid publication URL and the upstream has a valid PR
- **THEN** the worktree publishes no PR instead of selecting the upstream PR

#### Scenario: Merged pull request whose branch was deleted

- **WHEN** merged pull request #311 reports head ref `refs/pull/311/head` and
  head label `fix/mention-menu-arrow-keys`, and a worktree tracks
  `fix/mention-menu-arrow-keys`
- **THEN** the worktree's properties include pull request #311 with state
  `merged`

