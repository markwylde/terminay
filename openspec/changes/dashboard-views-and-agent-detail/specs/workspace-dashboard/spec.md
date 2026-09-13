## MODIFIED Requirements

### Requirement: Dashboard row model

The dashboard SHALL present every project of every attached connection, in the window's tab order, carrying the project's colour, emoji, name, and a roll-up of its panels' statuses, together with every panel in that project, in panel order, carrying the panel's status, kind, title, and — for a terminal under agent authority — its agent state. Every project and every panel SHALL be keyed by the pair of its server and its own identity, and when more than one connection is attached each project SHALL name the server that owns it. A project with no panels SHALL still be presented. A connection that is unavailable or incompatible SHALL still contribute its projects, showing that connection's state in place of a panel roll-up. The dashboard SHALL show every project and every panel, including idle ones, and SHALL NEVER omit a project because nothing is happening in it.

#### Scenario: Projects and panels listed

- **WHEN** the dashboard renders
- **THEN** every project appears in project order with its panels in panel order

#### Scenario: Quiet workspace

- **WHEN** no project has any notable activity
- **THEN** every project and panel still appears, each showing an idle status

#### Scenario: Empty project

- **WHEN** a project holds no panels
- **THEN** it is still presented

#### Scenario: Projects from two attached servers

- **WHEN** two connections are attached and each owns projects
- **THEN** the dashboard lists the projects of both, each naming its own server, and no two servers' projects are merged

#### Scenario: Unavailable connection

- **WHEN** an attached connection is offline, reconnecting, or incompatible
- **THEN** its projects still appear and show that connection's state instead of a panel roll-up

### Requirement: Rows are single unwrapped lines

In the List view every row SHALL occupy exactly one line. Row text SHALL NEVER wrap, and content that does not fit the available width SHALL be truncated with a visible truncation indicator while the status affordance, project colour, and emoji stay visible. Narrowing the window SHALL truncate row text rather than reflow, re-order, or hide rows. The card views SHALL likewise truncate rather than wrap any single field, and SHALL NEVER hide a card because the window is narrow.

#### Scenario: Long title

- **WHEN** a panel title is wider than the available row width in the List view
- **THEN** the title is truncated with a visible truncation indicator and the row stays one line

#### Scenario: Narrow window

- **WHEN** the window is narrowed while the List view is shown
- **THEN** rows truncate their text and no row wraps, reorders, or disappears

#### Scenario: Narrow window in a card view

- **WHEN** the window is narrowed while a card view is shown
- **THEN** cards reflow into fewer columns, every field truncates rather than wrapping, and no card is hidden

### Requirement: Row activation

Activating a project SHALL select that project and leave Home. Activating a panel SHALL select that panel's project, leave Home, and focus that panel. Activating an agent SHALL activate the panel that agent was started in. Activation SHALL behave identically in every view mode, and rows and cards SHALL carry no other action in the dashboard: they SHALL NOT close, rename, reorder, or create anything. Activating a project, panel, or agent that no longer exists SHALL leave the dashboard selected and refresh the view rather than failing.

#### Scenario: Activating a project row

- **WHEN** a user activates a project header row or a project card
- **THEN** that project becomes the selected view and Home is deselected

#### Scenario: Activating a panel row

- **WHEN** a user activates a panel row or a panel card
- **THEN** that panel's project becomes the selected view and that panel is focused

#### Scenario: Activating an agent

- **WHEN** a user activates an agent card
- **THEN** the project and panel that agent was started in are selected and focused

#### Scenario: Stale row

- **WHEN** a user activates a row or card whose project or panel has since been removed
- **THEN** the dashboard stays selected and refreshes its contents

## ADDED Requirements

### Requirement: Dashboard view modes

The dashboard SHALL offer exactly three view modes over one model — List, Board, and Projects — selectable from a control in the dashboard header that names the current mode and is reachable by keyboard. Every mode SHALL present the same facts, differing only in arrangement: a status, count, or name SHALL NEVER read one way in one mode and another way in another.

- **List** SHALL present every project as a header row followed by its panels, one unwrapped line each.
- **Board** SHALL present one column per canonical status group — Needs you, Working, Done, and Idle — each holding one card per agent, or per panel where no agent owns it, named with the project it belongs to. Board is a triage view and MAY omit a project that has nothing in a column.
- **Projects** SHALL present one card per project holding that project's panels and agents.

The selected mode SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the dashboard SHALL show the List view and SHALL report no error.

#### Scenario: Switching mode

- **WHEN** a user selects a different view mode
- **THEN** the dashboard re-arranges into that mode over the same projects, panels, and agents

#### Scenario: Mode is remembered

- **WHEN** a device that last used the Board view reopens the dashboard
- **THEN** the Board view is shown

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the dashboard shows the List view and reports no error

#### Scenario: Two devices, different modes

- **WHEN** one device selects the Board view while another shows the List view of the same workspace
- **THEN** each device keeps its own mode and neither changes the other

#### Scenario: Board column with nothing in it

- **WHEN** no agent or panel in the workspace is in a status group
- **THEN** that Board column is shown as empty rather than removed, and no project is claimed to be missing

### Requirement: Dashboard agent detail

A terminal under agent authority SHALL carry, on every view mode, the detail its project's agent sidebar carries for the same agent: the agent's resolved display name, its provider and model, the prompt it is working on, its canonical state, whether its result is unread, and how many subagents it has. That detail SHALL be resolved by the same rules the agent sidebar resolves it by, so one agent SHALL NEVER be named one thing in a project and another thing on the dashboard. A subagent SHALL NEVER be presented as a top-level agent; it SHALL be counted on, and reachable through, its root agent.

The dashboard SHALL read the agent projection of every attached connection, not only the one being worked in. For a connection whose panels this window does not hold, its agents SHALL still be presented under the project its workspace projection assigns them, identified as agents without a panel.

#### Scenario: Agent-owned terminal

- **WHEN** a terminal is under agent authority
- **THEN** the dashboard shows that agent's name, provider, model, prompt, state, unread flag, and subagent count

#### Scenario: Same agent, two surfaces

- **WHEN** the same agent is shown in its project's agent sidebar and on the dashboard
- **THEN** both present the same resolved name and the same state

#### Scenario: Subagents

- **WHEN** a root agent has running subagents
- **THEN** the root is presented once carrying its subagent count and no subagent is presented as a top-level agent

#### Scenario: Agent on another attached server

- **WHEN** an attached connection this window is not working in reports a running agent
- **THEN** that agent appears on the dashboard under its own server's project

#### Scenario: Panel with no agent

- **WHEN** a terminal, file, or folder panel is under no agent authority
- **THEN** it is presented with its own title and status and no agent detail

### Requirement: Dashboard summary and filter

The dashboard SHALL present a summary of the whole workspace — the number of panels and agents needing a person, working, done, and idle — computed over every attached connection, with each contribution still belonging to exactly one server. The dashboard SHALL also offer a filter input that narrows every view mode to the projects, panels, and agents whose project name, panel title, agent name, provider, model, or prompt text matches the entered text, case-insensitively. A project SHALL be kept when it matches or when anything it holds matches. While a filter is active the dashboard SHALL say so and SHALL offer to clear it, so an empty result is never mistaken for an empty workspace. The filter SHALL be transient: it SHALL NOT be remembered across reconnects and SHALL NOT be written to server-owned workspace state.

#### Scenario: Summary counts

- **WHEN** the dashboard renders
- **THEN** it states how many panels and agents need a person, are working, are done, and are idle across every attached connection

#### Scenario: Filtering

- **WHEN** a user enters filter text
- **THEN** every view mode shows only the projects, panels, and agents matching it by name, title, provider, model, or prompt

#### Scenario: Filter matches nothing

- **WHEN** the filter text matches nothing
- **THEN** the dashboard says the filter is active, offers to clear it, and does not present the workspace as empty

#### Scenario: Filter is not remembered

- **WHEN** a device with an active filter reopens the dashboard
- **THEN** no filter is applied
