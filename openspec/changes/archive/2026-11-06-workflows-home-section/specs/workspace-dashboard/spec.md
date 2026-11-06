## MODIFIED Requirements

### Requirement: Home sidebar sections

While Home is selected, the workspace SHALL offer a Home sidebar that lists exactly six sections, in this order: **Home**, **Tabs**, **Bots**, **Automations**, **Workflows**, and **Recordings**.

Activating a section SHALL open it as a Home tab, or bring its tab to the front where one is already open, so that no section is ever open twice. The sidebar SHALL show as current the section that owns the Home tab in front, and SHALL show none as current when no Home tab is open. A tab opened from within a section SHALL count as belonging to that section; for example, a bot's tab belongs to Bots, an automation's tab to Automations, and a recording's replay to Recordings.

The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. The sidebar items SHALL be reachable by keyboard, and SHALL expose the current section to assistive technology.

#### Scenario: Choosing a section

- **WHEN** a user activates Tabs in the Home sidebar and no Tabs tab is open
- **THEN** a Tabs tab opens in front and Tabs is shown as current

#### Scenario: Section already open

- **WHEN** a user activates Automations in the Home sidebar while an Automations tab is open behind another tab
- **THEN** that tab comes to the front and no second Automations tab opens

#### Scenario: Current section follows the tab in front

- **WHEN** a user brings an automation's tab to the front
- **THEN** the sidebar shows Automations as current

#### Scenario: Bot tab belongs to Bots

- **WHEN** a user brings a bot's tab to the front
- **THEN** the sidebar shows Bots as current

#### Scenario: Section remembered

- **WHEN** a device that last had the Automations tab in front selects Home again, or reconnects with Home selected
- **THEN** the Automations tab is in front and the sidebar shows Automations as current

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** Home opens with the Home section's tab, the sidebar shows Home as current, and no error is reported

#### Scenario: Sidebars do not mix

- **WHEN** a user moves between Home and a project
- **THEN** Home shows only its six sections and the project shows only its own sidebar panes

#### Scenario: Replay belongs to Recordings

- **WHEN** a user brings a recording's replay tab to the front
- **THEN** the sidebar shows Recordings as current

#### Scenario: Workflows sits between Automations and Recordings

- **WHEN** a user selects Home
- **THEN** the sidebar lists Home, Tabs, Bots, Automations, Workflows, and Recordings in that order

### Requirement: Home with no tabs open

When every Home tab is closed, Home SHALL show an empty state that names the six sections and opens the one a user activates. Home SHALL remain the selected view, and the Home sidebar SHALL remain available.

#### Scenario: Closing the last tab

- **WHEN** a user closes the only Home tab
- **THEN** Home stays selected and shows an empty state offering Home, Tabs, Bots, Automations, Workflows, and Recordings

#### Scenario: Opening from the empty state

- **WHEN** a user activates Automations in the empty state
- **THEN** the Automations tab opens in front


## ADDED Requirements

### Requirement: Workflows section lists the window's workflows

The Workflows section SHALL show, as one horizontally scrolling row of columns, one column for every workflow attached to a terminal panel that the window's dashboard lists. A workflow whose terminal the dashboard does not list SHALL NOT be shown. The section SHALL cover the window's one server and SHALL NOT merge workflows across servers.

#### Scenario: Workflows from two projects

- **WHEN** project A has two terminals with workflows and project B has one
- **THEN** the Workflows section shows three columns

#### Scenario: Terminal the dashboard does not list

- **WHEN** the server reports a workflow for a terminal session that no dashboard panel row holds
- **THEN** no column is shown for it

### Requirement: Workflow column content

Each column SHALL show the workflow's name, its project and terminal title, steps done out of total, the time since its first step started or that it is finished, a collapsible brief holding the opening prompt, and each step's marker, time, and note as the expanded workflow panel shows them. Every `running`, `failed`, or `needs_input` step SHALL be highlighted. All workflow text SHALL be rendered as plain text.

#### Scenario: Running step

- **WHEN** a workflow has three of seven steps done with notes, and its fourth step has been running for 14 minutes
- **THEN** its column shows "3 of 7 done", the three notes, and the fourth step highlighted with "14m"

#### Scenario: Earlier failure and a running step

- **WHEN** step 2 failed and step 4 is running
- **THEN** both steps are highlighted

#### Scenario: Note containing markup

- **WHEN** a step's note is `<img src=x onerror=alert(1)>`
- **THEN** the column shows those characters and nothing else happens

### Requirement: Workflow tone

Each shown workflow SHALL have one tone, used by every status filter, count, mark, and sort in the section and by the sidebar count: **Needs you** when any step is `failed` or `needs_input`, or when the workflow could not be restored; otherwise **Running** when a step is `running`; otherwise **Done** when every step is `done`; otherwise **Idle**. A column whose tone is Needs you SHALL be marked as needing the user.

#### Scenario: A step needs the user

- **WHEN** an agent sets a step to `needs_input` with the note "Keep finished workflows?"
- **THEN** that column is marked as needing the user, and shows the step with a red marker and the note

#### Scenario: Failed and running

- **WHEN** one step failed and a later step is running
- **THEN** the workflow's tone is Needs you

### Requirement: Unrestorable workflow column

A workflow that could not be restored SHALL be shown as a column named "Workflow could not be restored" that names its terminal and project, has the Needs you tone, and offers only the open control. For text filtering it SHALL match on its terminal title and project name, and grouped by Workflow it SHALL be in a group of that name.

#### Scenario: Unrestorable

- **WHEN** a terminal's workflow could not be restored
- **THEN** its column says "Workflow could not be restored", names the terminal, and counts toward Needs you

### Requirement: Opening a workflow's terminal

Each column SHALL offer a control that opens its terminal exactly as activating that terminal's row on the dashboard does, including for a terminal in the automation space or in a project another workspace view shows. A column rendered before its terminal went away SHALL do nothing when activated. The section SHALL NOT change any workflow or step, and SHALL NOT type into any terminal.

#### Scenario: Opening the terminal

- **WHEN** a user activates the open control of a column whose terminal is in a project of this window
- **THEN** the project is selected, Home is left, and that terminal is focused

#### Scenario: Automation terminal

- **WHEN** a user activates the open control of a column whose terminal is in the automation space
- **THEN** Home stays selected and that terminal opens in a Home tab, as from the dashboard

#### Scenario: Stale column

- **WHEN** a user activates the open control of a column whose terminal was closed a moment before
- **THEN** nothing is opened and no error is shown

### Requirement: Workflows section updates live

The section SHALL update while shown and while its tab is hidden: a workflow that is launched, changed, replaced, or removed, and a terminal that is renamed, moved, or closed, SHALL be reflected without the user leaving the section.

#### Scenario: Step update

- **WHEN** an agent marks a step done while the Workflows section is shown
- **THEN** the column shows that step done with its note

#### Scenario: Terminal closed

- **WHEN** a terminal with a workflow is closed while the section is shown
- **THEN** its column disappears

#### Scenario: Terminal renamed

- **WHEN** a terminal with a workflow is renamed
- **THEN** its column shows the new title

### Requirement: Workflows section loading and empty states

Until the server's workflows have been read once, the section SHALL say that workflows are loading rather than that there are none. When no workflow can be shown, it SHALL say there are no workflows and that a workflow is launched from a terminal's Command Bar. When filters leave none of the existing workflows, it SHALL say that no workflow matches the view and offer **Reset view**.

#### Scenario: Before the first read

- **WHEN** the section opens before the server has answered the first workflow read
- **THEN** it says workflows are loading

#### Scenario: No workflows

- **WHEN** no terminal the dashboard lists has a workflow
- **THEN** the section says there are no workflows and that one is launched from a terminal's Command Bar

#### Scenario: Nothing matches

- **WHEN** the filters leave no workflow to show while three exist
- **THEN** the section says no workflow matches the view, and Reset view shows all three

### Requirement: Workflows text filter

The section SHALL offer a text filter that shows only workflows whose name, terminal title, or project name contains the text, ignoring case. The section SHALL state how many workflows it shows out of how many there are.

#### Scenario: Text filter

- **WHEN** a user types "pairing" and one terminal is titled "claude · pairing"
- **THEN** only that terminal's workflow is shown, and the count reads "1 of" the total

### Requirement: Workflows status filter

The section SHALL offer status filters **Needs you**, **Running**, and **Done**, by tone. Any number MAY be selected; none selected SHALL mean every tone, and with any selected only workflows of a selected tone SHALL be shown. Each filter SHALL show how many workflows in the included projects have its tone, and SHALL expose whether it is selected to assistive technology.

#### Scenario: Two status filters

- **WHEN** a user selects Needs you and Running
- **THEN** workflows of those tones are shown, and Done and Idle workflows are not

### Requirement: Workflows project filter

The section SHALL offer a project filter listing every project that holds a shown workflow, each of which the user MAY include or leave out, and a control that includes all or leaves all out. Every project SHALL be included until the user leaves it out, so a project the device has not seen before is included.

#### Scenario: Leaving a project out

- **WHEN** a user leaves project B out
- **THEN** no workflow of project B is shown, and the status counts cover only the other projects

#### Scenario: A new project is included

- **WHEN** a user has left project B out and a workflow appears in a new project C
- **THEN** project C's workflow is shown

### Requirement: Show finished toggle

The section SHALL offer a **Show finished** toggle, on by default, that hides workflows whose tone is Done when off.

#### Scenario: Hiding finished workflows

- **WHEN** a user turns Show finished off
- **THEN** workflows whose every step is done are hidden

### Requirement: Workflows grouping

The section SHALL offer grouping by **None**, **Project**, or **Workflow**. By Project, each project's workflows SHALL form one group named by the project; by Workflow, workflows sharing a name SHALL form one group named by it. Each group SHALL state how many workflows it holds and how many have each of the Needs you, Running, and Done tones. Groups SHALL be ordered by their first workflow under the chosen sort. A column SHALL NOT repeat the name its group shows.

#### Scenario: Grouping by project

- **WHEN** a user groups by Project with workflows in three projects
- **THEN** three groups are shown, each named by its project, and no column names its project

#### Scenario: Grouping by workflow

- **WHEN** a user groups by Workflow and three workflows are named "OpenSpec: Propose → Ship"
- **THEN** one group of that name holds those three columns

### Requirement: Workflows group layout

While grouped, the section SHALL offer to lay groups out **Side by side**, one after another in the one horizontally scrolling row, or as **Rows**, each group a row of its own that scrolls sideways independently, with the rows stacked and scrolling vertically.

#### Scenario: Project rows

- **WHEN** a user groups by Project and chooses Rows
- **THEN** each project is a row of its own, and scrolling one row sideways does not move the others

### Requirement: Folding a group

Each group SHALL offer a control that folds it to its header and a progress dial for each of its workflows, and unfolds it again. The control SHALL be reachable by keyboard and SHALL expose whether the group is expanded.

#### Scenario: Folding a group

- **WHEN** a user folds the group of project B
- **THEN** its columns are hidden, its header remains with a dial per workflow, and unfolding shows the columns again

### Requirement: Workflows sort

The section SHALL offer four sorts. **Needs you first** SHALL order by tone (Needs you, Running, Idle, Done), then by most recent step time. **Recently updated** SHALL order by the latest start or end time of any step, newest first, with workflows that have none last. **Most progress** SHALL order by share of steps done, most first. **Name** SHALL order by workflow name, then terminal title.

#### Scenario: Needs you first

- **WHEN** one workflow is running, one has a failed step, and one is finished
- **THEN** the failed one comes first, then the running one, then the finished one

#### Scenario: Recently updated

- **WHEN** workflow A's latest step started 2 minutes ago and workflow B's ended 10 minutes ago
- **THEN** A comes before B

### Requirement: Workflows density

The section SHALL offer to show step notes **Full**, cut to **2 lines**, or for **Current only**, which shows the notes of every `running`, `failed`, or `needs_input` step and no other; and a **Narrow columns** toggle. Neither SHALL change which workflows are shown.

#### Scenario: Current only

- **WHEN** a user chooses Current only and step 2 failed while step 4 runs
- **THEN** the notes of steps 2 and 4 are shown and no other step's note

### Requirement: Workflows view is per-device and remembered

The section's filters, grouping, layout, sort, density, toggles, and folded groups SHALL be per-device presentation state, NEVER written to server-owned state. A device SHALL restore them when the section is next shown, including after the client reloads. When device storage is unavailable or unreadable, the section SHALL use the defaults and report no error.

#### Scenario: Restored after reload

- **WHEN** a user groups by Project in Rows and the client reloads
- **THEN** the Workflows section is grouped by Project in Rows

#### Scenario: Two devices

- **WHEN** one device groups the section by Workflow
- **THEN** no other device's Workflows section changes

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the section opens with the default view and no error is reported

### Requirement: Reset view

**Reset view** SHALL return every option to its default: no text, no status selected, every project included, no grouping, Side by side, Needs you first, Full notes, finished shown, normal width, and no group folded.

#### Scenario: Reset view

- **WHEN** a user has filtered, grouped, and sorted the section and activates Reset view
- **THEN** every option returns to its default and every workflow is shown

### Requirement: Workflows needing the user are counted on the sidebar

The Workflows item in the Home sidebar SHALL show how many workflows the section could show have the Needs you tone, whatever the section's filters and whether or not its tab is open, and no count when there are none. The count SHALL update live and SHALL be part of the item's accessible name.

#### Scenario: Two workflows need the user

- **WHEN** one workflow has a failed step and another has a step waiting for input, and the Workflows tab is closed
- **THEN** the Workflows item shows 2, and its accessible name says two workflows need you

#### Scenario: Answered

- **WHEN** the waiting step is set back to running
- **THEN** the count drops to 1 without the user leaving Home

### Requirement: Show workflows command

The Command Bar SHALL offer **Show workflows** wherever it offers **Show dashboard**: with a project selected, with Home selected, and with no project in the window. It SHALL select Home and open the Workflows section, or bring its tab to the front where one is open.

#### Scenario: From a project

- **WHEN** a user runs Show workflows while a project is selected
- **THEN** Home is selected with the Workflows tab in front

#### Scenario: Already open

- **WHEN** a user runs Show workflows with Home selected and the Workflows tab behind another tab
- **THEN** that tab comes to the front and no second Workflows tab opens
