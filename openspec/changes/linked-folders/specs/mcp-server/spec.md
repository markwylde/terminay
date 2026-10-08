## ADDED Requirements

### Requirement: MCP terminals land in the caller's folder

A terminal created through `open_terminal` or `split_terminal` by a
project-scope caller SHALL be created in the folder that holds the calling
terminal, and when no working directory is given SHALL start in that folder's
root under the canonical launch policy. A terminal a workspace-scope caller
creates in a named project SHALL be created in that project's General folder.
`list_terminals` SHALL list the terminals of every folder in scope, and no MCP
tool SHALL accept a folder as an input or use a folder to widen or narrow its
scope.

#### Scenario: An agent opens a terminal from a linked folder

- **WHEN** an agent whose terminal is in a linked folder calls `open_terminal`
  with no working directory
- **THEN** the new terminal is in that linked folder and starts in its worktree

#### Scenario: Listing across folders

- **WHEN** a project-scope caller calls `list_terminals` in a project with
  terminals in three folders
- **THEN** the terminals of all three folders are listed

#### Scenario: Workspace-scope caller names a project

- **WHEN** a workspace-scope caller calls `open_terminal` with a project handle
- **THEN** the terminal is created in that project's General folder
