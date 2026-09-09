## MODIFIED Requirements

### Requirement: Server-owned worktree removal

Worktree removal SHALL be server-owned and identity-bound. The client SHALL submit only the project, repository, and opaque worktree IDs, optionally the full HEAD it reviewed. The server SHALL obtain the canonical path from a fresh bounded worktree listing, recheck status immediately before invoking Git, and then verify that the exact identity disappeared. If the registered worktree path has already disappeared and Git marks the entry prunable, removal SHALL clean up that stale registration without trying to run status inside the missing path. Main and bare worktrees SHALL be rejected. A Git lock on a linked worktree SHALL NOT prevent confirmed removal. A changed reviewed HEAD SHALL be reported as stale rather than removed.

#### Scenario: Removal by identity

- **WHEN** a client requests removal with project, repository, and opaque worktree IDs
- **THEN** the server resolves the canonical path from a fresh bounded listing, rechecks status, invokes Git, and verifies the exact identity disappeared

#### Scenario: Prunable stale registration

- **WHEN** the registered worktree path is already absent and Git marks the entry prunable
- **THEN** the stale registration is cleaned up without running status inside the missing path
- **AND** no worktree-list or status error is reported

#### Scenario: Protected worktree kinds

- **WHEN** removal targets a main or bare worktree
- **THEN** the request is rejected

#### Scenario: Locked linked worktree

- **WHEN** the user confirms removal of a linked worktree that Git reports as locked
- **THEN** the server removes it
- **AND** the worktree identity is no longer listed

#### Scenario: Stale reviewed HEAD

- **WHEN** the reviewed HEAD no longer matches
- **THEN** the removal is reported as stale rather than performed

### Requirement: Destructive removal confirmation and serialization

The removal confirmation SHALL explicitly warn that the worktree folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted. Once the user confirms, the server SHALL use Git's forced worktree removal so those visible changes and a Git lock do not block the action. Confirmed deletions for one repository SHALL run one at a time.

#### Scenario: Confirmation warning

- **WHEN** a user is asked to confirm worktree removal
- **THEN** the confirmation states that the folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted

#### Scenario: Dirty worktree removal

- **WHEN** the user confirms removal of a dirty or unmerged worktree
- **THEN** forced removal deletes it, including its uncommitted and untracked files

#### Scenario: Locked dirty worktree removal

- **WHEN** the user confirms removal of a locked worktree that also has uncommitted or untracked files
- **THEN** forced removal deletes it, including those files

#### Scenario: Concurrent confirmed deletions

- **WHEN** two confirmed deletions for one repository are requested
- **THEN** they complete one at a time and a successful delete is not reported as Git unavailable
