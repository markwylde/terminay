## ADDED Requirements

### Requirement: Server-routed Git ownership

Terminay Server SHALL be the only execution authority for repository, worktree, and Quick Push operations. Repository detection, branch and status, changed files, normalized diff, and refresh events SHALL run in server-core. Every operation SHALL bind to a canonical project, repository, and worktree identity; a client-supplied path SHALL NOT select or redirect an operation. Local and remote clients SHALL observe the same project repository and worktree state.

#### Scenario: Client path cannot redirect an operation

- **WHEN** a client supplies a filesystem path in place of a canonical identity
- **THEN** the operation is rejected

#### Scenario: Remote client sees the same state

- **WHEN** a remote client queries a project's repository state
- **THEN** it observes the same status and worktree listing as a local client

### Requirement: Git constraints are reported, not guessed

Detached-head, missing gitfile, absent remote, unmerged, and command-error states SHALL be preserved as distinct reported states rather than collapsed into a generic failure. An error SHALL identify the exact failed proposal, Git, push, or pull-request step.

#### Scenario: Detached head is reported

- **WHEN** a worktree is on a detached HEAD
- **THEN** that exact state is reported rather than an inferred branch

#### Scenario: Missing remote is reported

- **WHEN** a repository has no matching remote
- **THEN** the absent remote is reported as its own state

### Requirement: Git progress and status-change events

The server SHALL publish ordered `git.progress` and `git.status.changed` metadata with bounded revisions to authorized clients. A client projection that detects a gap in that ordering SHALL request a resync rather than inventing an intermediate status transition. Two clients observing one mutation SHALL receive identical ordered events and the same resulting status revision.

#### Scenario: Gap triggers resync

- **WHEN** a client projection detects a missing revision in the ordered event stream
- **THEN** it requests a resync and does not synthesise a status transition

#### Scenario: Two clients converge

- **WHEN** one mutation changes repository status
- **THEN** both subscribed clients receive identical ordered events and the same resulting revision

### Requirement: Server-owned worktree removal

Worktree list, open terminal, switch project root, rename presentation, remove, and pull operations SHALL execute on the server, addressed by an opaque worktree identity resolved from the server's own bounded listing. Before removal the server SHALL check the reviewed full HEAD, re-read status immediately before removing, and verify afterwards that the identity is gone. The main worktree SHALL NOT be removable, and bare, locked, prunable, dirty, and unmerged worktrees SHALL be rejected. A pull SHALL perform clean, upstream, and stale checks and SHALL verify the post-pull status.

#### Scenario: Main worktree removal is refused

- **WHEN** removal of the main worktree is requested
- **THEN** the request is refused

#### Scenario: Dirty worktree removal is refused

- **WHEN** the worktree is bare, locked, prunable, dirty, or unmerged
- **THEN** removal is refused

#### Scenario: Status changed since review

- **WHEN** the status re-read immediately before removal differs from the reviewed state
- **THEN** the removal is refused

#### Scenario: Pull verifies its outcome

- **WHEN** a worktree pull completes
- **THEN** the server verifies the post-pull status before reporting success

### Requirement: Quick Push coordinator identity binding

Quick Push provider discovery, planning, and Git and remote commands SHALL run on the server machine. The server SHALL produce a bounded structured proposal, with bounded status and diff context and a validated ordered action plan, for explicit client review. Nothing SHALL be mutated before that review. Approval SHALL carry canonical identities, a status and revision digest, and an action digest, and SHALL be single-use and expiring; a stale or replayed approval SHALL be rejected.

#### Scenario: Nothing mutates before review

- **WHEN** a Quick Push proposal is produced
- **THEN** no repository or remote state has been mutated

#### Scenario: Replayed approval is rejected

- **WHEN** an approval is presented a second time
- **THEN** it is rejected

#### Scenario: Stale approval is rejected

- **WHEN** the repository revision or the action digest no longer matches the approval
- **THEN** the approval is rejected

### Requirement: Per-action revalidation and bounded provider execution

The server SHALL revalidate state immediately before each mutation in an approved plan. When state has changed, execution SHALL stop and report a deterministic partial failure naming the actions already applied and the step that could not proceed. Default-branch and already-applied-commit semantics SHALL be preserved without implicit history rewriting: an already-applied commit SHALL be skipped and the resulting branch SHALL still be pushed. The planner and each executor action SHALL receive a linked abort signal and a server-side deadline, and provider output SHALL be bounded and redacted.

#### Scenario: Stale next step reports a partial failure

- **WHEN** the revision changes between two actions of an approved plan
- **THEN** execution stops and reports the already-applied actions and the failed step

#### Scenario: Already-applied commit is skipped

- **WHEN** the proposed commit is already present on the default branch
- **THEN** the commit is skipped and the resulting branch is still pushed

#### Scenario: Long operation is cancellable

- **WHEN** a Git or provider operation exceeds its server-side deadline or is cancelled
- **THEN** it is aborted and only bounded, redacted output is returned

### Requirement: Git execution safety and environment boundary

Git, SSH, provider CLI, GitHub, and Gitea credentials SHALL remain in the server environment and vault. Provider execution SHALL inherit the server Git environment or resolve provider bytes through an injected server credential callback. Credential material SHALL NOT be copied into protocol snapshots or client settings, and the client Git contract SHALL contain only canonical identities, reviewed actions, and bounded proposal metadata. Native reveal and clipboard copy SHALL be gated by host capabilities; their callbacks SHALL receive only opaque identities and their results SHALL strip path metadata.

#### Scenario: Credentials never reach a client

- **WHEN** a remote client reads Git status, a proposal, or provider output
- **THEN** no credential material is present and provider output is redacted

#### Scenario: Reveal is capability-gated

- **WHEN** a client without the native reveal capability requests reveal
- **THEN** the action is unavailable, and no server path is disclosed
