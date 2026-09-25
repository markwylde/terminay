## MODIFIED Requirements

### Requirement: Home control presentation

The Home control SHALL be an icon-only control on the project bar, and in the compact chrome row, showing a house glyph and distinguished from project tabs so that it never reads as a project. It SHALL show a selected state while Home is the selected view, SHALL be reachable by keyboard, and SHALL carry an accessible name naming Home. While Home is selected, the chrome band SHALL use a neutral Home colour rather than any project's colour. On the project bar, the selected Home control SHALL be drawn as a tab that opens into Home's band in that colour, as the active project tab opens into its project's tab strip.

#### Scenario: Selected state

- **WHEN** Home is the selected view
- **THEN** the Home control shows its selected state, no project tab shows an active state, and the chrome band uses the neutral Home colour

#### Scenario: Selected Home control opens into the band

- **WHEN** Home is selected on the project bar
- **THEN** the Home control is drawn as a tab joined to Home's band, both in the neutral Home colour

#### Scenario: House glyph

- **WHEN** the project bar or the compact chrome row renders the Home control
- **THEN** the control shows a house glyph

#### Scenario: Accessible name

- **WHEN** assistive technology reads the Home control
- **THEN** it announces a name identifying Home

## ADDED Requirements

### Requirement: Home sidebar sections

While Home is selected the workspace SHALL offer a Home sidebar that works as a menu of exactly three sections, in this order: **Home**, **Tabs**, and **Automations**. Exactly one section SHALL be selected at a time, and the selected section SHALL fill the Home content area. The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. The sidebar items SHALL be reachable by keyboard and SHALL expose the selected section to assistive technology.

The selected section SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the Home section SHALL be selected and no error SHALL be reported.

#### Scenario: Choosing a section

- **WHEN** a user activates Tabs in the Home sidebar
- **THEN** the Tabs section fills the Home content area and Tabs is shown as selected

#### Scenario: Section remembered

- **WHEN** a device that last showed the Automations section selects Home again, or reconnects with Home selected
- **THEN** the Automations section is shown

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the Home section is selected and no error is reported

#### Scenario: Sidebars do not mix

- **WHEN** a user moves between Home and a project
- **THEN** Home shows only its three sections and the project shows only its own sidebar panes

### Requirement: Home sidebar visibility

The project bar's sidebar toggle, its keyboard shortcut, and its command SHALL remain available while Home is selected, and SHALL show and hide the Home sidebar. Home sidebar visibility SHALL be device presentation state, kept apart from every project's sidebar visibility: toggling one SHALL NEVER change the other. A device that has no stored Home sidebar visibility SHALL show the Home sidebar open. After that, the device SHALL remember the visibility the user last chose. Below the narrow layout breakpoint, the Home sidebar SHALL follow the same navigation-drawer presentation and dismissal routes as a project sidebar.

#### Scenario: First visit to Home on a device

- **WHEN** a device with no stored Home sidebar visibility selects Home
- **THEN** the Home sidebar is shown open

#### Scenario: Hiding the Home sidebar

- **WHEN** a user hides the Home sidebar, leaves Home, and later selects Home again
- **THEN** the Home sidebar is hidden, and the selected section's content fills the area

#### Scenario: Independent from project sidebars

- **WHEN** a user toggles the sidebar while Home is selected
- **THEN** no project's sidebar visibility changes, and toggling a project's sidebar does not change the Home sidebar

#### Scenario: Narrow layout

- **WHEN** the Home sidebar is visible below the narrow layout breakpoint
- **THEN** it is presented as a navigation drawer over the content and closes on the navigation control, Escape, or activating the region behind it

### Requirement: Tabs section is the workspace dashboard

The Tabs section SHALL present the workspace dashboard — its rows, view modes, and activation behaviour — exactly as the dashboard requirements define them. Activating a project or panel from the Tabs section SHALL leave Home as those requirements define.

#### Scenario: Tabs shows the dashboard

- **WHEN** a user selects the Tabs section
- **THEN** every project and panel is shown in the dashboard's remembered view mode

#### Scenario: Activating a row from Tabs

- **WHEN** a user activates a panel row in the Tabs section
- **THEN** that panel's project is selected, Home is left, and the panel is focused

### Requirement: Home overview section

The Home section SHALL present a set of overview widgets derived from the same workspace inventory, agent state, connection state, and automation state that the rest of the workspace uses, so that no count ever reads differently here than elsewhere. It SHALL present: the number of open projects; the number of open tabs, with how many are terminals; agents counted by canonical state group (Needs you, Working, Done, Idle); remote connections and connected devices; active automations with the next scheduled run; and the most recent automation runs with their outcome. With more than one connection attached, each count SHALL cover every attached connection, and every automation widget SHALL name the server that owns each automation it lists. A connection that is unavailable SHALL be shown as unavailable rather than counted as zero. Widgets SHALL update live while shown.

Activating a widget SHALL take the user to the place that holds its detail: the project and agent widgets to the Tabs section, and the automation widgets to the Automations section, with the activated automation or run selected.

#### Scenario: Counts reflect the workspace

- **WHEN** a workspace holds three projects, seven tabs of which five are terminals, and two agents that need the user
- **THEN** the overview shows three projects, seven tabs with five terminals, and two agents in Needs you

#### Scenario: Live update

- **WHEN** an agent moves from Working to Done while the Home section is shown
- **THEN** the agent counts update without the user leaving the section

#### Scenario: Unavailable connection

- **WHEN** one attached connection is offline
- **THEN** its share of the counts is shown as unavailable rather than zero

#### Scenario: Activating an automation run

- **WHEN** a user activates a run in the recent-runs widget
- **THEN** the Automations section is shown with that run selected

#### Scenario: Empty workspace

- **WHEN** the workspace holds one empty project and no automations
- **THEN** the overview shows one project, zero tabs, zero agents, and an empty automations widget that offers to create an automation

### Requirement: Home search

While Home is selected, a band across the top of Home SHALL hold a search box that finds Home's sections and every project, tab, and agent of every attached connection, and every automation of every connection that serves automations. Matching SHALL be case-insensitive substring matching over names, as the dashboard filter's is, and SHALL rank a match at the start of a name or word above one elsewhere. Results SHALL be grouped by kind — sections, projects, tabs, agents, automations — and bounded per group. Choosing a result SHALL go to it exactly as activating it elsewhere in Home would: a section is selected, a project or tab is activated as a dashboard row is, an agent as a dashboard agent is, and an automation is opened in the Automations section. The search SHALL be reachable by keyboard, SHALL take focus on `/` while Home is shown and nothing is being typed into, SHALL say when nothing matches, and SHALL clear on Escape.

#### Scenario: Finding a tab

- **WHEN** a user types part of a tab's title into Home's search and chooses the result
- **THEN** Home is left, that tab's project is selected, and the tab is focused

#### Scenario: Finding a section

- **WHEN** a user types "autom" and presses Enter
- **THEN** the Automations section is selected and the search is cleared

#### Scenario: Keyboard focus

- **WHEN** Home is shown, nothing is being typed into, and the user presses `/`
- **THEN** the search box takes focus

#### Scenario: Nothing matches

- **WHEN** the search text matches nothing
- **THEN** the results say that nothing matches
