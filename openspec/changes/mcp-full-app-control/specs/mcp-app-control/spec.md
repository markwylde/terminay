## ADDED Requirements

### Requirement: Reach decides app-level authority

Every MCP caller SHALL hold one of two reaches, which come from its capability scope. **Workspace reach** belongs to a terminal of the automation terminal space and to a chat whose reach is the workspace. **Project reach** belongs to every other terminal and to a chat whose reach is one project. A workspace-reach caller SHALL be able to use every app-level tool, over every project and workspace window of its own server. A project-reach caller SHALL be able to use only `list_projects`, `update_project` and `list_shell_profiles`, and SHALL use them only for its own project. These two tools SHALL be limited to that project as follows:

- `list_projects` returns only the caller's own project.
- `update_project` changes only that project's name, icon and colour.

Any other app-level tool called with project reach SHALL fail with `out_of_scope` and change nothing. A project, window or terminal handle outside the caller's reach SHALL fail as not found. The server SHALL decide reach from the capability alone, revalidated against canonical state on every request. A title, a path, UI focus or a renderer reply SHALL NEVER decide it.

#### Scenario: Pixel creates a project

- **WHEN** Pixel, a workspace-reach chat, calls `create_project` with root `~` and the request is permitted
- **THEN** the project is created on Pixel's server, and the result carries its project handle

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

### Requirement: Listing projects

`list_projects` SHALL return, for each project in reach, the following fields:

- its opaque project handle, the same handle `list_terminals` uses;
- its name, icon and colour;
- its root for display, or that it has no root folder;
- its default shell profile id, where it has one;
- the handle of the workspace window it is in, and its position there.

For a workspace-reach caller it SHALL also list the automation terminal space, marked as such and with no window. The result SHALL be bounded.

#### Scenario: Workspace listing

- **WHEN** a workspace-reach caller calls `list_projects` on a server with two windows holding three projects
- **THEN** it receives the three projects, each with its window handle and position, and the automation terminal space

### Requirement: Creating a project

`create_project` SHALL take an explicit `root` and an optional name, icon, colour and window handle. The root SHALL be an absolute path, `~`, or a path beginning `~/`. The server SHALL expand `~` to the server account's home directory.

- A root of exactly `~` SHALL start the project exactly as the start chooser's Home directory choice does.
- Any other root SHALL be canonicalised and validated on the server exactly as the start chooser's Open a folder choice validates it, and SHALL become the project's explicit root.

The project SHALL never be left awaiting a start choice. Its first terminal SHALL launch through the normal terminal-launch resolver. The project SHALL go into the named window. Without one, it SHALL go into the window the agent's client shows, or the server's first window when there is no agent's client. When an agent's client exists, that client SHALL show the new project. The result SHALL carry the project handle, the first terminal's handle, and whether the project was shown. A root that fails validation SHALL fail with a typed error and SHALL create nothing. `create_project` SHALL NOT list, browse or suggest directories.

#### Scenario: Project in the home directory

- **WHEN** a workspace-reach caller calls `create_project` with root `~`
- **THEN** the project has no root folder, its first terminal starts in the server account's home directory, and the agent's client shows it

#### Scenario: Project in a folder

- **WHEN** a workspace-reach caller calls `create_project` with root `~/code/api` and no name
- **THEN** the project's root is that folder's canonical path, it is named "api", and its first terminal starts there

#### Scenario: Missing folder

- **WHEN** a workspace-reach caller calls `create_project` with a root that does not exist or is not a directory
- **THEN** the call fails with a typed error and no project or terminal is created

#### Scenario: Relative root

- **WHEN** a workspace-reach caller calls `create_project` with root `code/api`
- **THEN** the call fails as a bad request and nothing is created

### Requirement: Changing, moving and closing projects

The project-changing tools SHALL be:

- `update_project` changes a project's name, icon or colour. With workspace reach, it SHALL also change the project's root, which is validated as `create_project` validates it, and set or clear its default shell profile, which must name an existing durable profile.
- `move_project` moves a project to a position in its own window or in another window.
- `close_project` closes a project through the same server command a user's close uses. When any of the project's terminals has a non-shell foreground process, found by the same fresh observation that project close protection uses, it SHALL fail with `busy` and the number of busy terminals, unless the caller passes `force: true`.

The automation terminal space SHALL NEVER be renamed, edited, moved or closed by these tools.

#### Scenario: Closing an idle project

- **WHEN** a workspace-reach caller calls `close_project` for a project whose terminals are all at their shell prompts
- **THEN** the project closes on every client

#### Scenario: Closing a busy project

- **WHEN** a workspace-reach caller calls `close_project` without `force` for a project with two terminals running programs
- **THEN** the call fails with `busy` and a count of two, and the project stays open

#### Scenario: Moving a project to another window

- **WHEN** a workspace-reach caller calls `move_project` with another window's handle
- **THEN** the project moves there with its panels, live terminals and scrollback, and no close warning is triggered

#### Scenario: Automation space

- **WHEN** a workspace-reach caller calls `close_project` or `update_project` with the automation space's handle
- **THEN** the call fails and the automation space is unchanged

### Requirement: Workspace window tools

The workspace window tools act on the server's logical workspace views, and are distinct from the app window tools:

- `list_workspace_windows` returns each window's opaque handle and name, and its projects' handles in order.
- `open_workspace_window` creates a window, with an optional name and optional project handles to move into it. It SHALL then ask the agent's client to present the window: as a native window on Desktop, or as the shown view in a browser.
- `rename_workspace_window` renames a window.
- `close_workspace_window` deletes a window. It SHALL fail when the window still holds a project, telling the caller to move or close those projects first, and when the window is the server's last one.

A window SHALL be created, renamed or deleted on the server whether or not an agent's client exists. When no agent's client exists, `open_workspace_window` SHALL report `presented: false` with the reason. A client presenting a window that is deleted SHALL close that presentation, or show the server's first remaining window when the presentation is the client's only one. Closing a client window SHALL remain separate from deleting a workspace window.

#### Scenario: Opening a window from a Desktop chat

- **WHEN** a user sends Pixel a message from Desktop and Pixel calls `open_workspace_window` with one project handle
- **THEN** a new native window opens on that Desktop holding that project, and no other client opens a window

#### Scenario: No client to present it

- **WHEN** an automation terminal no client presents calls `open_workspace_window`
- **THEN** the window is created on the server and the result reports `presented: false`

#### Scenario: Closing a window that holds projects

- **WHEN** a workspace-reach caller calls `close_workspace_window` for a window holding one project
- **THEN** the call fails, and the window and project are unchanged

### Requirement: Settings tools

`get_settings` SHALL return the server's settings, as the Settings window shows them. `update_settings` SHALL change one or more server settings, validated exactly as the Settings window validates them, and SHALL apply them to every client as a change made in Settings does. Both SHALL reach only settings the server owns. A device's own presentation settings, such as theme, font and keyboard shortcuts, SHALL NOT be reachable. The following SHALL be excluded from both tools:

- the Terminay MCP settings, including the Enable Terminay MCP switch and every MCP permission policy;
- stored credentials, including connection-profile credentials, the credentials of connected MCP servers, API keys and pairing keys;
- Remote Access settings;
- recording settings;
- shell and shell profile settings, which the shell profile tools manage.

`get_settings` SHALL omit excluded settings entirely. It SHALL NEVER return a stored credential or any part of one. `update_settings` SHALL refuse a request naming an excluded or unknown setting with a bounded error naming the setting, and SHALL apply nothing from that request. An invalid value SHALL be refused in the same way.

#### Scenario: Changing scrollback

- **WHEN** a workspace-reach caller calls `update_settings` setting scrollback to 10000, and the request is permitted
- **THEN** every client's terminals use 10000 lines of scrollback and Settings shows 10000

#### Scenario: Raising its own permissions

- **WHEN** a workspace-reach caller calls `update_settings` naming the Full Automation Management policy or the Enable Terminay MCP switch
- **THEN** the call fails naming that setting and nothing changes

#### Scenario: Reading settings

- **WHEN** a workspace-reach caller calls `get_settings`
- **THEN** the result has no MCP, Remote Access, recording or shell profile settings, and no credential

#### Scenario: One bad key in a batch

- **WHEN** `update_settings` names scrollback and a Remote Access setting together
- **THEN** the call fails naming the Remote Access setting, and scrollback is unchanged

### Requirement: Shell profile tools

The shell profile tools SHALL be:

- `list_shell_profiles` returns the profile catalogue, with environment values redacted as every catalogue response redacts them, and the server's default profile.
- `save_shell_profile` creates or updates a durable profile.
- `delete_shell_profile` deletes a durable profile.
- `reorder_shell_profiles` reorders the durable profiles.
- `set_default_shell_profile` sets the server's default profile.

Every change SHALL be validated and applied exactly as the Shell settings profile editor's change is, including its bounds, its WSL constraints and its handling of referenced-profile deletion. A profile SHALL NEVER carry a secret. `list_shell_profiles` SHALL be available to project reach. The other tools SHALL require workspace reach.

#### Scenario: Agent adds a profile

- **WHEN** a workspace-reach caller saves a profile running `/bin/zsh -l`, and the request is permitted
- **THEN** the profile appears in Settings > Shell on every client and can be chosen for new terminals

#### Scenario: Out-of-bounds profile

- **WHEN** `save_shell_profile` is called with more arguments than the profile bounds allow
- **THEN** the call fails with the editor's validation error and nothing is saved

### Requirement: Macro tools

The macro tools SHALL be:

- `list_macros` returns the server's macros, each with its id, name, category and fields.
- `run_macro` runs one macro against one terminal, with values for its fields.
- `cancel_macro` cancels a macro run.

The target terminal SHALL be one the caller can address. Field values SHALL be validated exactly as the macro launch modal validates them. The run SHALL execute on the server under the bounded macro run rules. A run started through MCP SHALL have no launching client. It SHALL therefore run until it finishes or is cancelled, and no client disconnect SHALL cancel it. `cancel_macro` SHALL cancel only a run whose target terminal the caller can address. These tools SHALL be available to both reaches. Creating, editing and deleting macros SHALL remain outside the MCP surface.

#### Scenario: Running a macro in its own project

- **WHEN** an agent in project "api" calls `run_macro` for a terminal in "api" with valid field values, and the request is permitted
- **THEN** the macro's steps are written into that terminal by the server

#### Scenario: Macro aimed outside the project

- **WHEN** an agent in project "api" calls `run_macro` naming a terminal of project "web"
- **THEN** the call fails as not found and nothing runs
