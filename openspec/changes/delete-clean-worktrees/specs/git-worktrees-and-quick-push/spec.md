## ADDED Requirements

### Requirement: Git pane menu

The Git pane header SHALL present a pane menu button at its trailing edge. Activating it SHALL open a menu of actions that apply to the repository's worktrees as a whole. The menu SHALL offer "Delete all clean worktrees". The button SHALL be operable by keyboard and SHALL carry an accessible name.

#### Scenario: Opening the pane menu

- **WHEN** a user activates the pane menu button in the Git pane header
- **THEN** a menu opens anchored to the button
- **AND** it offers "Delete all clean worktrees"

#### Scenario: No eligible worktrees

- **WHEN** the pane menu opens and no worktree is eligible for bulk deletion
- **THEN** "Delete all clean worktrees" is shown disabled

#### Scenario: Activating the button does not collapse the pane

- **WHEN** a user activates the pane menu button
- **THEN** the Git pane keeps its collapsed or expanded state

### Requirement: Bulk deletion of clean worktrees

"Delete all clean worktrees" SHALL target every worktree that is shown as clean under the effective-cleanliness contract, excluding the main worktree, bare worktrees, the project's current worktree, locked worktrees, prunable worktrees, and worktrees with a deletion or pull in progress. Before removing anything, Terminay SHALL ask for one confirmation that states how many worktrees will be deleted and names each of them. Declining SHALL remove nothing. Branches SHALL NOT be deleted.

#### Scenario: Confirmation names the targets

- **WHEN** a user chooses "Delete all clean worktrees" with three eligible worktrees
- **THEN** one confirmation states that three worktrees will be deleted and names each one
- **AND** no removal has been requested yet

#### Scenario: Declining the confirmation

- **WHEN** the user declines the confirmation
- **THEN** no worktree is removed

#### Scenario: Changed worktrees are left alone

- **WHEN** the listing contains worktrees with working-tree changes or unmerged committed changes
- **THEN** they are not named in the confirmation and are not removed

#### Scenario: Protected worktrees are left alone

- **WHEN** the main worktree, the project's current worktree, or a locked worktree is shown as clean
- **THEN** it is not named in the confirmation and is not removed

#### Scenario: Branches survive

- **WHEN** a clean worktree is removed by the bulk action
- **THEN** its branch still exists in the repository

### Requirement: Bulk deletion progress and outcome

Confirmed bulk deletions SHALL run one at a time through the same per-repository serialization as single removals, and each targeted row SHALL show that it is being deleted until its removal settles. A refusal or failure for one worktree SHALL NOT stop the remaining removals. When the batch settles, Terminay SHALL report how many worktrees were deleted and SHALL name each worktree that was not deleted together with the reason.

#### Scenario: Rows show progress

- **WHEN** a confirmed bulk deletion is running
- **THEN** each targeted worktree row shows a deleting state until its own removal settles

#### Scenario: One refusal does not stop the batch

- **WHEN** the server refuses one targeted worktree because it is no longer clean
- **THEN** the remaining targeted worktrees are still removed
- **AND** the outcome names the refused worktree and states that it has changes

#### Scenario: Everything removed

- **WHEN** every targeted worktree is removed
- **THEN** the outcome reports the number deleted and the rows are gone from the panel

### Requirement: Server-owned clean-only worktree removal

The server SHALL offer a clean-only worktree removal that is identity-bound in the same way as forced removal and SHALL require the full HEAD the client reviewed. The server SHALL obtain the canonical path from a fresh bounded worktree listing and, immediately before invoking Git, SHALL recompute effective cleanliness: no working-tree entries, including untracked files, and no effective committed changes relative to the repository default branch. A worktree that is not clean SHALL be refused with a structured not-clean result and SHALL be left untouched. A changed HEAD SHALL be reported as stale. Main, bare, locked, and prunable worktrees SHALL be rejected. The server SHALL invoke Git's unforced worktree removal, so Git's own refusal of a modified or locked worktree remains in effect, and SHALL verify that the exact identity disappeared.

#### Scenario: Clean worktree removed

- **WHEN** a client requests clean-only removal of a linked worktree that is still clean at the reviewed HEAD
- **THEN** the server removes it without forcing and verifies the identity is no longer listed

#### Scenario: Worktree gained an untracked file after the listing

- **WHEN** a file is created in the worktree after the client's listing and before the server's recheck
- **THEN** the removal is refused as not clean
- **AND** the worktree folder and the new file still exist

#### Scenario: Worktree gained an unmerged commit after the listing

- **WHEN** the worktree's HEAD no longer matches the reviewed HEAD
- **THEN** the removal is reported as stale rather than performed

#### Scenario: Reviewed HEAD omitted

- **WHEN** a clean-only removal request carries no reviewed HEAD
- **THEN** the request is rejected

#### Scenario: Locked worktree

- **WHEN** clean-only removal targets a worktree that Git reports as locked
- **THEN** the request is rejected and the worktree remains

#### Scenario: Read-only authorization

- **WHEN** a client without write scope requests clean-only removal
- **THEN** the request is rejected

## MODIFIED Requirements

### Requirement: Git protocol adapter operations

The server Git protocol adapter SHALL expose stable, project-scoped operations for listing and removing worktrees, including clean-only removal as an operation distinct from forced removal, plus host-gated open-terminal, switch-project, presentation-rename, reveal, and copy actions. Requests SHALL carry only canonical repository and worktree IDs; host callbacks SHALL receive those opaque IDs and SHALL fail closed when a capability is unavailable. A server that does not implement clean-only removal SHALL fail the request rather than perform a forced removal. Quick Push proposals SHALL resolve an omitted target branch from the server's canonical default-branch listing, and the adapter SHALL bind the resulting proposal to the authorized project before approval.

#### Scenario: Host capability unavailable

- **WHEN** a host-gated action is requested and the host does not advertise that capability
- **THEN** the operation fails closed

#### Scenario: Omitted target branch

- **WHEN** a Quick Push proposal omits a target branch
- **THEN** the server resolves it from its canonical default-branch listing

#### Scenario: Opaque identifiers only

- **WHEN** a worktree action is submitted
- **THEN** it carries only canonical repository and worktree IDs and host callbacks receive those opaque IDs

#### Scenario: Clean-only removal is not forced removal

- **WHEN** a client submits a clean-only removal
- **THEN** it is routed to the clean-only operation and never to forced removal
- **AND** a server without that operation rejects the request and removes nothing
