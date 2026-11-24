## ADDED Requirements

### Requirement: Status-change events follow every listed value

The server SHALL publish `git.status.changed` for a worktree whenever a
measurement finds that any value in the worktree's listing summary differs from
the summary it last published for that worktree. The comparison SHALL leave out
only values that change on every measurement without a change in the
repository. The event keeps its metadata-only shape, and clients learn the
changed values by listing again.

#### Scenario: Push of a clean branch with no upstream

- **WHEN** a linked worktree has no uncommitted changes, its branch has no
  upstream, and the branch is pushed to a new remote branch from a terminal
- **THEN** the server publishes a status change for that worktree without any
  client asking
- **AND** the next ordinary (not fresh) listing shows no unpushed commits and no
  unpushed line delta for it

#### Scenario: Push of a branch with uncommitted changes

- **WHEN** a linked worktree with uncommitted tracked changes pushes its branch,
  which has no upstream, to a new remote branch
- **THEN** the server publishes a status change for that worktree
- **AND** the next ordinary listing shows no unpushed commits, and an unpushed
  line delta equal to the uncommitted changes alone

#### Scenario: Default branch moves after a pull

- **WHEN** the default branch advances because of a pull or fetch, and a linked
  worktree's ahead count or line delta against it changes as a result
- **THEN** the server publishes a status change for that worktree
- **AND** the next ordinary listing shows the new ahead count and line delta

#### Scenario: Unchanged re-measure

- **WHEN** a worktree is re-measured, its listing summary equals the one last
  published for it, and its branch status equals the one last published for it
- **THEN** no status change is published for it

### Requirement: Listings are cached only under ready watches

A Git watch SHALL count as ready once it observes its whole intended scope; a
watch built from per-directory watches is ready when every directory its filter
keeps is armed. The server SHALL cache a measured listing only when every watch
of the repository was ready before the measurement claimed its changes and is
still ready and live when it ends. A listing raised while any watch is still
becoming ready SHALL wait until each is ready or has failed before measuring.

#### Scenario: Two listings right after binding

- **WHEN** a project is bound and two ordinary listings follow, with no change
  to the repository in between
- **THEN** the repository's worktrees are measured once
- **AND** the second listing is answered from the cached measurement

#### Scenario: A file changes while a watch is still becoming ready

- **WHEN** a file changes in a working-tree directory that its built-up watch
  has not armed yet, while a listing is waiting for the watches to be ready
- **THEN** that listing is measured after the watches are ready and includes the
  change

#### Scenario: A watch fails after it became ready

- **WHEN** a ready working-tree watch later fails because the host watch limit
  is reached
- **THEN** the cached listing is dropped and the next listing is measured

## MODIFIED Requirements

### Requirement: Explicit refresh and root change are measured

A worktree listing requested because the user explicitly refreshed the Explorer or because the project root changed SHALL be measured against Git for every worktree and SHALL NOT be answered from the cached listing, whatever the watches report. When that measurement differs from the cached listing the watches reported as current, the Git service SHALL report a cache mismatch naming each differing worktree's diagnostic id and which measured values differed, and SHALL serve the measurement. A project root changes only when a folder workspace that already loaded one root is given a different non-empty root. Listings raised by mounting a folder workspace, by status-change events, by event-stream resynchronisation, and by directory changes SHALL be answered from the cached listing while the watches report no change.

#### Scenario: Refresh after an unobserved change

- **WHEN** the default branch moved without the watches invalidating a sibling worktree, and the user refreshes the Explorer
- **THEN** every worktree is measured and the sibling's row shows its current delta
- **AND** a cache mismatch is reported for that worktree

#### Scenario: Refresh when nothing changed

- **WHEN** the user refreshes the Explorer and the measurement equals the cached listing
- **THEN** the listing is served and no cache mismatch is reported

#### Scenario: Event-driven listing

- **WHEN** a status-change event raises a listing and the watches report no change since the last measurement
- **THEN** the listing is answered from the cached listing without running Git

#### Scenario: A folder workspace mounts

- **WHEN** a renderer connects, or a folder workspace mounts or remounts (for example after a sidebar resize), and the repository's watches report no change
- **THEN** its listing is answered from the cached listing without running Git

#### Scenario: A new project becomes ready

- **WHEN** a mounted folder workspace's project finishes being created and loads its root for the first time
- **THEN** its listing is answered as a mount, from the cache when the watches report no change

#### Scenario: The project root changes

- **WHEN** a mounted folder workspace that loaded one root is given a different non-empty root, whether directly or after its root was empty for a while
- **THEN** its listing is measured for every worktree

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
to the Git directory that affects every worktree (for example `packed-refs`,
a remote-tracking ref, or the worktree registry) SHALL schedule an unscoped
refresh.

While a project's watches are live and no event has arrived since the last
measurement, the server SHALL answer a worktree listing from that measurement
without running Git.

Projects that share a repository SHALL share its watches, and the watch set
SHALL follow the worktree registry as worktrees are added and removed. When a
watched working tree's root directory goes away, or is gone by the time its
watch is armed, the server SHALL close that working tree's watch only, SHALL
schedule an unscoped refresh, and SHALL keep every other watch of the
repository live. A working tree whose root goes away is a removal, not a watch
failure. A registered worktree with no working tree has no working-tree watch.
Each measurement re-derives the watch set, so the first measurement after such
a root reappears watches it again.

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

#### Scenario: A worktree is removed with Git

- **WHEN** `git worktree remove` deletes a linked worktree from a terminal
- **THEN** the server publishes a status change without any client asking
- **AND** the next ordinary listing no longer includes that worktree
- **AND** the repository's remaining watches stay live, so a later edit in
  another worktree is still observed

#### Scenario: A worktree folder is deleted and then pruned

- **WHEN** a linked worktree's folder is deleted with `rm -rf`, and later
  `git worktree prune` runs
- **THEN** after the deletion the next ordinary listing shows the worktree as
  prunable
- **AND** after the prune the server publishes a status change and the next
  ordinary listing no longer includes it

#### Scenario: A worktree root is gone before its watch is armed

- **WHEN** a linked worktree's folder is deleted after the listing that named
  it but before its working-tree watch is armed
- **THEN** only that working tree goes unwatched and an unscoped refresh is
  scheduled
- **AND** the repository's observation stays available

#### Scenario: A deleted worktree folder is restored

- **WHEN** a deleted linked worktree's folder is restored without changing the
  worktree registry, and the user then refreshes the Explorer
- **THEN** the worktree is listed with its working tree again
- **AND** a later edit in it publishes a status change without any client asking

### Requirement: Unavailable Git watches do not fall back to polling

When a watch cannot be established or stops working, for example because the
filesystem does not support it or the host's watch limit is reached, the server
SHALL mark that project's Git observation as unavailable and SHALL measure on
demand each time a client asks. It SHALL NOT schedule any timer-driven Git
refresh in its place. Losing a watch SHALL publish one unattributed
status-change event so that clients re-query once.

A client's listing request against an unavailable observation SHALL also start
one attempt to re-establish the repository's watches, unless an attempt is
already under way. Nothing else SHALL start an attempt. An attempt succeeds only
when every watch is ready. The observation is then live again: later changes
are observed and later listings are answered from the cache. When it fails, the
observation stays unavailable and the failure is reported like any other watch
failure, but without publishing another status-change event.

#### Scenario: Watch limit reached

- **WHEN** a working-tree watch fails because the host watch limit is reached
- **THEN** the project's listing is measured whenever a client asks for it
- **AND** no Git command runs for that project between client requests

#### Scenario: Watch capacity comes back

- **WHEN** a repository's observation is unavailable because the host watch
  limit was reached, capacity is freed, and a client then lists its worktrees
- **THEN** the repository's watches are re-established
- **AND** a later edit in a working tree publishes a status change without any
  client asking

#### Scenario: A worktree changed while unwatched is re-measured on re-arm

- **WHEN** a linked worktree changes while its repository's observation is
  unavailable, and capacity then comes back and a client lists only another
  worktree of that repository
- **THEN** the next listing of the repository shows the linked worktree's
  change

#### Scenario: Re-arming fails again

- **WHEN** a client lists the worktrees of an unavailable repository and the
  watches still cannot be established
- **THEN** the listing is measured and served
- **AND** no Git command runs for that project until the next client request
