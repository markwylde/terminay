## MODIFIED Requirements

### Requirement: Git status follows observed changes

The server SHALL learn about Git state changes by watching, not by running Git
on a timer. For every bound project it SHALL watch the repository's Git
directory (`HEAD`, `index`, `refs`, `packed-refs`, and the worktree registry),
the gitdir of every linked worktree, and the working tree of every registered
worktree. Writes that cannot change status on their own (object storage,
reflogs, hooks, and lock files) SHALL NOT schedule a refresh. On a host whose
filesystem watch is not recursive in the kernel (Linux), directories that Git
ignores in a working tree, and every `.git` directory inside one, SHALL NOT be
watched as part of that working tree, so changes inside them SHALL NOT schedule
a refresh.

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

#### Scenario: A file is created in a new directory

- **WHEN** a new directory that Git does not ignore is created in a working
  tree, and a file is then saved inside it
- **THEN** a refresh scoped to that worktree runs
- **AND** later saves inside that directory are observed as well

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

#### Scenario: Build output in an ignored directory

- **WHEN** a build on a Linux server deletes and recreates a directory that Git
  ignores, such as `dist/` or `node_modules/`
- **THEN** no refresh is scheduled for that churn

#### Scenario: A worktree is added

- **WHEN** a new worktree is registered for a watched repository
- **THEN** its gitdir and working tree are watched from then on


## ADDED Requirements

### Requirement: Git observation never blocks the server

Watching a repository SHALL NOT occupy the server's event loop for long enough
to delay its other work. Establishing a watch, extending it to newly created
directories, and handling its events SHALL proceed in steps whose synchronous
work has a fixed bound and that yield between them. No step SHALL walk a
directory tree or read a whole directory synchronously, on any platform. When
many directories are created in a short time, the server SHALL take them up
together rather than once per event.

#### Scenario: Server stays responsive during a build

- **WHEN** a build or dependency install creates and deletes thousands of
  directories in an observed working tree on a Linux server
- **THEN** a timer due on the server's event loop during that churn fires within
  a quarter of a second of its due time
- **AND** connected clients keep receiving terminal output throughout

#### Scenario: Many directories appear at once

- **WHEN** a tree of thousands of directories that Git does not ignore appears
  in an observed working tree in one operation
- **THEN** the server takes those directories into the watch in bounded steps
- **AND** a timer due during that work fires within a quarter of a second of its
  due time

#### Scenario: One very wide directory

- **WHEN** an observed directory holds tens of thousands of entries
- **THEN** the server reads it across several bounded steps
- **AND** a timer due during that work fires within a quarter of a second of its
  due time

### Requirement: Closing a Git watch stops its work

Closing or failing a watch SHALL stop all of its pending work. After it closes,
the watch SHALL open no further watches, deliver no further changes, and start
no Git command.

#### Scenario: Project closed while a watch is still being established

- **WHEN** the only project bound to a repository is closed while its
  working-tree watch is still discovering directories
- **THEN** no further watch is opened for that repository
- **AND** no Git command runs for it afterwards

### Requirement: Built-up Git watches follow the tree they observe

Where the server builds a recursive watch from per-directory watches (Linux),
it SHALL keep that watch matched to the working tree. A directory that is
created, renamed into place, or replaced at the same path SHALL be watched once
it is there. A directory that is removed or renamed away SHALL stop being
watched. A directory holding its own `.git` entry (a submodule or another
nested repository) SHALL NOT be watched as part of the outer working tree.

#### Scenario: A populated directory is renamed

- **WHEN** a directory holding files is renamed within an observed working tree,
  and a file inside it is then saved
- **THEN** that save schedules a refresh scoped to its worktree

#### Scenario: A directory is deleted and recreated at once

- **WHEN** a non-ignored directory is deleted and a new directory is created at
  the same path, and a file inside the new directory is then saved
- **THEN** that save schedules a refresh scoped to its worktree

#### Scenario: Repository with a submodule

- **WHEN** an observed working tree contains a submodule
- **THEN** the working-tree watch stays live
- **AND** files inside the submodule are not watched as part of the outer
  working tree

#### Scenario: Linked worktree inside an ignored directory

- **WHEN** a linked worktree lives inside a directory the main worktree ignores,
  and a file in the linked worktree is saved
- **THEN** a refresh scoped to the linked worktree runs

### Requirement: Built-up Git watches follow ignore rules as they change

Where the server builds a recursive watch from per-directory watches (Linux), it
SHALL re-evaluate which directories it excludes when `.gitignore`,
`.git/info/exclude`, the repository `config`, or the index changes. A directory
that becomes un-ignored or tracked SHALL then be watched, and one that becomes
ignored SHALL stop being watched. Edits to the contents of an external
`core.excludesFile` are not observed.

#### Scenario: A directory is un-ignored

- **WHEN** a rule that ignored a directory is removed from `.gitignore`, and a
  file inside that directory is then saved
- **THEN** that save schedules a refresh scoped to its worktree

#### Scenario: A directory becomes ignored

- **WHEN** a rule ignoring an existing directory is added to `.gitignore`, and
  that directory is then churned
- **THEN** the churn schedules no refresh

### Requirement: Built-up Git watches fail rather than degrade

A built-up recursive watch SHALL observe at most a fixed number of directories.
It SHALL fail when it would exceed that ceiling or when the host refuses a watch
for lack of capacity. It SHALL also fail when any part of it stops observing for
a reason other than its directory being removed, or when Git cannot say which
directories are ignored. The project's Git observation then becomes unavailable
as specified for unavailable Git watches. A built-up watch SHALL NOT continue
with partial coverage.

#### Scenario: Working tree larger than the watch ceiling

- **WHEN** an observed working tree holds more non-ignored directories than the
  watch ceiling
- **THEN** that working-tree watch fails with an error naming the ceiling
- **AND** the project's listing is measured whenever a client asks for it

#### Scenario: Host inotify watch limit reached

- **WHEN** the host refuses a per-directory watch because its watch limit
  (`ENOSPC`) or descriptor limit (`EMFILE`) is reached
- **THEN** that watch fails with that error's code
- **AND** one status-change event is published and the listing is measured
  whenever a client asks for it

#### Scenario: A subdirectory watch stops unexpectedly

- **WHEN** the watch on a subdirectory that still exists reports an error
- **THEN** the whole working-tree watch fails
- **AND** listings are no longer answered from the cached measurement

#### Scenario: Git cannot report ignored directories

- **WHEN** the ignore check fails or its output is truncated
- **THEN** the working-tree watch fails rather than watching or skipping
  directories by guesswork
