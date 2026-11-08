## ADDED Requirements

### Requirement: Listing recent project folders

`list_recent_folders` SHALL return the server's recent project folders, the same list the start chooser shows, newest first. Each SHALL carry its absolute path and when it was last used. It SHALL be read-only and SHALL require workspace reach; project reach SHALL fail with `out_of_scope`. No MCP tool SHALL browse directories, forget a recent folder or make a project's start choice.

#### Scenario: Choosing where a new project goes

- **WHEN** a workspace-reach caller calls `list_recent_folders` after projects were started in `~/Documents/Projects/a` and then `~/Documents/Projects/b`
- **THEN** it receives both paths, `b` first, each with its last-used time

#### Scenario: Project reach

- **WHEN** a project terminal calls `list_recent_folders`
- **THEN** the call fails with `out_of_scope`
