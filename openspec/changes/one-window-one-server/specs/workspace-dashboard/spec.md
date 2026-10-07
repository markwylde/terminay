## MODIFIED Requirements

### Requirement: Home overview section

The Home section SHALL present a set of overview widgets derived from the same workspace inventory, agent state, connection state, and automation state that the rest of the workspace uses, so that no count ever reads differently here than elsewhere. It SHALL present: the number of open projects; the number of open tabs, with how many are terminals; agents counted by canonical state group (Needs you, Working, Done, Idle); remote connections and connected devices; active automations with the next scheduled run; and the most recent automation runs with their outcome. Each count SHALL cover the window's server and no other, and no widget SHALL name a server. While the window's server is unavailable, its counts SHALL be shown as unavailable rather than as zero. Widgets SHALL update live while shown.

Activating a widget SHALL take the user to the place that holds its detail: the project and agent widgets SHALL open the Tabs section, an automation SHALL open that automation's tab, a run SHALL open that run's tab, and the offer to create an automation SHALL open a new automation tab. Each SHALL bring an already open tab to the front rather than opening a second.

#### Scenario: Counts reflect the workspace

- **WHEN** a workspace holds three projects, seven tabs of which five are terminals, and two agents that need the user
- **THEN** the overview shows three projects, seven tabs with five terminals, and two agents in Needs you

#### Scenario: Live update

- **WHEN** an agent moves from Working to Done while the Home section is shown
- **THEN** the agent counts update without the user leaving the section

#### Scenario: Unavailable connection

- **WHEN** the window's server is offline
- **THEN** the counts are shown as unavailable rather than zero

#### Scenario: Activating an automation run

- **WHEN** a user activates a run in the recent-runs widget
- **THEN** that run's tab opens in front, and the Home section's tab stays open behind it

#### Scenario: Empty workspace

- **WHEN** the workspace holds one empty project and no automations
- **THEN** the overview shows one project, zero tabs, zero agents, and an empty automations widget that offers to create an automation

#### Scenario: Another server's activity is not counted

- **WHEN** one window shows a server with two agents that need the user and another window shows a server with none
- **THEN** the second window's overview shows zero agents in Needs you

### Requirement: Dashboard summary and filter

The dashboard SHALL present a summary of the whole workspace of the window's server — the number of panels and agents needing a person, working, done, and idle — and SHALL count nothing that belongs to another server. The dashboard SHALL also offer a filter input that narrows every view mode to the projects, panels, and agents whose project name, panel title, agent name, provider, model, or prompt text matches the entered text, case-insensitively. A project SHALL be kept when it matches or when anything it holds matches. While a filter is active the dashboard SHALL say so and SHALL offer to clear it, so an empty result is never mistaken for an empty workspace. The filter SHALL be transient: it SHALL NOT be remembered across reconnects and SHALL NOT be written to server-owned workspace state.

#### Scenario: Summary counts

- **WHEN** the dashboard renders
- **THEN** it states how many panels and agents on the window's server need a person, are working, are done, and are idle

#### Scenario: Filtering

- **WHEN** a user enters filter text
- **THEN** every view mode shows only the projects, panels, and agents matching it by name, title, provider, model, or prompt

#### Scenario: Filter matches nothing

- **WHEN** the filter text matches nothing
- **THEN** the dashboard says the filter is active, offers to clear it, and does not present the workspace as empty

#### Scenario: Filter is not remembered

- **WHEN** a device with an active filter reopens the dashboard
- **THEN** no filter is applied

### Requirement: Board grouping by project

While the Board view is selected the dashboard SHALL offer a "Group by project" control in the dashboard header, reachable by keyboard and stating whether grouping is on. The control SHALL NOT be offered in the List or Projects view. With grouping on, the Board SHALL keep its four status columns in the same order as the ungrouped Board — Idle, Working, Needs you, and Done — and SHALL band them into one lane per project, in the window's tab order, each lane naming its project and no server. A lane SHALL hold exactly the cards the ungrouped Board presents for that project, each under the column the ungrouped Board places it in: grouping SHALL NEVER add, remove, or re-classify a card. Two projects SHALL NEVER share a lane. A project with nothing in any column MAY be given no lane. Activating a lane's heading SHALL activate that project.

Whether the Board is grouped SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the Board SHALL be ungrouped and SHALL report no error.

#### Scenario: Grouping the Board
- **WHEN** a user on the Board view turns on "Group by project" in a workspace with agents in two projects
- **THEN** the Board shows one lane per project, each holding that project's cards under the Idle, Working, Needs you, and Done columns, in that order

#### Scenario: Grouping changes no card
- **WHEN** the Board is switched between grouped and ungrouped
- **THEN** the same cards are presented in both, each under the same status column, and the columns keep the same order

#### Scenario: Control is absent off the Board
- **WHEN** the List or Projects view is selected
- **THEN** no "Group by project" control is offered

#### Scenario: Activating a lane heading
- **WHEN** a user activates a lane's project heading
- **THEN** that project is selected and Home is left

#### Scenario: Grouping is remembered on this device
- **WHEN** a device that last grouped the Board reopens the dashboard on the Board view
- **THEN** the Board is grouped by project

#### Scenario: Unreadable grouping preference
- **WHEN** the remembered grouping cannot be read
- **THEN** the Board is ungrouped and no error is reported

### Requirement: Home tab arrangement is per-device and remembered

The Home tabs open on a device, their order, their arrangement, and which is in front SHALL be per-device presentation state and SHALL NEVER be written to server-owned workspace state. A device SHALL remember them and SHALL restore them when the workspace is next opened. That memory SHALL be a hint: a remembered tab whose automation, run, or terminal does not exist on the window's server SHALL be left out; unsaved edits SHALL NOT be remembered, so a remembered new automation tab is left out and a remembered editor reopens showing the saved automation; and when the memory cannot be read, or device storage is unavailable, Home SHALL open with the Home section's tab alone and SHALL report no error. A device with nothing remembered SHALL open Home with the Home section's tab alone.

#### Scenario: Restored on relaunch

- **WHEN** a device that had the Tabs tab and an automation's tab open side by side is relaunched
- **THEN** both tabs are open side by side again

#### Scenario: Two devices

- **WHEN** one device opens an automation's tab in Home
- **THEN** no other device's Home tabs change

#### Scenario: Remembered tab no longer exists

- **WHEN** a device remembers a tab for an automation that was deleted while the device was closed
- **THEN** that tab is left out, the remaining tabs are restored, and no error is reported

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** Home opens with the Home section's tab alone and no error is reported

## ADDED Requirements

### Requirement: Dashboard rows

The dashboard SHALL present every project of the window's server, in the window's tab order, carrying the project's colour, emoji, name, and a roll-up of its panels' statuses, together with every panel in that project, in panel order, carrying the panel's status, kind, title, and — for a terminal under agent authority — its agent state. Every project and every panel SHALL be keyed by its own identity, and no row SHALL name a server. The dashboard SHALL present no project and no panel of any other server. A project with no panels SHALL still be presented. While the window's server is unavailable or incompatible, the dashboard SHALL show that connection state in place of a panel roll-up. The dashboard SHALL show every project and every panel, including idle ones, and SHALL NEVER omit a project because nothing is happening in it.

#### Scenario: Projects and panels listed

- **WHEN** the dashboard renders
- **THEN** every project appears in project order with its panels in panel order

#### Scenario: Quiet workspace

- **WHEN** no project has any notable activity
- **THEN** every project and panel still appears, each showing an idle status

#### Scenario: Empty project

- **WHEN** a project holds no panels
- **THEN** it is still presented

#### Scenario: Projects on a server shown in another window

- **WHEN** two windows show different servers and each server owns projects
- **THEN** each window's dashboard lists only its own server's projects, and no row names a server

#### Scenario: Unavailable connection

- **WHEN** the window's server is offline, reconnecting, or incompatible
- **THEN** the dashboard shows that connection's state instead of a panel roll-up

### Requirement: Agent detail on the dashboard

A terminal under agent authority SHALL carry, on every view mode, the detail its project's agent sidebar carries for the same agent: the agent's resolved display name, its provider and model, the prompt it is working on, its canonical state, whether its result is unread, and how many subagents it has. That detail SHALL be resolved by the same rules the agent sidebar resolves it by, so one agent SHALL NEVER be named one thing in a project and another thing on the dashboard. A subagent SHALL NEVER be presented as a top-level agent; it SHALL be counted on, and reachable through, its root agent.

The dashboard SHALL read the agent projection of the window's server and of no other server. One server's agent projection SHALL NEVER be merged with another's.

#### Scenario: Agent-owned terminal

- **WHEN** a terminal is under agent authority
- **THEN** the dashboard shows that agent's name, provider, model, prompt, state, unread flag, and subagent count

#### Scenario: Same agent, two surfaces

- **WHEN** the same agent is shown in its project's agent sidebar and on the dashboard
- **THEN** both present the same resolved name and the same state

#### Scenario: Subagents

- **WHEN** a root agent has running subagents
- **THEN** the root is presented once carrying its subagent count and no subagent is presented as a top-level agent

#### Scenario: Agent on a server shown in another window

- **WHEN** a server shown in another window reports a running agent
- **THEN** that agent appears on that window's dashboard and not on this one

#### Scenario: Panel with no agent

- **WHEN** a terminal, file, or folder panel is under no agent authority
- **THEN** it is presented with its own title and status and no agent detail

## REMOVED Requirements

### Requirement: Dashboard row model

**Reason**: Its rows and one of its scenarios list and name several servers held by one window, and a window shows one server.

**Migration**: Restated for one server per window as "Dashboard rows".

### Requirement: Dashboard agent detail

**Reason**: Its agent projection and one of its scenarios span several servers held by one window, and a window shows one server.

**Migration**: Restated for one server per window as "Agent detail on the dashboard".
