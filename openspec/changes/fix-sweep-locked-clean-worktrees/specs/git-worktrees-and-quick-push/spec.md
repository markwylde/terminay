## ADDED Requirements

### Requirement: A lock does not exempt a clean worktree from removal

Bulk deletion SHALL nominate a clean worktree whether or not Git reports it as locked, and the confirmation SHALL mark each locked worktree it names. Clean-only removal of a locked worktree SHALL apply the same cleanliness and reviewed-HEAD checks as for an unlocked one before the lock is touched, SHALL then lift the lock and invoke Git's unforced worktree removal, and SHALL NOT force the removal. When Git refuses the removal, the worktree SHALL remain and SHALL be locked again with the reason its lock carried.

#### Scenario: Locked clean worktree is swept

- **WHEN** the user confirms a bulk deletion that names a clean worktree locked by an agent session
- **THEN** the worktree is removed and its row disappears
- **AND** its branch still exists

#### Scenario: Confirmation marks the lock

- **WHEN** the bulk deletion confirmation names a locked worktree
- **THEN** that worktree is marked as locked in the list

#### Scenario: Locked worktree that is no longer clean

- **WHEN** clean-only removal targets a locked worktree that gained a file after the listing
- **THEN** the removal is refused as not clean
- **AND** the worktree, the file, and the lock with its reason remain
