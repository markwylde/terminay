## MODIFIED Requirements

### Requirement: Destructive removal confirmation and serialization

The removal confirmation SHALL explicitly warn that the worktree folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted. For a prunable worktree the confirmation SHALL instead state that its working tree is already gone and nothing on disk is deleted. When removal starts from deleting the worktree's folder, this warning SHALL be part of that folder's single delete dialog and SHALL NOT be asked again. Once the user confirms, the server SHALL use Git's forced worktree removal so those visible changes and a Git lock do not block the action. Confirmed deletions for one repository SHALL run one at a time.

#### Scenario: Confirmation warning

- **WHEN** a user is asked to confirm worktree removal
- **THEN** the confirmation states that the folder, including uncommitted, untracked, and unmerged changes, will be permanently deleted

#### Scenario: Prunable worktree confirmation

- **WHEN** a user is asked to confirm removal of a prunable worktree
- **THEN** the confirmation states that nothing on disk is deleted

#### Scenario: Removal from a folder asks once

- **WHEN** a user chooses Delete in the delete dialog of a linked folder
- **THEN** the worktree is removed without a second confirmation

#### Scenario: Dirty worktree removal

- **WHEN** the user confirms removal of a dirty or unmerged worktree
- **THEN** forced removal deletes it, including its uncommitted and untracked files

#### Scenario: Locked dirty worktree removal

- **WHEN** the user confirms removal of a locked worktree that also has uncommitted or untracked files
- **THEN** forced removal deletes it, including those files

#### Scenario: Concurrent confirmed deletions

- **WHEN** two confirmed deletions for one repository are requested
- **THEN** they complete one at a time and a successful delete is not reported as Git unavailable
