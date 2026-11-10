## MODIFIED Requirements

### Requirement: Creating a project

`create_project` SHALL take an explicit `root` and an optional name, icon, colour and window handle. The root SHALL be an absolute path, `~`, or a path beginning `~/`. The server SHALL expand `~` to the server account's home directory.

- A root of exactly `~` SHALL start the project exactly as the start chooser's Home directory choice does.
- Any other root SHALL be canonicalised and validated on the server exactly as the start chooser's Open a folder choice validates it, and SHALL become the project's explicit root.

The project SHALL never be left awaiting a start choice. Its first terminal SHALL launch through the normal terminal-launch resolver. The project SHALL go into the named window. Without one, it SHALL go into the window the agent's client shows, or the server's first window when there is no agent's client. Creating a project SHALL NOT change what any client shows: each client's active project or Home selection, its shown folder and tab, and its keyboard focus SHALL stay as they were, and the new project SHALL appear as a background tab. Only the user, or an explicit view tool such as `focus_project`, SHALL bring it to the front. The result SHALL carry the project handle and the first terminal's handle, and SHALL carry no field reporting whether the project was shown. When the project starts but its first terminal fails to launch, the project SHALL remain and the result SHALL carry a `terminal_reason` in place of the terminal handle. A root that fails validation SHALL fail with a typed error and SHALL create nothing. `create_project` SHALL NOT list, browse or suggest directories.

#### Scenario: Project in the home directory

- **WHEN** a workspace-reach caller calls `create_project` with root `~`
- **THEN** the project has no root folder and its first terminal starts in the server account's home directory

#### Scenario: Creating a project keeps the user's view

- **WHEN** the user is working in one project, or on Home, and Pixel, a bot or an agent calls `create_project`
- **THEN** the new project appears as a background tab, every client still shows the project or Home section it showed before, with the same tab and keyboard focus, and no view request is sent to any client

#### Scenario: First terminal fails to launch

- **WHEN** a workspace-reach caller calls `create_project` and the project starts but its first terminal cannot launch
- **THEN** the project remains, the result carries the project handle and a `terminal_reason` instead of a terminal handle, and no client's view changes

#### Scenario: Showing the new project on request

- **WHEN** a workspace-reach caller calls `create_project` and then `focus_project` with the returned handle
- **THEN** the agent's client shows the new project only after `focus_project`

#### Scenario: Project in a folder

- **WHEN** a workspace-reach caller calls `create_project` with root `~/code/api` and no name
- **THEN** the project's root is that folder's canonical path, it is named "api", and its first terminal starts there

#### Scenario: Missing folder

- **WHEN** a workspace-reach caller calls `create_project` with a root that does not exist or is not a directory
- **THEN** the call fails with a typed error and no project or terminal is created

#### Scenario: Relative root

- **WHEN** a workspace-reach caller calls `create_project` with root `code/api`
- **THEN** the call fails as a bad request and nothing is created
