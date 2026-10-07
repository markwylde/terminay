## MODIFIED Requirements

### Requirement: Home is a selectable view, not a project

A workspace view SHALL have exactly one selected view at a time: either Home or one project. Home SHALL NOT be a project: it has no environment, no root, no colour, and no server-owned panels or layout, and it SHALL NEVER appear in the ordered project list, in project ordering, or in the overflow switcher. The tabs Home holds SHALL be Home tabs, which are device presentation and never workspace panels. Selecting Home SHALL NOT close, suspend, unmount, or detach any project, panel, or terminal session, and every terminal SHALL continue to run and receive output exactly as it does while its project is in the background.

#### Scenario: Selecting Home

- **WHEN** a user selects Home
- **THEN** Home's tabs replace the project workspace area and no project tab is presented as active

#### Scenario: Terminals keep running

- **WHEN** Home is selected while terminals are running
- **THEN** every terminal keeps running and receiving output, and none is closed, suspended, or detached

#### Scenario: Home is not in the project list

- **WHEN** projects are ordered, overflowed, or listed in the switcher
- **THEN** Home is absent from that ordering and that list

#### Scenario: Home tabs are not workspace panels

- **WHEN** panels are counted, listed in the Tabs section, or shared with another device
- **THEN** Home tabs are absent from that count, that list, and that device

### Requirement: Home control presentation

The Home control SHALL be an icon-only control on the project bar, and in the compact chrome row, showing a house glyph and distinguished from project tabs so that it never reads as a project. It SHALL show a selected state while Home is the selected view, SHALL be reachable by keyboard, and SHALL carry an accessible name naming Home. While Home is selected, the chrome band SHALL use a neutral Home colour rather than any project's colour. On the project bar, the selected Home control SHALL be drawn as a tab that opens into Home's tab strip in that colour, as the active project tab opens into its project's tab strip.

#### Scenario: Selected state

- **WHEN** Home is the selected view
- **THEN** the Home control shows its selected state, no project tab shows an active state, and the chrome band uses the neutral Home colour

#### Scenario: Selected Home control opens into the band

- **WHEN** Home is selected on the project bar
- **THEN** the Home control is drawn as a tab joined to Home's tab strip, both in the neutral Home colour

#### Scenario: House glyph

- **WHEN** the project bar or the compact chrome row renders the Home control
- **THEN** the control shows a house glyph

#### Scenario: Accessible name

- **WHEN** assistive technology reads the Home control
- **THEN** it announces a name identifying Home

### Requirement: Home sidebar sections

While Home is selected the workspace SHALL offer a Home sidebar that lists exactly three sections, in this order: **Home**, **Tabs**, and **Automations**. Activating a section SHALL open it as a Home tab, or bring its tab to the front where one is already open, so that no section is ever open twice. The sidebar SHALL show as current the section that the Home tab in front belongs to, and SHALL show none as current when no Home tab is open. A tab opened from within a section, such as an automation, SHALL count as belonging to that section. The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. The sidebar items SHALL be reachable by keyboard and SHALL expose the current section to assistive technology.

#### Scenario: Choosing a section

- **WHEN** a user activates Tabs in the Home sidebar and no Tabs tab is open
- **THEN** a Tabs tab opens in front and Tabs is shown as current

#### Scenario: Section already open

- **WHEN** a user activates Automations in the Home sidebar while an Automations tab is open behind another tab
- **THEN** that tab comes to the front and no second Automations tab opens

#### Scenario: Current section follows the tab in front

- **WHEN** a user brings an automation's tab to the front
- **THEN** the sidebar shows Automations as current

#### Scenario: Section remembered

- **WHEN** a device that last had the Automations tab in front selects Home again, or reconnects with Home selected
- **THEN** the Automations tab is in front and the sidebar shows Automations as current

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** Home opens with the Home section's tab, the sidebar shows Home as current, and no error is reported

#### Scenario: Sidebars do not mix

- **WHEN** a user moves between Home and a project
- **THEN** Home shows only its three sections and the project shows only its own sidebar panes

### Requirement: Home overview section

The Home section SHALL present a set of overview widgets derived from the same workspace inventory, agent state, connection state, and automation state that the rest of the workspace uses, so that no count ever reads differently here than elsewhere. It SHALL present: the number of open projects; the number of open tabs, with how many are terminals; agents counted by canonical state group (Needs you, Working, Done, Idle); remote connections and connected devices; active automations with the next scheduled run; and the most recent automation runs with their outcome. With more than one connection attached, each count SHALL cover every attached connection, and every automation widget SHALL name the server that owns each automation it lists. A connection that is unavailable SHALL be shown as unavailable rather than counted as zero. Widgets SHALL update live while shown.

Activating a widget SHALL take the user to the place that holds its detail: the project and agent widgets SHALL open the Tabs section, an automation SHALL open that automation's tab, a run SHALL open that run's tab, and the offer to create an automation SHALL open a new automation tab. Each SHALL bring an already open tab to the front rather than opening a second.

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
- **THEN** that run's tab opens in front, and the Home section's tab stays open behind it

#### Scenario: Empty workspace

- **WHEN** the workspace holds one empty project and no automations
- **THEN** the overview shows one project, zero tabs, zero agents, and an empty automations widget that offers to create an automation

## ADDED Requirements

### Requirement: Home tabs

Home SHALL present its content as tabs in a tab strip of its own, drawn where a project draws its panel tab strip and managed the same way: a user SHALL be able to open several Home tabs, bring any to the front, close any, reorder them by dragging, and arrange them side by side or stacked by dragging a tab to an edge. Each Home tab SHALL carry a title naming what it shows and a close control. Closing a Home tab SHALL close only that tab and SHALL NEVER close, stop, or delete the project, automation, run, or terminal it shows. Home tabs SHALL NOT be movable into a project, and project panels SHALL NOT be movable into Home.

#### Scenario: Two tabs side by side

- **WHEN** a user drags the Automations tab to the right edge of Home while the Tabs tab is open
- **THEN** both are shown side by side, each in its own tab strip

#### Scenario: Reordering

- **WHEN** a user drags a Home tab past its neighbour in the tab strip
- **THEN** the two tabs swap places and the tab in front does not change

#### Scenario: Closing a tab

- **WHEN** a user closes a Home tab showing an automation's run
- **THEN** the tab closes and the run is still in that automation's history

#### Scenario: Home and projects stay apart

- **WHEN** a user drags a Home tab over a project tab on the project bar
- **THEN** the tab stays in Home and the project is unchanged

### Requirement: Home tabs keep their state

A Home tab SHALL keep everything a user has put into it — text typed into fields, chosen options, filters, scroll position, and expanded items — while another Home tab is in front, while a project is the selected view, and while the Home sidebar is shown or hidden. Returning to the tab SHALL show it as it was left.

#### Scenario: Leaving for a project and coming back

- **WHEN** a user types a name and a command into a new automation tab without saving, selects a project, and then selects Home again
- **THEN** the new automation tab is still open in front with the name and command as typed

#### Scenario: Switching between Home tabs

- **WHEN** a user filters the Tabs section, brings the Automations tab to the front, and returns to the Tabs tab
- **THEN** the filter text and its results are as the user left them

### Requirement: Home tab arrangement is per-device and remembered

The Home tabs open on a device, their order, their arrangement, and which is in front SHALL be per-device presentation state and SHALL NEVER be written to server-owned workspace state. A device SHALL remember them and SHALL restore them when the workspace is next opened. That memory SHALL be a hint: a remembered tab whose automation, run, terminal, or connection no longer exists SHALL be left out; unsaved edits SHALL NOT be remembered, so a remembered new automation tab is left out and a remembered editor reopens showing the saved automation; and when the memory cannot be read, or device storage is unavailable, Home SHALL open with the Home section's tab alone and SHALL report no error. A device with nothing remembered SHALL open Home with the Home section's tab alone.

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

### Requirement: Home with no tabs open

When every Home tab is closed, Home SHALL show an empty state that names the three sections and opens the one a user activates. Home SHALL remain the selected view, and the Home sidebar SHALL remain available.

#### Scenario: Closing the last tab

- **WHEN** a user closes the only Home tab
- **THEN** Home stays selected and shows an empty state offering Home, Tabs, and Automations

#### Scenario: Opening from the empty state

- **WHEN** a user activates Automations in the empty state
- **THEN** the Automations tab opens in front

### Requirement: Home tabs on a compact workspace

On a compact workspace, where no panel tab strip is drawn, Home SHALL show only the Home tab in front, filling the content area whatever arrangement the device remembers. The Home sidebar, presented as a navigation drawer, SHALL remain the way to open a section, and a tab opened from within a section SHALL come to the front. Each Home tab that is not a section SHALL offer a control that closes it and returns to the tab that opened it, so that no tab is reachable only through a tab strip.

#### Scenario: Compact Home shows one tab

- **WHEN** a device that remembers two Home tabs side by side shows Home on a compact workspace
- **THEN** only the tab in front is shown, filling the content area

#### Scenario: Leaving an automation's tab without a tab strip

- **WHEN** a user on a compact workspace opens an automation from the Automations tab and then activates that tab's close control
- **THEN** the automation's tab closes and the Automations tab is in front

## REMOVED Requirements

### Requirement: Home search

**Reason**: Home's top band holds Home's tab strip. Finding a section, project, tab, agent, or automation belongs with every other way of jumping somewhere, in the Command Bar, where it is also available while a project is in front.

**Migration**: Open the Command Bar (`CmdOrCtrl+L`, the application menu, or the compact chrome control) and type. The same sections, projects, tabs, agents, and automations are found, ranked and grouped the same way, and choosing one goes to the same place. The `/` shortcut no longer focuses anything.
