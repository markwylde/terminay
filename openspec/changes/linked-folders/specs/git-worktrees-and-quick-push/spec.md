## ADDED Requirements

### Requirement: Explorer pane arrangement for Files and Changes

Files and Changes SHALL be independently collapsible panes in the Explorer sidebar group. Their vertical order within that group SHALL be user-configurable and SHALL persist for each project independently.

#### Scenario: Reordering Files and Changes

- **WHEN** a user reorders the Files and Changes panes within the Explorer group
- **THEN** the new order persists for that project only

#### Scenario: Collapsing a pane

- **WHEN** a user collapses Files or Changes
- **THEN** the other pane remains independently expandable

### Requirement: Changes pane presentation

The Changes pane SHALL report the branch and the working-tree changes of one worktree: the worktree of the project's selected folder, which is the project root checkout for General and for a plain folder. It SHALL offer list and tree presentations. Selecting a change SHALL open the relevant file or diff using the file-viewer contract, in the selected folder. The pane SHALL NOT list other worktrees or their changes. When the selected folder's root is not inside a Git repository, the pane SHALL state that it is not a repository and SHALL offer no Git action.

#### Scenario: Selecting a change

- **WHEN** a user selects a changed file in the Changes pane
- **THEN** the relevant file or diff opens through the file-viewer contract as a panel of the selected folder

#### Scenario: Changing the selected folder

- **WHEN** a user selects a different linked folder
- **THEN** the Changes pane shows that folder's branch and working-tree changes, and none from the worktree shown before

#### Scenario: List and tree presentations

- **WHEN** a user switches between list and tree presentation
- **THEN** the same working-tree changes are shown in the selected presentation

#### Scenario: Not a repository

- **WHEN** the selected folder's root is not inside a Git repository
- **THEN** the pane states that it is not a repository and offers no Git action

### Requirement: Worktree actions

Known worktrees and their state SHALL be presented as the linked folders of the Folders tree, with General standing for the project root checkout. From a folder's context menu users SHALL be able to open a terminal at its worktree, copy or reveal its path, rename the worktree's presentation, remove the worktree, run Quick Push, and pull the worktree from origin when Git permits it. Changed-file and folder rows in the Changes pane SHALL keep the Explorer hover highlight.

#### Scenario: Worktree actions available

- **WHEN** a user opens the context menu of a linked folder
- **THEN** open-terminal, copy-path, reveal, presentation-rename, remove, Quick Push, and pull are available where Git permits them

#### Scenario: A new worktree appears

- **WHEN** a worktree is added to the repository while an earlier Git status request is still pending
- **THEN** its folder appears and the Changes pane of the selected folder is refreshed

## REMOVED Requirements

### Requirement: Explorer pane arrangement for Files and Git

**Reason**: The pane is the Changes pane. The same arrangement contract is restated as "Explorer pane arrangement for Files and Changes".

**Migration**: None for users. A stored pane order and collapse state for the Git pane apply to the Changes pane.

### Requirement: Repository and change presentation

**Reason**: The pane reports one worktree, the selected folder's, instead of the repository and every listed worktree. Restated as "Changes pane presentation".

**Migration**: To see another worktree's changes, select its folder in the Folders tree.

### Requirement: Worktrees panel actions

**Reason**: The Worktrees panel is replaced by the linked folders of the Folders tree. Its actions are restated as "Worktree actions", without switch-project-root.

**Migration**: Use the folder's context menu. Selecting a folder replaces switching the project root.

### Requirement: Cross-worktree mutations switch the project root first

**Reason**: The Changes pane shows one worktree, the selected folder's, so a create, rename, or delete can no longer start from another worktree's rows. A folder's root is resolved by the server per operation, so no operation needs to change the project's root to reach a worktree.

**Migration**: Select the worktree's folder, then create, rename, or delete from Files or Changes. The `project.root.update` command remains for changing a project's root deliberately; it is no longer issued as a side effect of a file operation.
