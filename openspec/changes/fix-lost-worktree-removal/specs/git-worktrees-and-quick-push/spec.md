## MODIFIED Requirements

### Requirement: Server-owned worktree removal

Worktree removal SHALL be server-owned and identity-bound. The client SHALL submit only the project, repository, and opaque worktree IDs, optionally the full HEAD it reviewed. The server SHALL obtain the canonical path from a fresh bounded worktree listing, recheck status immediately before invoking Git, and then verify that the exact identity disappeared. A linked worktree SHALL be prunable when Git marks it prunable, or when it is locked and its `.git` no longer exists. Removing a prunable worktree SHALL remove only that worktree's registration, without running status inside its path, without changing anything at its path, and without removing any other registration. Main and bare worktrees SHALL be rejected. A Git lock on a linked worktree SHALL NOT prevent confirmed removal. A changed reviewed HEAD SHALL be reported as stale rather than removed.

#### Scenario: Removal by identity

- **WHEN** a client requests removal with project, repository, and opaque worktree IDs
- **THEN** the server resolves the canonical path from a fresh bounded listing, rechecks status, invokes Git, and verifies the exact identity disappeared

#### Scenario: Prunable stale registration

- **WHEN** the registered worktree path is already absent and Git marks the entry prunable
- **THEN** the stale registration is cleaned up without running status inside the missing path
- **AND** no worktree-list or status error is reported

#### Scenario: Locked worktree whose folder was removed

- **WHEN** a locked linked worktree's folder, or a folder containing it, has been removed
- **THEN** the listing reports it prunable
- **AND** confirmed removal removes its registration and keeps its branch

#### Scenario: Path no longer holds the worktree

- **WHEN** a linked worktree's `.git` file was removed, its folder emptied, or its path replaced by a file
- **THEN** confirmed removal removes its registration
- **AND** whatever remains at the path is left untouched

#### Scenario: Other stale registrations

- **WHEN** a prunable worktree is removed while another registration is also stale
- **THEN** the other registration remains listed

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

The removal confirmation SHALL explicitly warn that the worktree folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted. For a prunable worktree the confirmation SHALL instead state that its working tree is already gone and nothing on disk is deleted. Once the user confirms, the server SHALL use Git's forced worktree removal so those visible changes and a Git lock do not block the action. Confirmed deletions for one repository SHALL run one at a time.

#### Scenario: Confirmation warning

- **WHEN** a user is asked to confirm worktree removal
- **THEN** the confirmation states that the folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted

#### Scenario: Prunable worktree confirmation

- **WHEN** a user is asked to confirm removal of a prunable worktree
- **THEN** the confirmation states that nothing on disk is deleted

#### Scenario: Dirty worktree removal

- **WHEN** the user confirms removal of a dirty or unmerged worktree
- **THEN** forced removal deletes it, including its uncommitted and untracked files

#### Scenario: Locked dirty worktree removal

- **WHEN** the user confirms removal of a locked worktree that also has uncommitted or untracked files
- **THEN** forced removal deletes it, including those files

#### Scenario: Concurrent confirmed deletions

- **WHEN** two confirmed deletions for one repository are requested
- **THEN** they complete one at a time and a successful delete is not reported as Git unavailable

## ADDED Requirements

### Requirement: Missing worktrees and visible action failures

The Worktrees panel SHALL label a prunable worktree `missing` rather than `clean`. A failed worktree action SHALL stay visible after the Git refresh that follows it succeeds; a successful refresh SHALL clear only a failure that a refresh raised.

#### Scenario: Missing worktree row

- **WHEN** a listed worktree is prunable
- **THEN** its row is labelled `missing`

#### Scenario: Failed delete

- **WHEN** a worktree delete fails and the following Git refresh succeeds
- **THEN** the delete's failure remains visible
