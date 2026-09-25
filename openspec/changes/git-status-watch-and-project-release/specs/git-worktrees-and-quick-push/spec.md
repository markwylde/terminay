## ADDED Requirements

### Requirement: Git status follows observed changes

The server SHALL learn about Git state changes by watching, not by running Git
on a timer. For every bound project it SHALL watch the repository's Git
directory (`HEAD`, `index`, `refs`, `packed-refs`, and the worktree registry),
the gitdir of every linked worktree, and the working tree of every registered
worktree. Writes that cannot change status on their own (object storage,
reflogs, hooks, and lock files) SHALL NOT schedule a refresh.

A watch event SHALL schedule a refresh scoped to the worktree it belongs to,
through the shared ramping schedule: the first event after a quiet period runs
promptly, and sustained change widens the interval up to its ceiling. A change
to the Git directory that affects every worktree (for example `packed-refs`
or the worktree registry) SHALL schedule an unscoped refresh.

While a project's watches are live and no event has arrived since the last
measurement, the server SHALL answer a worktree listing from that measurement
without running Git.

Projects that share a repository SHALL share its watches, and the watch set
SHALL follow the worktree registry as worktrees are added and removed.

#### Scenario: Idle repository

- **WHEN** a project is open and nothing in its repository or working trees
  changes
- **THEN** no Git command runs for that project

#### Scenario: A file is edited

- **WHEN** a file in a worktree's working tree is saved
- **THEN** a refresh scoped to that worktree runs within the ramp's first step
- **AND** the Git sidebar reflects the edit

#### Scenario: A commit or branch switch happens outside Terminay

- **WHEN** `HEAD`, `index`, or a ref changes because of a Git command run in a
  terminal or another tool
- **THEN** the affected worktree is refreshed without any client asking

#### Scenario: Listing after a status-change event

- **WHEN** a client lists worktrees after the server has measured them and no
  watch event has arrived since
- **THEN** the listing is served from that measurement without running Git

#### Scenario: Sustained churn

- **WHEN** watch events keep arriving, for example during a dependency install
- **THEN** refreshes for that project run no more often than the ramp allows
- **AND** events inside an interval collapse into one refresh at its end

#### Scenario: A worktree is added

- **WHEN** a new worktree is registered for a watched repository
- **THEN** its gitdir and working tree are watched from then on

### Requirement: Unavailable Git watches do not fall back to polling

When a watch cannot be established or stops working, for example because the
filesystem does not support it or the host's watch limit is reached, the server
SHALL mark that project's Git observation as unavailable and SHALL measure on
demand each time a client asks. It SHALL NOT schedule any timer-driven Git
refresh in its place. Losing a watch SHALL publish one unattributed
status-change event so that clients re-query once.

#### Scenario: Watch limit reached

- **WHEN** a working-tree watch fails because the host watch limit is reached
- **THEN** the project's listing is measured whenever a client asks for it
- **AND** no Git command runs for that project between client requests

### Requirement: Closed projects run no Git

Closing a project SHALL release its Git binding, cancel any pending refresh,
and close every watch no other open project still needs. After the release
completes, the server SHALL run no Git command on behalf of the closed
project, and no request SHALL implicitly re-bind it.

#### Scenario: Close a project with terminals

- **WHEN** a project with open terminals in a Git repository is closed
- **THEN** its terminals are terminated
- **AND** no Git command runs for that project afterwards

#### Scenario: Close a project without terminals

- **WHEN** a project that has no terminal sessions is closed
- **THEN** its Git binding and watches are released just the same

#### Scenario: Another project shares the repository

- **WHEN** one of two open projects rooted in the same repository is closed
- **THEN** the remaining project keeps its watches and live status
