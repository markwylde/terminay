## ADDED Requirements

### Requirement: Worktree rows show worktree properties

Each Worktrees panel row SHALL show the worktree properties published for that
worktree, as defined by the `worktree-properties` capability, beneath its name
and alongside its change summary. Showing them SHALL NOT change the row's
existing actions, hover behaviour, or change summary.

#### Scenario: Row with properties

- **WHEN** a worktree has a pull request and checks published for it
- **THEN** its row shows the pull request chip and checks chip alongside its
  existing change summary

#### Scenario: Existing actions unaffected

- **WHEN** a worktree row shows properties
- **THEN** open-terminal, switch-project-root, copy-path, reveal,
  presentation-rename, remove, and pull remain available where Git permits them
