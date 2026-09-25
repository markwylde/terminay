## MODIFIED Requirements

### Requirement: Worktrees panel actions

The Worktrees panel SHALL show known worktrees and their state in two-line rows: the worktree's name at full width with its actions button, then its change size and, when any worktree has worktree properties, its pull request and checks in slots aligned from row to row. Selecting a row SHALL expand or collapse its changed files, with the row's disclosure chevron showing which. Activating a row's checks indicator SHALL separately show or hide its branch, pull request, and checks. Each row SHALL have an actions button that opens the same worktree actions as its context menu. Users SHALL be able to commit and push with an AI agent, open a terminal at a worktree, switch the project root, copy or reveal its path, rename its presentation, remove a worktree, and pull a worktree from origin when Git permits it. Worktree rows SHALL stay visually quiet on hover while the actions button still highlights. Changed-file and folder rows SHALL keep the Explorer hover highlight.

#### Scenario: Worktree actions available

- **WHEN** a user opens a worktree row's actions button or context menu
- **THEN** commit-and-push, open-terminal, switch-project-root, copy-path, reveal, presentation-rename, remove, and pull are available where Git permits them

#### Scenario: Hover presentation

- **WHEN** the pointer hovers a worktree row
- **THEN** the row stays visually quiet while the actions button highlights

#### Scenario: Expanding a row

- **WHEN** a user selects a collapsed worktree row
- **THEN** the row expands to show its changed files, and its checks stay as they were

#### Scenario: Showing checks

- **WHEN** a user activates a worktree's checks indicator
- **THEN** its branch, pull request, and checks are shown, independently of its changed files

#### Scenario: Repository without worktree properties

- **WHEN** no worktree in the repository has worktree properties
- **THEN** rows show only the name and change size

#### Scenario: Switching the project root refreshes Git

- **WHEN** a user switches the project root while an earlier Git status request is still pending
- **THEN** the Git sidebar immediately refreshes for the new root

## ADDED Requirements

### Requirement: Worktree rows show worktree properties

Each Worktrees panel row SHALL show the worktree properties published for that
worktree, as defined by the `worktree-properties` capability, in its pull
request and checks columns alongside its change summary. Showing them SHALL NOT change the row's
existing actions, hover behaviour, or change summary.

#### Scenario: Row with properties

- **WHEN** a worktree has a pull request and checks published for it
- **THEN** its row shows the pull request number and a checks indicator
  alongside its change summary

#### Scenario: Existing actions unaffected

- **WHEN** a worktree row shows properties
- **THEN** commit-and-push, open-terminal, switch-project-root, copy-path,
  reveal, presentation-rename, remove, and pull remain available where Git
  permits them
