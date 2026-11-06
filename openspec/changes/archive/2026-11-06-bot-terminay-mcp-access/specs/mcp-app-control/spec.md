## MODIFIED Requirements

### Requirement: Reach decides app-level authority

Every MCP caller SHALL hold one of two reaches, which come from its capability scope. **Workspace reach** belongs to a terminal of the automation terminal space, to a chat whose reach is the workspace, and to a bot execution. **Project reach** belongs to every other terminal and to a chat whose reach is one project. A workspace-reach caller SHALL be able to use every app-level tool, over every project and workspace window of its own server. A project-reach caller SHALL be able to use only `list_projects`, `update_project` and `list_shell_profiles`, and SHALL use them only for its own project. These two tools SHALL be limited to that project as follows:

- `list_projects` returns only the caller's own project.
- `update_project` changes only that project's name, icon and colour.

Any other app-level tool called with project reach SHALL fail with `out_of_scope` and change nothing. A project, window or terminal handle outside the caller's reach SHALL fail as not found. The server SHALL decide reach from the capability alone, revalidated against canonical state on every request. A title, a path, UI focus or a renderer reply SHALL NEVER decide it.

#### Scenario: Pixel creates a project

- **WHEN** Pixel, a workspace-reach chat, calls `create_project` with root `~` and the request is permitted
- **THEN** the project is created on Pixel's server, and the result carries its project handle

#### Scenario: Bot creates a project

- **WHEN** an execution of a bot with Terminay MCP access calls `create_project` with root `~`
- **THEN** the project is created on the bot's server, and the result carries its project handle

#### Scenario: Project terminal tries to create a project

- **WHEN** an agent in a project terminal calls `create_project`
- **THEN** the call fails with `out_of_scope` and no project is created

#### Scenario: Project terminal renames its own project

- **WHEN** an agent in project "api" calls `update_project` for its own project with the name "API service"
- **THEN** the project is renamed on every client

#### Scenario: Project terminal changes its own root

- **WHEN** an agent in project "api" calls `update_project` for its own project with a new root
- **THEN** the call fails with `out_of_scope` and the project is unchanged

#### Scenario: Project terminal names another project

- **WHEN** an agent in project "api" calls `update_project` with a handle of project "web"
- **THEN** the call fails as not found
