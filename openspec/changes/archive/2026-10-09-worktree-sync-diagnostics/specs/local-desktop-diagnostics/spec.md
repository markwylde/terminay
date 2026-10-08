## ADDED Requirements

### Requirement: Git observation lifecycle is recorded

The normal diagnostic level SHALL record the embedded Local server's Git observation lifecycle so that a Git pane showing an out-of-date worktree can be traced to the step that failed. The history SHALL distinguish: a watch opened, a watch closed, and a watch failed, each with whether it observes a Git directory or a working tree and whether it is recursive; a watch failure's reported error code and message; observed changes summarised by entry class and by the scope they invalidated; a measurement completed, failed, or abandoned, with whether it claimed every worktree or named ones, how many worktrees it re-measured and how many it carried forward, its duration, whether its result was kept as the cached listing, and how many status-change events it published and suppressed; listings answered from cache; and a cache mismatch. For each re-measured worktree a measurement record SHALL carry its ahead count and line additions and deletions against the default branch.

#### Scenario: A watch fails

- **WHEN** a Git directory or working-tree watch fails
- **THEN** a record names the repository's diagnostic id, the watch kind, and the reported error code and message
- **AND** the history shows that the repository is no longer served from cache

#### Scenario: The default branch moves

- **WHEN** the default branch of an observed repository moves
- **THEN** the history shows a change of the default-branch class invalidating every worktree
- **AND** the following measurement record shows every worktree re-measured and none carried forward

#### Scenario: A stale row is investigated

- **WHEN** the history is read after a worktree row showed an out-of-date delta
- **THEN** it distinguishes a watch that had failed, a change that was never observed, a change attributed to other worktrees only, a measurement that carried the row forward, and a listing answered from cache

#### Scenario: Cached listing disagrees with a measurement

- **WHEN** a measurement made for an explicit refresh differs from the cached listing that the watches reported as current
- **THEN** a cache-mismatch record names the diagnostic id of each worktree that differed and which of its measured values differed

### Requirement: Git observation records identify by diagnostic id and class only

Git observation records SHALL identify a repository and a worktree by opaque process-local diagnostic ids, together with whether the worktree is the main or a linked worktree and its position in the repository's worktree listing. A changed entry SHALL be recorded only as one of a fixed set of classes: head, index, default-branch ref, other branch ref, remote ref, packed refs, configuration, worktree registry, linked-worktree state, lock, inert, working tree, unnamed, and other. Records SHALL NOT carry a project id, canonical repository or worktree id, project root, repository or worktree path, changed file name, ref or branch name, commit message, command argument, or Git output. A path that appears inside a watch failure's reported error message is part of that error and is retained.

#### Scenario: Branch ref changes

- **WHEN** a branch ref changes in an observed repository
- **THEN** the record carries the class default-branch ref or other branch ref
- **AND** it carries no branch name

#### Scenario: Working-tree file changes

- **WHEN** a file changes inside an observed working tree
- **THEN** the record counts a change of the working-tree class against the owning worktree's diagnostic id
- **AND** it carries no file name or path

#### Scenario: Correlating records for one worktree

- **WHEN** watch, change, and measurement records for the same worktree are read within one launch
- **THEN** they carry the same diagnostic id
- **AND** that id is not the worktree's canonical id and grants no authority

### Requirement: Git observation records stay bounded under sustained change

Observed changes SHALL NOT produce one record per filesystem event. Changes observed between two measurements SHALL be recorded as one summary carrying a count per entry class and per invalidated scope, and changes that invalidate nothing SHALL be folded into the next summary rather than recorded on their own. Listings answered from cache SHALL be recorded as a count on the next summary or measurement record. Git observation records SHALL use the bounded lifecycle channel and SHALL be subject to the per-event and per-source burst bounds of this specification.

#### Scenario: A burst of working-tree writes

- **WHEN** a checkout rewrites many files in an observed working tree
- **THEN** one summary records the count by class and scope
- **AND** no per-file record is produced

#### Scenario: Changes that invalidate nothing

- **WHEN** only lock or inert entries change
- **THEN** no measurement is recorded
- **AND** the count appears on the next summary

### Requirement: Git pane synchronisation is recorded

The normal diagnostic level SHALL record each Git pane synchronisation outcome for a Desktop renderer: what raised it (a status-change event, an event-stream resynchronisation, a project-root change, an explicit refresh, a directory change, or a completed worktree action), whether it named one worktree, and whether its result was applied with a changed projection, applied without change, discarded because a later synchronisation superseded it, or failed. Synchronisations applied without change SHALL be recorded as a count on the next recorded outcome. These records SHALL reach the history only as bounded renderer evidence that Desktop main already observes, SHALL carry the worktree count and duration, and SHALL NOT carry a project id, path, branch name, or worktree id.

#### Scenario: A synchronisation changes the pane

- **WHEN** a synchronisation is applied and changes what the Git pane shows
- **THEN** a record carries its trigger, whether it was scoped, the worktree count, and its duration

#### Scenario: A synchronisation is superseded

- **WHEN** a synchronisation's result arrives after a later one has started
- **THEN** a record shows it was discarded as superseded

#### Scenario: A synchronisation fails

- **WHEN** a synchronisation fails
- **THEN** a record shows the failure and its trigger
- **AND** the user-visible Git operation failure is still recorded as this specification requires

#### Scenario: Renderer authority is unchanged

- **WHEN** the renderer reports a synchronisation outcome
- **THEN** it uses no privileged diagnostics channel, file path, or file handle
