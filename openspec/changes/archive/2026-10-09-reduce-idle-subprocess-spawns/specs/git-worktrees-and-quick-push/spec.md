## ADDED Requirements

### Requirement: Status refreshes are scoped to the worktree that changed

A Git status-change event names the worktree it came from, and the refresh it
schedules SHALL query only that worktree. A change in one worktree MUST NOT
re-run the per-worktree command set for every other worktree in the
repository. A refresh that cannot attribute itself to a single worktree — a
first load, a project root change, or a subscription resubscribe — MAY query
them all.

The command set for one worktree SHALL be issued once per refresh of that
worktree, not once per panel consumer.

#### Scenario: One worktree changes

- **WHEN** a status-change event arrives for one worktree of a repository that
  has several
- **THEN** only that worktree's status, ahead-count, line delta, and last-changed
  time are queried
- **AND** no Git command is issued against the other worktrees

#### Scenario: Unattributed refresh

- **WHEN** a refresh is raised by a first load, a project root change, or a
  resubscribe rather than by a specific worktree's change
- **THEN** every worktree is queried, as before

### Requirement: Bounded Git refresh cadence

Git status refreshes SHALL be bounded by a minimum interval between refreshes,
not only by a trailing debounce. A trailing debounce alone re-fires for every
event spaced wider than its delay, so a steady trickle of filesystem activity
sustains refreshes at the debounce frequency however expensive each one is.

The interval SHALL be no shorter than the time a refresh itself typically
takes, so refreshes cannot queue behind one another. Events arriving during an
interval SHALL collapse into exactly one refresh at its end, so no change is
dropped.

#### Scenario: Steady trickle of events

- **WHEN** status-change events arrive continuously, spaced wider than the
  debounce delay
- **THEN** refreshes are issued no more often than the minimum interval

#### Scenario: Events during an interval

- **WHEN** one or more events arrive while a refresh interval is still open
- **THEN** exactly one refresh runs when the interval ends
- **AND** the changes those events carried are reflected by it

#### Scenario: Single isolated event

- **WHEN** one status-change event arrives after a quiet period
- **THEN** a refresh runs without waiting for the full interval
