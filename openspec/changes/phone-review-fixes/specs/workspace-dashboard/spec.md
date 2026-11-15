## ADDED Requirements

### Requirement: Compact section page

On a compact workspace, the Tabs, Bots, Automations, Workflows, Recordings, Pull Requests, and Issues sections SHALL each be presented as a compact section page, top to bottom:

- a header row with the section's title and a short summary, a **Search** control, a **View options** control, and, where the section creates things, its create control;
- a row of status tabs;
- the list.

The page SHALL NOT show the section's wide toolbar: no on-page search field, filter chips, view switcher, grouping, sort, or server selector, and no summary chips beyond the tabs. Every option the wide toolbar offers that the compact page keeps SHALL be in the header, the tabs, or the View options sheet. The page SHALL scroll as one region, with the header and tabs staying at the top. Above the compact breakpoint each section SHALL keep its wide presentation unchanged.

#### Scenario: A phone opens Workflows
- **WHEN** a phone shows the Workflows section
- **THEN** the page shows the Workflows title row with Search and View options, then the status tabs, then the workflow rows, and no on-page filter field or chips

#### Scenario: A wide window is unchanged
- **WHEN** the same Workflows tab is shown on a window wider than the compact breakpoint
- **THEN** its wide toolbar is shown as before, and no status tabs or View options sheet are offered

#### Scenario: Create from the header
- **WHEN** a phone shows Bots and the user activates the header's create control
- **THEN** the New bot flow opens, as New bot does on a wide window

### Requirement: Status tabs on a compact section page

The status tabs SHALL be one control with exactly one selected tab, exposed to assistive technology as a tab list. Each tab SHALL show its count of the rows it would show with the current search and View options applied. A tab whose rows need the user, such as Needs you, SHALL mark its count when the count is above zero. The tabs SHALL scroll sideways when they do not fit, and the selected tab SHALL be scrolled into view. Selecting a tab SHALL show only its rows. The selected tab SHALL be section state: it SHALL survive the section's tab going behind another Home tab and coming back, and crossing the compact breakpoint in either direction. Where the wide toolbar has a filter the tabs stand for, the two SHALL be the same state.

#### Scenario: Counts follow search
- **WHEN** a phone shows Workflows with nine workflows, two needing the user, and the user searches for a word that matches one of the two
- **THEN** the tabs read All 1, Needs you 1, Running 0, Done 0

#### Scenario: Needs you stands out
- **WHEN** a phone shows Tabs while two agents wait for the user
- **THEN** the Needs you tab's count of 2 is marked

#### Scenario: Tab kept across a visit
- **WHEN** a user selects Running in Workflows, opens Bots, and returns to Workflows
- **THEN** Running is still selected

### Requirement: Searching a compact section page

Activating Search SHALL replace the header row with a search field and a **Cancel** control, and SHALL move focus into the field. The field's text SHALL be at least 16 CSS pixels so a phone does not zoom. Typing SHALL narrow the rows and the tab counts as the wide section's filter does, using the same matching. **Cancel** SHALL clear the search, restore the header row, and return focus to Search. Escape in the field SHALL do the same. A search SHALL survive the section's tab going behind another Home tab and coming back. When a search and tab together match nothing, the list SHALL say so, naming the search, and SHALL offer **Clear search**.

#### Scenario: Search opens in place
- **WHEN** a user on a phone activates Search in Workflows
- **THEN** the header row becomes a focused search field with Cancel, and the tabs and list stay below it

#### Scenario: No match
- **WHEN** a user searches Workflows for a word nothing matches
- **THEN** the list says no workflow matches that word and offers Clear search, which clears it and shows every workflow again

#### Scenario: Cancel restores the header
- **WHEN** a user cancels a search
- **THEN** the search is cleared, the header row is back, and focus is on Search

### Requirement: View options sheet

Activating View options SHALL open a sheet from the bottom edge, over a scrim, holding the section's secondary options. The sheet SHALL be a modal navigation surface, not an in-page window, as ADR-0125 records: it SHALL NOT offer move, resize, or maximise. It SHALL have a title naming the section, a **Reset** control when any option differs from its default, and a **Done** control. Changes SHALL apply as they are made. Done, Escape, and pressing the scrim SHALL close it. While it is open, focus SHALL stay inside it, and on close focus SHALL return to View options. With reduced motion requested it SHALL appear without sliding. A section that has no secondary options in the current setup SHALL NOT offer View options.

#### Scenario: Opening and closing the sheet
- **WHEN** a user opens View options in Workflows and presses Done
- **THEN** the sheet closes and focus is back on View options

#### Scenario: Escape closes the sheet
- **WHEN** the sheet is open and the user presses Escape
- **THEN** the sheet closes and nothing else closes with it

#### Scenario: Nothing to offer
- **WHEN** a phone shows Automations and only one server is attached
- **THEN** no View options control is offered

### Requirement: Applied view options

A View option that hides rows SHALL count as applied while it differs from its default: a project left out, a repository chosen, a state other than the default, or finished items hidden. Sort, grouping, layout, and showing extra rows SHALL NOT count. While any option is applied, View options SHALL carry a marker and its accessible name SHALL say that filters are applied, and a row under the tabs SHALL show one removable token per applied option and a **Clear** control. Removing a token SHALL reset that option. Clear SHALL reset every applied option and SHALL leave the search and the selected tab alone.

#### Scenario: A project left out
- **WHEN** a user leaves every project but api out of Workflows in the sheet and closes it
- **THEN** View options shows its marker and a token reads api, and the rows and counts cover api only

#### Scenario: Removing a token
- **WHEN** the user removes the api token
- **THEN** every project is included again, and the marker and the token row are gone

#### Scenario: Sorting is not a filter
- **WHEN** a user changes only the sort
- **THEN** View options shows no marker and no token row is shown

### Requirement: Rows on a compact section page

A compact section page SHALL show each item as a row at least 44 CSS pixels tall and the full width of the page. The row SHALL show:

- a leading status mark, avatar, or kind icon;
- a title on one line;
- a trailing short age or count;
- one detail line;
- where the item has them, small chips for its state, checks, or labels.

A row that needs the user SHALL say what it needs in its detail line, in the attention colour. Activating a row SHALL open the item as it does on a wide window, except where a section states otherwise. Rows SHALL be grouped under sticky group headers where the section groups them.

#### Scenario: A waiting agent
- **WHEN** an agent tab is waiting for approval of a command
- **THEN** its row in Tabs says what it wants to run, in the attention colour

### Requirement: Tabs on a compact workspace

On a compact workspace the Tabs section's status tabs SHALL be **All**, **Needs you**, **Working**, **Done**, and **Idle**. Needs you SHALL cover waiting and blocked tabs. Rows SHALL be grouped by project under each project's colour and name. A row SHALL show the tab's status, agent or tab title, what it is doing or waiting for, the time in that state, and its pull request and checks chips. The View options sheet SHALL offer **Layout** (List or Projects) and **Untracked tabs**; while Untracked tabs is on, an **Untracked** tab SHALL be added. The Board layout and Group by project SHALL NOT be offered on a compact workspace.

#### Scenario: Needs you
- **WHEN** a phone shows Tabs, selects Needs you, and two of thirteen tabs are waiting or blocked
- **THEN** only those two rows are shown, under their projects

### Requirement: Workflows on a compact workspace

On a compact workspace the Workflows section's status tabs SHALL be **All**, **Needs you**, **Running**, and **Done**. A row SHALL show:

- the workflow's tone;
- its name;
- its done and total step counts, as `n/m`;
- a progress bar;
- the current step, or what the workflow needs;
- the project, terminal, and age.

Activating a row SHALL open the workflow's detail page. The View options sheet SHALL offer **Sort**, **Group** (None, Project, Workflow), the project checklist, and **Finished workflows**. Notes, Layout, and Narrow columns SHALL NOT be offered.

#### Scenario: A row shows progress
- **WHEN** a workflow has six of nine steps done and its seventh step needs the user
- **THEN** its row reads 6/9, shows a progress bar two-thirds full, and says what the seventh step needs

### Requirement: Workflow detail page on a compact workspace

The workflow detail page SHALL fill the section and SHALL have a back control naming Workflows. It SHALL show:

- the project, folder, and terminal;
- the workflow's name;
- its progress as a bar and as done and total counts, with the elapsed time;
- an **Open terminal** control;
- the brief;
- every step in order, each with its status mark, title, note, and time.

A step that needs the user SHALL be highlighted and SHALL offer Open terminal. The back control and Escape SHALL return to the list, with the list's tab, search, options, and scroll position as they were. The detail page SHALL update live as steps change.

#### Scenario: Opening a workflow
- **WHEN** a user on a phone activates the Ship token refresh fix row
- **THEN** its detail page shows its brief and all nine steps, with step seven highlighted as needing the user

#### Scenario: Back to the list
- **WHEN** the user activates the back control
- **THEN** the Workflows list is shown with the same tab selected and scrolled to the same row

### Requirement: Bots on a compact workspace

On a compact workspace the Bots section's create control SHALL be **New bot**, and its status tabs SHALL be **All**, **Needs you**, **Working**, **Idle**, and **Stopped**. A row SHALL show:

- the bot's avatar, with its status;
- its name and activity chip;
- its pending request, live session, or latest session;
- its next trigger, or its agent and model.

The Needs you tab SHALL show each pending request as a card naming the bot, what it wants, and its age, with **Open chat**. When the request is a permission request, the card SHALL also offer the request's own choices, which SHALL decide it as the bot's chat does. The All tab SHALL end with a container engine card naming the engine, the image state, and how many bot containers are running; activating it SHALL open the View options sheet, which SHALL show the engine details and **Sort**. The build banner SHALL stay on the page above the rows while a build is shown.

#### Scenario: Deciding from the list
- **WHEN** a phone shows Bots, selects Needs you, and a bot asks permission to run a command
- **THEN** a card names the bot and the command and offers the request's choices and Open chat, and choosing one decides the request

#### Scenario: Engine at the end of the list
- **WHEN** a phone shows Bots with All selected
- **THEN** the last thing in the list is the container engine card

### Requirement: Automations on a compact workspace

On a compact workspace the Automations section's create control SHALL be **New automation**, and its status tabs SHALL be **All**, **Failing**, **Schedules**, **Events**, and **Off**:

- **Failing** covers enabled automations whose last run failed or timed out.
- **Schedules** and **Events** cover automations by trigger kind.
- **Off** covers disabled automations.

A row SHALL show the trigger kind's icon, the name, the trigger and next run, the last outcome and its age, and the enable switch, which SHALL work in place. The All tab SHALL end with a **Terminals opened by automations** row, with its count, that opens that list. The View options sheet SHALL offer the server selector, and View options SHALL be offered only while more than one server is attached. The empty state SHALL keep New automation and the starter templates.

#### Scenario: Failing
- **WHEN** a phone shows Automations, selects Failing, and one enabled automation's last run failed
- **THEN** only that automation's row is shown, with its failed outcome

### Requirement: Recordings on a compact workspace

On a compact workspace the Recordings section's status tabs SHALL be **All**, **Today**, **This week**, and **Problems**. Problems SHALL cover recordings that were interrupted or failed. Rows SHALL be grouped under day headers. A row SHALL show:

- the project's colour;
- the title;
- the start time;
- the project, folder, shell, and size;
- the duration;
- a state chip when the recording is not complete.

A row SHALL offer **Delete recording** from a trailing more control. The View options sheet SHALL offer the server selector, when more than one server is attached, and the last update time with **Refresh**.

#### Scenario: Problems
- **WHEN** a phone shows Recordings and selects Problems
- **THEN** only interrupted and failed recordings are shown

### Requirement: Pull requests and issues on a compact workspace

On a compact workspace the Pull Requests section's tabs SHALL be its scopes, **Review**, **Mine**, **Involved**, and **All**. The Issues section's tabs SHALL be **Assigned**, **Created**, **Mentioned**, and **All**. The selected scope SHALL be the same state as the wide scope chips. A scope's tab SHALL show a count once that scope has loaded. The Review tab's count SHALL be marked when it is above zero. A row SHALL show:

- the state icon;
- the title, on up to two lines;
- the number and author;
- the repository, only when not grouped;
- the worktree chip, labels, and checks chip;
- the age.

The View options sheet SHALL offer **State**, **Group** (Repository or None), the repository filter, and the last update time with **Refresh**. A state other than Open, and a chosen repository, SHALL count as applied. A scope that matches nothing SHALL say so and offer **Show all**.

#### Scenario: Review requests
- **WHEN** a phone shows Pull Requests with three review requests across two repositories
- **THEN** the Review tab is selected, its count of 3 is marked, and the rows are grouped under the two repositories

## MODIFIED Requirements

### Requirement: Home sidebar visibility

The project bar's sidebar toggle, its keyboard shortcut, and its command SHALL remain available while Home is selected on a workspace wider than the compact breakpoint, and SHALL show and hide the Home sidebar. Home sidebar visibility SHALL be device presentation state, kept apart from every project's sidebar visibility: toggling one SHALL NEVER change the other. A device that has no stored Home sidebar visibility SHALL show the Home sidebar open. After that, the device SHALL remember the visibility the user last chose. Below the narrow layout breakpoint, the Home sidebar SHALL follow the same navigation-drawer presentation and dismissal routes as a project sidebar. On a compact workspace the Home sidebar SHALL NOT be shown at all. While Home is selected there, the sidebar toggle SHALL be absent, and its keyboard shortcut and command SHALL do nothing. The remembered Home sidebar visibility SHALL be neither read nor changed. A wider window then shows the Home sidebar as the user last chose there. The compact switcher's Home panel is how a compact workspace opens a section.

#### Scenario: First visit to Home on a device

- **WHEN** a device with no stored Home sidebar visibility selects Home on a window wider than the compact breakpoint
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

#### Scenario: No Home sidebar on a phone

- **WHEN** a phone shows Home
- **THEN** no list of Home sections is shown and the header has no sidebar toggle

#### Scenario: Wide choice survives a phone visit

- **WHEN** a device that last showed the Home sidebar on a wide window is used at phone width and then widened again
- **THEN** the Home sidebar is shown

### Requirement: Home sidebar sections

While Home is selected on a workspace wider than the compact breakpoint, the workspace SHALL offer a Home sidebar that lists exactly six sections, in this order: **Home**, **Tabs**, **Bots**, **Automations**, **Workflows**, and **Recordings**.

Activating a section SHALL open it as a Home tab, or bring its tab to the front where one is already open, so that no section is ever open twice. The sidebar SHALL show as current the section that owns the Home tab in front, and SHALL show none as current when no Home tab is open. A tab opened from within a section SHALL count as belonging to that section; for example, a bot's tab belongs to Bots, an automation's tab to Automations, and a recording's replay to Recordings.

The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. On a compact workspace the compact switcher's Home panel SHALL offer the same sections, with the same rules for opening a section and for marking the current one. The sidebar items SHALL be reachable by keyboard, and SHALL expose the current section to assistive technology.

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

When every Home tab is closed, Home SHALL show an empty state that names the six sections and opens the one a user activates. Home SHALL remain the selected view, and the Home sidebar SHALL remain available on a workspace wider than the compact breakpoint; on a compact workspace the switcher's Home panel SHALL remain available instead.

#### Scenario: Closing the last tab

- **WHEN** a user closes the only Home tab
- **THEN** Home stays selected and shows an empty state offering Home, Tabs, Bots, Automations, Workflows, and Recordings

#### Scenario: Opening from the empty state

- **WHEN** a user activates Automations in the empty state
- **THEN** the Automations tab opens in front

### Requirement: Workflows toolbar on a narrow width

While narrow on a window wider than the compact breakpoint, the toolbar SHALL show the full-width text filter and the status filter. It SHALL place the project filter, grouping, sort, notes, Show finished, and Reset view behind one **View options** control. The layout control and Narrow columns SHALL NOT be offered. Every option SHALL be reachable by scrolling the section. While not narrow, View options SHALL NOT be offered and every option SHALL be shown directly. On a compact workspace the section SHALL be a compact section page instead, as the compact Workflows requirement states.

#### Scenario: Toolbar in a narrow tab

- **WHEN** a Workflows tab 500 pixels wide is shown in a window wider than the compact breakpoint
- **THEN** the text filter and status filter are shown, grouping, sort, and notes are behind a collapsed View options control, and neither the layout control nor Narrow columns is offered

#### Scenario: A phone shows the compact page

- **WHEN** a phone shows the Workflows section
- **THEN** it shows the compact section page with status tabs, and no narrow toolbar

### Requirement: The View options control

The narrow Workflows toolbar's View options control SHALL be offered only in a narrow Workflows tab on a window wider than the compact breakpoint. It SHALL be reachable by keyboard, SHALL expose whether it is expanded, and SHALL start collapsed each time the section is shown. While the view differs from the default, the control SHALL say so in its visible label and accessible name.

#### Scenario: Opening View options

- **WHEN** a user in a narrow Workflows tab activates View options
- **THEN** it reports itself expanded and shows the project filter, grouping, sort, notes, and Show finished

#### Scenario: A changed view in a narrow tab

- **WHEN** a user in a narrow Workflows tab has grouped by Project and View options is collapsed
- **THEN** View options says the view differs from the default

#### Scenario: Short screen

- **WHEN** View options is expanded in a narrow Workflows tab too short to show every option
- **THEN** scrolling the section reaches every option, including Reset view

### Requirement: Touch-sized controls on a narrow width

While narrow, every control in the Workflows toolbar and View options, every project filter entry, and each column's open and fold controls SHALL be at least 36 CSS pixels tall. On a compact section page, the header's controls, the status tabs, every row, and every control in the View options sheet SHALL be at least 40 CSS pixels tall.

#### Scenario: Control size on a phone

- **WHEN** a phone shows the Workflows section with the View options sheet open
- **THEN** no header control, status tab, row, or sheet control is less than 40 pixels tall
