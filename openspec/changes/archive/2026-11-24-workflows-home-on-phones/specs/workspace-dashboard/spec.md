## MODIFIED Requirements

### Requirement: Workflows section lists the window's workflows

The Workflows section SHALL show one column for every workflow attached to a terminal panel that the window's dashboard lists. While the section is not narrow, the columns SHALL form one horizontally scrolling row. A workflow whose terminal the dashboard does not list SHALL NOT be shown. The section SHALL cover the window's one server and SHALL NOT merge workflows across servers.

#### Scenario: Workflows from two projects

- **WHEN** project A has two terminals with workflows and project B has one
- **THEN** the Workflows section shows three columns

#### Scenario: Terminal the dashboard does not list

- **WHEN** the server reports a workflow for a terminal session that no dashboard panel row holds
- **THEN** no column is shown for it

### Requirement: Workflows group layout

While grouped and not narrow, the section SHALL offer to lay groups out **Side by side**, one after another in the one horizontally scrolling row, or as **Rows**, each group a row of its own that scrolls sideways independently, with the rows stacked and scrolling vertically.

#### Scenario: Project rows

- **WHEN** a user groups by Project and chooses Rows while the section is not narrow
- **THEN** each project is a row of its own, and scrolling one row sideways does not move the others

### Requirement: Workflows density

The section SHALL offer to show step notes **Full**, cut to **2 lines**, or for **Current only**, which shows the notes of every `running`, `failed`, or `needs_input` step and no other; and, while the section is not narrow, a **Narrow columns** toggle. Neither SHALL change which workflows are shown.

#### Scenario: Current only

- **WHEN** a user chooses Current only and step 2 failed while step 4 runs
- **THEN** the notes of steps 2 and 4 are shown and no other step's note

## ADDED Requirements

### Requirement: A narrow Workflows section

The Workflows section SHALL be narrow while its own width is 600 CSS pixels or less, whether because the device is a phone or because the Home tab is narrow, and SHALL NOT be narrow above 600 CSS pixels.

#### Scenario: Narrow Home tab on a desktop

- **WHEN** the Workflows tab is 600 pixels wide in a wide desktop window
- **THEN** the section is narrow, and at 601 pixels it is not

### Requirement: Stacked workflows on a narrow width

While narrow, columns SHALL be stacked one above another, each at the full width of the section, and groups SHALL be stacked one above another with each group's columns stacked inside it, whatever the stored layout. The section SHALL have exactly one scroll area, which scrolls vertically and holds the header, toolbar, and every column; it SHALL NEVER scroll sideways, and no column or step list SHALL scroll on its own.

#### Scenario: Two workflows on a phone

- **WHEN** a phone shows the Workflows section with two workflows
- **THEN** the two columns are stacked, each as wide as the section, and the section scrolls vertically with no sideways scrolling

#### Scenario: Long workflow on a phone

- **WHEN** a phone shows a workflow with more steps than fit on screen
- **THEN** scrolling the section reaches its last step, and its step list does not scroll by itself

#### Scenario: Grouped on a phone

- **WHEN** a device that remembers grouping by Project, in either Side by side or Rows, shows the section on a phone
- **THEN** each project's group is stacked above the next with its columns stacked inside it

### Requirement: Workflows toolbar on a narrow width

While narrow, the toolbar SHALL show the full-width text filter and the status filter, and place the project filter, grouping, sort, notes, Show finished, and Reset view behind one **View options** control. The layout control and Narrow columns SHALL NOT be offered. Every option SHALL be reachable by scrolling the section. While not narrow, View options SHALL NOT be offered and every option SHALL be shown directly.

#### Scenario: Toolbar on a phone

- **WHEN** a phone shows the Workflows section
- **THEN** the text filter and status filter are shown, grouping, sort, and notes are behind a collapsed View options control, and neither the layout control nor Narrow columns is offered

### Requirement: The View options control

The View options control SHALL be reachable by keyboard, SHALL expose whether it is expanded, and SHALL start collapsed each time the section is shown. While the view differs from the default, the control SHALL say so in its visible label and accessible name.

#### Scenario: Opening View options

- **WHEN** a user on a phone activates View options
- **THEN** it reports itself expanded and shows the project filter, grouping, sort, notes, and Show finished

#### Scenario: A changed view on a phone

- **WHEN** a user on a phone has grouped by Project and View options is collapsed
- **THEN** View options says the view differs from the default

#### Scenario: Short screen

- **WHEN** View options is expanded on a screen too short to show every option
- **THEN** scrolling the section reaches every option, including Reset view

### Requirement: Narrow width leaves the stored view alone

Becoming narrow or ceasing to be narrow SHALL NOT change any stored view option, including the layout and Narrow columns.

#### Scenario: Round trip through a narrow width

- **WHEN** a device that remembers grouping by Project in Rows with Narrow columns on shows the section narrow, reloads while narrow, and is then shown wide
- **THEN** it is grouped by Project in Rows with Narrow columns on

### Requirement: Touch-sized controls on a narrow width

While narrow, every control in the toolbar and View options, every project filter entry, and each column's open and fold controls SHALL be at least 36 CSS pixels tall.

#### Scenario: Control size on a phone

- **WHEN** a phone shows the Workflows section with View options expanded
- **THEN** no toolbar control, project filter entry, or open or fold control is less than 36 pixels tall
