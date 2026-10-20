## ADDED Requirements

### Requirement: Folder housekeeping tools

`delete_folder` SHALL delete one empty plain folder of a project in scope. It SHALL fail for the General folder, and for a folder linked to a worktree, because removing a worktree is a Git action outside the MCP surface. It SHALL fail with `conflict` for a folder that still holds a tab. `reorder_folders` SHALL set the order of all of one project's folders and SHALL fail when the list it is given is not exactly that project's folders. Both SHALL be workspace commands that every device observes, and neither SHALL widen or narrow the caller's scope.

#### Scenario: Removing an emptied folder

- **WHEN** an agent moves the last tab out of a plain folder and calls `delete_folder` for it
- **THEN** the folder is removed on every device

#### Scenario: Folder that still holds a tab

- **WHEN** an agent calls `delete_folder` for a plain folder that still holds a tab
- **THEN** the call fails with `conflict`, and the folder and its tab are unchanged

#### Scenario: Worktree folder

- **WHEN** an agent calls `delete_folder` for an empty folder linked to a worktree
- **THEN** the call fails, and the folder and its worktree are unchanged

#### Scenario: Reordering with a folder from another project

- **WHEN** an agent calls `reorder_folders` with a list that includes a folder of another project
- **THEN** the call fails as not found and no order changes

### Requirement: Home tools

`focus_home` SHALL show Home on the agent's client, and SHALL bring one Home section, **Home**, **Tabs** or **Automations**, to the front when the caller names it. It SHALL require workspace reach and SHALL fail with `out_of_scope` for project reach. `focus_project` given the automation terminal space's handle SHALL show Home with the Automations section in front on the agent's client, because Home is where that space is shown. A project-reach caller can never name that handle. Home's state SHALL stay device-local presentation, and no other client's Home SHALL change.

#### Scenario: Pixel shows the dashboard

- **WHEN** a user asks Pixel from Desktop to show every tab and Pixel calls `focus_home` with section Tabs
- **THEN** that Desktop window shows Home with the Tabs section in front, and no other client changes

#### Scenario: Showing the automation space

- **WHEN** a workspace-reach caller calls `focus_project` with the automation space's handle
- **THEN** the agent's client shows Home with Automations in front

#### Scenario: Project terminal asks for Home

- **WHEN** an agent in a project terminal calls `focus_home`
- **THEN** the call fails with `out_of_scope` and no view changes
