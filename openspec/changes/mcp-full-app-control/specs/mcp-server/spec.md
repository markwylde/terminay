## ADDED Requirements

### Requirement: Terminal metadata and project moves

`update_terminal` SHALL change one terminal tab's icon, colour, note, and whether its activity is tracked. It SHALL apply them as the tab editor does, and every client SHALL observe the change. Both reaches SHALL be able to use it for any terminal they can address. `move_terminal_to_project` SHALL move one terminal to another project, through the same server-committed move a user's drag uses. The terminal SHALL keep its PTY and scrollback. It SHALL leave its old project's identity behind and take one in the target project, while its MCP handle stays the same. The result SHALL carry that handle. After the move, the terminal SHALL NOT be addressable by any caller whose reach covers the old project but not the target project. It SHALL require workspace reach and SHALL fail with `out_of_scope` for project reach. Neither tool SHALL move a terminal into or out of the automation terminal space.

#### Scenario: Agent notes what a tab is for

- **WHEN** an agent calls `update_terminal` with a note and an icon for a terminal in its project
- **THEN** every client shows that tab with the new icon and note

#### Scenario: Moving a terminal between projects

- **WHEN** a workspace-reach caller calls `move_terminal_to_project` for a running terminal
- **THEN** the terminal appears in the target project with its output intact, the result carries the same handle it had before the move, and a caller in the old project gets `terminal_not_found` for that handle

#### Scenario: Project terminal moves a terminal out

- **WHEN** an agent in a project terminal calls `move_terminal_to_project`
- **THEN** the call fails with `out_of_scope` and nothing moves

## MODIFIED Requirements

### Requirement: Project-scoped MCP terminal control

Terminay SHALL provide a local Model Context Protocol server for Claude Code, Codex, Cursor CLI, Gemini CLI, Grok, and OpenCode processes running inside Terminay terminals. An installed agent in a project terminal SHALL be able to inspect and control terminal tabs in its own project, and to rename, re-icon and recolour that project. It SHALL NOT be able to learn about or control other projects, workspace windows, servers or clients, or the server's settings. A process in a terminal of the automation terminal space SHALL instead hold the workspace scope defined for automation terminals. It SHALL NOT be able to learn about or control other servers, or any client except as the agent's client.

#### Scenario: Agent lists terminals

- **WHEN** an agent launched inside a project terminal lists terminals
- **THEN** it sees only terminal panels belonging to the calling terminal's canonical project

#### Scenario: Agent attempts cross-project control

- **WHEN** an agent in a project terminal attempts to address a terminal in another project or on another server
- **THEN** the request is refused

#### Scenario: Automation terminal lists terminals

- **WHEN** a process in an automation terminal lists terminals
- **THEN** it sees the terminal panels of every project and of the automation terminal space on its own server, and nothing on another server

### Requirement: Workspace scope for automation terminals

Only a terminal in the automation terminal space, which Home shows, SHALL receive a workspace-scope capability. The server SHALL decide that from the terminal's canonical placement alone. A workspace-scope capability SHALL grant every project-scope tool, over the terminal panels of every project and of the automation terminal space on the owning server. It SHALL also grant the app-level tools that need workspace reach: projects, workspace windows, settings, shell profiles, cross-project terminal moves, and Home. With that scope:

- `list_terminals` and `list_projects` SHALL identify each project by an opaque project handle and its display title;
- `open_terminal` SHALL create the terminal in the automation terminal space, unless the caller names a project handle from a listing;
- every other tool SHALL address terminals, projects and windows only by the opaque handles those listings return.

A workspace scope SHALL NEVER grant anything the MCP security boundaries exclude. Every tool it grants SHALL be governed by the MCP permission policy exactly as a project scope's tools are.

#### Scenario: Script opens an agent terminal

- **WHEN** a scheduled script with a workspace-scope capability calls `open_terminal` without a project handle
- **THEN** the terminal is created in the automation terminal space and receives its own workspace-scope capability

#### Scenario: Script opens a terminal in a project

- **WHEN** a workspace-scope caller calls `open_terminal` with a project handle it obtained from `list_terminals`
- **THEN** the terminal is created in that project and receives a project-scope capability

#### Scenario: Home terminal creates a project

- **WHEN** an agent in a terminal the user opened under Home calls `create_project`, and the request is permitted
- **THEN** the project is created, and the agent can open terminals in it by its handle

#### Scenario: Project terminal cannot obtain workspace scope

- **WHEN** a process in a project terminal presents its own token, or copies an automation terminal's environment variables into a new shell inside the project terminal
- **THEN** its own token resolves only to its project, and a copied token remains bound to the automation terminal it was minted for and is revoked when that terminal exits

#### Scenario: Automation run asks to manage automations

- **WHEN** a process in an automation run terminal calls `create_automation` while Full Automation Management is Ask Permission
- **THEN** the run terminal's pane shows the approval prompt and nothing is created until a user allows it

### Requirement: Project-implicit tool surface

Terminay SHALL expose the following project-implicit tools:

- `get_mcp_capabilities` reports the MCP operations available to the caller.
- `list_terminals` lists terminal panels in scope with opaque handles, display names, state, and active status.
- `read_terminal` reads either a bounded lossless raw-output range or a bounded current terminal-presentation snapshot.
- `search_terminal` searches a bounded current text presentation snapshot and returns bounded matching visual-row context.
- `get_terminal_status` returns canonical activity, attention, cwd, and last-exit information.
- `write_terminal` writes exact validated text to one live terminal.
- `run_command` writes one command and submits it once as a paste followed by Enter, framed with bracketed paste only when the foreground program has enabled it.
- `open_terminal` creates one terminal in the same project. It takes an optional display name, an optional policy-valid cwd, and an optional shell profile id from `list_shell_profiles`. The terminal can optionally be placed beside a tab and optionally brought to the front on the agent's client.
- `close_terminal` closes one terminal through normal terminal lifecycle rules.
- `focus_terminal` shows one terminal's project, folder, and tab on the agent's client.
- `rename_terminal` changes one terminal's display title.
- `update_terminal` changes one terminal tab's icon, colour, note, and activity tracking.
- `split_terminal` creates exactly one new terminal beside a target terminal on the agent's client.
- `wait_for_idle` waits for bounded canonical terminal inactivity.
- `wait_for_command` waits for the next structured command completion and returns bounded exit information.
- `wait_for_attention` waits for the next canonical needs-attention signal.
- The view and folder tools of the MCP workspace view.

A shell profile given to `open_terminal` SHALL be resolved as the New Terminal action resolves a chosen profile, and an unknown or unavailable profile SHALL fail without creating a terminal. A tool SHALL report a view change only when the agent's client has applied it, and its result SHALL carry that client's layout afterwards.

#### Scenario: Listing terminals

- **WHEN** an agent calls `list_terminals`
- **THEN** it receives opaque handles, display names, state, and active status for terminal panels in scope

#### Scenario: Focusing a terminal

- **WHEN** an agent calls `focus_terminal`
- **THEN** the agent's client shows that terminal's project, folder, and tab in front, and no other client's view changes

#### Scenario: Splitting a terminal

- **WHEN** an agent calls `split_terminal` with `direction: "right"`
- **THEN** exactly one new terminal is created, the agent's client shows it in a new pane to the right of the target, and the result carries the new terminal's handle and the resulting layout

#### Scenario: Opening without taking focus

- **WHEN** an agent calls `open_terminal` without `focus`
- **THEN** the terminal is created and the tab in front on the agent's client is unchanged

#### Scenario: Opening and focusing

- **WHEN** an agent calls `open_terminal` with `focus: true`
- **THEN** the agent's client shows the new terminal in front, including when it is in another project or the automation space

#### Scenario: Opening with a shell profile

- **WHEN** an agent calls `open_terminal` with the id of a durable bash profile
- **THEN** the terminal launches with that profile

#### Scenario: Unknown shell profile

- **WHEN** an agent calls `open_terminal` with a profile id that does not exist
- **THEN** the call fails and no terminal is created

#### Scenario: Placement without a client

- **WHEN** an agent calls `split_terminal` and no agent's client is reachable
- **THEN** the terminal is still created, and the result reports `placed: false` with the reason instead of a layout

#### Scenario: Running a multiline command

- **WHEN** an agent calls `run_command` with multiline input and the foreground program has enabled bracketed paste
- **THEN** the command is written once using bracketed paste and submitted once

#### Scenario: Running a command where bracketed paste is off

- **WHEN** an agent calls `run_command` and the foreground program has not enabled bracketed paste
- **THEN** the command is written without bracketed-paste markers, each line break is sent as a carriage return, and the command is submitted with a final carriage return

#### Scenario: Leading assignment in a shell without bracketed paste

- **WHEN** an agent calls `run_command` with `X=1 sh -c 'echo $X'` in a shell that has not enabled bracketed paste
- **THEN** the shell reads the assignment as an assignment and prints `1`

### Requirement: MCP security and privacy boundaries

Terminay's own MCP tools SHALL expose only the following:

- terminal control;
- the agent's own client's view of projects in scope;
- automation management, macros and notifications;
- the calling terminal's app windows;
- for a workspace-reach caller, the app-level control the MCP app control capability defines.

The following SHALL remain outside Terminay's own tool surface, for every caller:

- filesystem create, rename, delete and edit, and root-folder browsing;
- Git and worktree actions;
- the MCP permission policies and the Enable Terminay MCP switch;
- stored credentials;
- recordings and recording settings;
- extension administration, device pairing, server upgrade and Remote Access;
- arbitrary native-window management.

No tool SHALL let a caller change what it, or any other caller, is permitted to do.

`open_file` SHALL only open a viewer tab for a path inside the project root and SHALL NEVER return file content to the agent. The single file read in that surface is the stdio adapter reading the document an agent names for `show_window`. That read is performed by the adapter and never by the Terminay Server. Its contents are shown to the user in a window, and SHALL NEVER be returned to the agent. The surface MAY additionally carry the tools of MCP servers the user has connected in Settings. Such a tool SHALL be named with its entry's prefix, SHALL be run by that server and never by Terminay, and SHALL NOT gain any Terminay authority.

Every request SHALL revalidate its capability against canonical terminal, project and window state, and SHALL be evaluated against the MCP permission policy before it is dispatched. Output, parameters, errors, candidate lists, and waits SHALL be bounded to resist memory and context exhaustion. The server SHALL NOT infer authority from current UI focus or renderer ownership. The agent's client only decides where a permitted view change is applied. Installing the MCP entry SHALL NOT enable provider hooks or disclose provider journals. Journal records used for agent status SHALL never be routed through MCP, and MCP calls SHALL never synthesize agent-status lifecycle events.

#### Scenario: Filesystem tool requested

- **WHEN** any agent, including a workspace-reach one, seeks file editing, Git, MCP permission, stored credential, recording, extension, pairing, upgrade, or Remote Access control through Terminay's own tools
- **THEN** no such Terminay tool exists in the surface, and no settings tool reaches it

#### Scenario: Agent names a file it wants to read

- **WHEN** an agent calls `show_window` with `html_file` naming a file that is not an HTML document, such as a private key
- **THEN** the file's text is shown to the user in a window, and neither the tool result nor any later tool result carries it to the agent

#### Scenario: Agent opens a file tab

- **WHEN** an agent calls `open_file` for a file in the project
- **THEN** the user sees the file in a viewer tab and the agent receives only the tab id and layout

#### Scenario: Connected server offers a file tool

- **WHEN** a server the user connected offers a tool that reads files
- **THEN** it is listed under that entry's prefix, runs in that server, and holds no Terminay capability

#### Scenario: Authority from UI focus

- **WHEN** a request would be satisfied only by current UI focus or renderer ownership
- **THEN** the server does not infer authority from it

#### Scenario: Agent status via MCP

- **WHEN** MCP calls execute
- **THEN** no journal record is routed through MCP and no agent-status lifecycle event is synthesized

#### Scenario: Automation management requires permission

- **WHEN** an agent calls an automation-management tool
- **THEN** the server evaluates the MCP permission policy for it before any automation changes

### Requirement: MCP non-goals

MCP SHALL NOT provide:

- provider hooks of any kind, agent lifecycle detection, Agents sidebar population, or terminal agent-status inference;
- cross-project control for a project-reach caller, or cross-server control for any caller;
- a public or remotely discoverable network MCP endpoint;
- any tool in the excluded set the MCP security boundaries name.

It SHALL NOT read or modify an agent CLI's own MCP server configuration beyond Terminay's own registration entry. It SHALL NOT establish trust based on terminal title, process name, cwd, active UI focus, or renderer state.

#### Scenario: Remote discovery attempted

- **WHEN** a remote party attempts to discover or reach the MCP endpoint over a network
- **THEN** no publicly discoverable network MCP endpoint exists

#### Scenario: Trust from terminal title

- **WHEN** a request presents a matching terminal title, process name, or cwd instead of a valid capability
- **THEN** no trust is established

#### Scenario: Agent's other MCP servers

- **WHEN** an agent CLI has other MCP servers configured
- **THEN** Terminay does not read, list, or change them

### Requirement: Capability reporting

`get_mcp_capabilities` SHALL always be available after capability validation. It SHALL return an adapter-global list of tool names. Each tool SHALL carry an `available` boolean and its effective permission as `allow`, `ask`, or `deny`. `available` SHALL account for the bound host, the calling principal, and the caller's reach. A tool that needs workspace reach SHALL be reported unavailable to a project-reach caller. The effective permission SHALL reflect the tool's group policy and any session grant the calling capability holds. Availability SHALL NOT be a property of an individual terminal row.

A tool unavailable for the bound host or the calling principal MAY remain in the MCP registration for a stable client surface. A caller SHALL be able to discover it through this result, and calls to it SHALL return `unsupported_op` without side effects. A call to a tool unavailable for the caller's reach SHALL return `out_of_scope` without side effects. A tool whose permission is `deny` SHALL remain in the registration and SHALL return `permission_denied` without side effects.

#### Scenario: Optional tool unavailable

- **WHEN** an optional tool is unavailable for the bound host
- **THEN** `get_mcp_capabilities` reports it unavailable and calling it returns `unsupported_op` with no side effects

#### Scenario: Permissions reported

- **WHEN** Full Automation Management is Ask Permission and the calling terminal holds no session grant
- **THEN** `get_mcp_capabilities` reports `create_automation` as available with permission `ask`

#### Scenario: Session grant reported

- **WHEN** the calling terminal holds a session grant for Full Automation Management
- **THEN** `get_mcp_capabilities` reports `create_automation` with permission `allow`

#### Scenario: Window tools reported to a chat

- **WHEN** a chat's agent calls `get_mcp_capabilities`
- **THEN** `show_window`, `close_window` and `list_windows` are reported unavailable

#### Scenario: Reach-filtered report

- **WHEN** an agent in a project terminal calls `get_mcp_capabilities`
- **THEN** `create_project`, `update_settings` and `open_workspace_window` are reported unavailable, and `update_project` and `list_projects` are reported available

### Requirement: Automation management tools

Terminay SHALL expose these automation tools:

- `list_automations` lists the owning server's automations, each with its id, name, enabled state, trigger, action kind, next scheduled run where there is one, and last run outcome.
- `get_automation` returns one automation's full definition.
- `list_automation_runs` returns a bounded page of one automation's run log.
- `create_automation` creates an automation.
- `update_automation` replaces one automation's name, trigger, action, or settings, and requires the revision the caller last read.
- `delete_automation` deletes one automation without stopping runs already in progress.
- `set_automation_enabled` enables or disables one automation.
- `run_automation` starts one run now.
- `stop_automation_run` stops one run in progress.
- `remove_automation_run` deletes one finished run from an automation's run log.
- `prune_automation_runs` removes an automation's finished runs that started more than a given number of whole days ago.
- `dismiss_missed_runs` clears the missed-schedule notice for one automation, or for all automations.

Automations are server-wide, so these tools SHALL address every automation on the owning server from both project-scope and workspace-scope capabilities. They SHALL NEVER address another server's automations. Definitions SHALL be validated exactly as automations saved from the Automations section are. Removing, pruning and dismissing SHALL follow the same rules as the Automations section: a run in progress is never removed, and dismissing runs nothing. They SHALL be audited with the MCP principal as the actor. `run_automation` for a subject-terminal action SHALL require a subject terminal handle that the caller could address with its own scope. A project-scope caller SHALL NEVER see the subject terminal, subject project, or output tail of a run whose subject lies outside its project; those fields SHALL be withheld from its results. Every automation tool SHALL be governed by the MCP permission policy.

#### Scenario: Agent schedules a script

- **WHEN** an agent in a project terminal calls `create_automation` with a daily 09:00 schedule that runs `~/bin/report.sh`, and the request is permitted
- **THEN** the automation is created on the owning server, appears in every client's Automations section, and the tool returns its id

#### Scenario: Stale update

- **WHEN** an agent calls `update_automation` with a revision older than the automation's current one
- **THEN** the update fails with a conflict and the automation is unchanged

#### Scenario: Run log from another project

- **WHEN** a project-scope caller lists the runs of an automation triggered by an agent finishing in a different project
- **THEN** the run outcomes and times are returned without the subject terminal, subject project, or output tail

#### Scenario: Subject terminal outside scope

- **WHEN** a project-scope caller calls `run_automation` for a write-text automation naming a terminal handle outside its project
- **THEN** the request is refused and nothing runs

#### Scenario: Pruning keeps a run in progress

- **WHEN** an agent calls `prune_automation_runs` with zero days while one run is in progress
- **THEN** every finished run is removed and the run in progress remains

### Requirement: Notification tools

Terminay SHALL expose three notification tools:

- `send_notification` SHALL take a body of at most 280 characters and an optional title of at most 80 characters, add a notification to the calling terminal, and return its opaque handle. Given the handle of a notification the calling terminal sent, it SHALL replace that notification's title and body in place and add no second notification.
- `list_notifications` SHALL return the published notifications of terminals the caller can address, each with an opaque handle, its kind, its title and body, and its terminal's handle. The result SHALL be bounded.
- `dismiss_notification` SHALL remove one notification by handle. The handle is one the calling terminal received from `send_notification`, or one `list_notifications` returned to the caller.

Dismissing a notification that came from terminal activity SHALL acknowledge its terminal exactly as a user's dismissal from the Notifications list does. Dismissing a sent notification SHALL remove it for every client. A handle SHALL resolve only for a notification of a terminal the caller can address. A workspace-reach caller can therefore dismiss any notification on its server, and a project-reach caller only those of its own project.

`send_notification` SHALL need a calling terminal. `list_notifications` and `dismiss_notification` SHALL NOT need one. All three SHALL be operations of the local control endpoint, dispatched with the resolved scope of the capability that called, so that any process holding that capability can call them and the stdio adapter only presents them as tools. The owning terminal of a sent notification SHALL be resolved from the capability and SHALL NOT be a parameter. The tools' descriptions SHALL tell the agent the following:

- a sent notification is shown to the user only if it is still present after a short settle period;
- a sent notification is removed when the user interacts with the terminal, including within that period.

#### Scenario: Sending a notification

- **WHEN** an agent calls `send_notification` with the title `Review ready` and the body `Three files changed`
- **THEN** a notification with that text is added to the calling terminal and the call returns its handle

#### Scenario: Updating a notification

- **WHEN** an agent calls `send_notification` with the handle of a notification it sent and a new body
- **THEN** the same notification carries the new body and no second notification is added

#### Scenario: Dismissing a notification

- **WHEN** an agent calls `dismiss_notification` with the handle of a notification it sent
- **THEN** that notification is removed for every client

#### Scenario: Sent and dismissed quickly

- **WHEN** an agent calls `send_notification` and then `dismiss_notification` with its handle two seconds later
- **THEN** no client is ever shown that notification

#### Scenario: Pixel clears an agent-finished notification

- **WHEN** Pixel lists notifications and dismisses an agent-finished notification of a terminal in project "web"
- **THEN** that terminal is acknowledged on every client and its tab dot clears

#### Scenario: Handle from another terminal

- **WHEN** an agent in project "api" calls `dismiss_notification` with a handle of a notification belonging to a terminal in project "web"
- **THEN** the call fails as not found and no notification is removed

#### Scenario: A terminal's activity notification

- **WHEN** an agent calls `dismiss_notification` with the handle `list_notifications` gave it for its own terminal's agent-finished notification
- **THEN** that terminal is acknowledged and the notification is removed for every client

#### Scenario: Called over the socket without an MCP client

- **WHEN** a process in a terminal sends the send-notification operation to the control endpoint with that terminal's capability
- **THEN** a notification is added to that terminal exactly as the tool adds one

#### Scenario: Body too long

- **WHEN** an agent calls `send_notification` with a body over 280 characters
- **THEN** the call fails with a bounded error and no notification is added
