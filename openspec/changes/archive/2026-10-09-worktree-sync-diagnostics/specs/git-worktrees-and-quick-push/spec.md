## ADDED Requirements

### Requirement: Git observation reports its lifecycle to the server host

The Git service SHALL report its observation lifecycle to the server host that composes it: each watch opened, closed, and failed; observed changes summarised by entry class and invalidated scope; each measurement's claim, the worktrees it re-measured and carried forward, its duration and outcome; listings answered from cache; status-change events published and suppressed; and cache mismatches. A watch failure SHALL report the error that caused it. Reports SHALL identify repositories and worktrees by process-local diagnostic ids and SHALL carry no path, ref or branch name, canonical id, or Git output. The Git service SHALL NOT write a log itself; the embedded Local server's host records the reports in Desktop diagnostics, and a standalone server writes them to its service log. A report that the host fails to accept SHALL NOT alter observation, measurement, or any Git result.

#### Scenario: Watch failure is reported with its error

- **WHEN** a watch on a bound repository fails
- **THEN** the host receives a report carrying the watch kind and the error's code and message
- **AND** the repository is measured on demand as it is for any failed watch

#### Scenario: Host observer throws

- **WHEN** the host's observer throws while handling a report
- **THEN** the measurement or watch transition that raised it completes as it would have otherwise

#### Scenario: Standalone server

- **WHEN** a standalone Terminay Server observes a repository
- **THEN** its observation reports appear in that server's service log
- **AND** they are not sent to a connected Desktop

### Requirement: Explicit refresh and root change are measured

A worktree listing requested because the user explicitly refreshed the Explorer or because the project root changed SHALL be measured against Git for every worktree and SHALL NOT be answered from the cached listing, whatever the watches report. When that measurement differs from the cached listing the watches reported as current, the Git service SHALL report a cache mismatch naming each differing worktree's diagnostic id and which measured values differed, and SHALL serve the measurement. Listings raised by status-change events, event-stream resynchronisation, and directory changes continue to be answered from the cached listing while the watches report no change.

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
