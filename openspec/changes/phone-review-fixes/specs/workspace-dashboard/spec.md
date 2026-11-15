## ADDED Requirements

### Requirement: Compact section page

On a compact workspace, the Tabs, Bots, Automations, Workflows, Recordings, Pull Requests, and Issues sections SHALL each be presented as a compact section page. Top to bottom, it SHALL hold a header row, a row of status tabs, and the list. The page SHALL scroll as one region, with the header row and tabs staying at the top. Above the compact breakpoint each section SHALL keep its wide presentation unchanged.

#### Scenario: A phone opens Workflows
- **WHEN** a phone shows the Workflows section
- **THEN** the page shows the Workflows header row, then the status tabs, then the workflow rows

#### Scenario: A wide window is unchanged
- **WHEN** the same Workflows tab is shown on a window wider than the compact breakpoint
- **THEN** its wide toolbar is shown as before, and no status tabs or View options sheet are offered

### Requirement: No wide toolbar on a compact section page

A compact section page SHALL NOT show the section's wide toolbar: no on-page search field, filter chips, view switcher, grouping, sort, or server selector, and no summary chips. Every wide option the compact page keeps SHALL be in the header row, the status tabs, or the View options sheet.

#### Scenario: No filter chips on a phone
- **WHEN** a phone shows Bots
- **THEN** no filter field or filter chips are drawn above the rows

### Requirement: Compact section header row

The header row SHALL show the section's title and a short summary, and SHALL offer a **View options** control while the section has secondary options, as the View options sheet requirement states. Tabs, Bots, Workflows, and Recordings SHALL also offer a **Search** control. Bots SHALL offer **New bot**, and Automations **New automation**, as a create control that starts the same flow as on a wide window.

#### Scenario: Create from the header
- **WHEN** a phone shows Bots and the user activates the header's create control
- **THEN** the New bot flow opens, as New bot does on a wide window

#### Scenario: No search where a section has none
- **WHEN** a phone shows Pull Requests
- **THEN** the header row offers View options and no Search control

### Requirement: Status tabs on a compact section page

The status tabs SHALL be one control with exactly one selected tab, exposed to assistive technology as a tab list. Selecting a tab SHALL show only its rows. The tabs SHALL scroll sideways when they do not fit, and the selected tab SHALL be scrolled into view.

#### Scenario: Selecting a tab
- **WHEN** a user on a phone selects Running in Workflows
- **THEN** only running workflows are shown and Running is the selected tab

### Requirement: Status tabs and the wide filters

Where the wide toolbar has a single-choice filter the status tabs stand for, the two SHALL be the same state. Where the wide filter allows several choices, the tab SHALL be the compact page's own state, and the wide selection SHALL apply as an applied option, as the Workflows status tabs requirement states.

#### Scenario: Bots filter shared
- **WHEN** a user selects Stopped on Bots on a phone and the window is widened
- **THEN** the wide Bots filter shows Stopped selected

### Requirement: Status tab counts

Each status tab SHALL show the count of rows it would show with the current search and View options applied. A tab whose rows need the user, such as Needs you, SHALL mark its count when the count is above zero.

#### Scenario: Counts follow search
- **WHEN** a phone shows Workflows with nine workflows, two needing the user, and the user searches for a word that matches one of the two
- **THEN** the tabs read All 1, Needs you 1, Running 0, Done 0

#### Scenario: Needs you stands out
- **WHEN** a phone shows Tabs while two agents wait for the user
- **THEN** the Needs you tab's count of 2 is marked

### Requirement: Compact section state survives

A compact section page's selected tab, search, and View options SHALL be section state. They SHALL survive the section's Home tab going behind another Home tab and coming back, and the window crossing the compact breakpoint in either direction.

#### Scenario: Tab kept across a visit
- **WHEN** a user selects Running in Workflows, opens Bots, and returns to Workflows
- **THEN** Running is still selected

#### Scenario: Search kept across the breakpoint
- **WHEN** a user searches Workflows on a phone and the window is widened
- **THEN** the wide Workflows filter field holds the same text

### Requirement: Searching a compact section page

Activating Search SHALL replace the header row with a search field and a **Cancel** control, and SHALL move focus into the field. The field's text SHALL be at least 16 CSS pixels so a phone does not zoom. Typing SHALL narrow the rows and the tab counts as the wide section's filter does, using the same matching.

#### Scenario: Search opens in place
- **WHEN** a user on a phone activates Search in Workflows
- **THEN** the header row becomes a focused search field with Cancel, and the tabs and list stay below it

### Requirement: Ending a search

**Cancel** SHALL clear the search, restore the header row, and return focus to Search. Escape in the field SHALL do the same.

#### Scenario: Cancel restores the header
- **WHEN** a user cancels a search
- **THEN** the search is cleared, the header row is back, and focus is on Search

### Requirement: Nothing matches on a compact section page

When the search, the selected tab, and the View options together match nothing, the list SHALL say so. It SHALL name the search when there is one and offer **Clear search**; otherwise it SHALL offer the section's reset.

#### Scenario: No match
- **WHEN** a user searches Workflows for a word nothing matches
- **THEN** the list says no workflow matches that word and offers Clear search, which clears it and shows the selected tab's rows under the current View options again

### Requirement: View options sheet

Activating View options SHALL open a sheet from the bottom edge, over a scrim, holding the section's secondary options. The sheet SHALL be a modal navigation surface, not an in-page window, as ADR-0125 records, and SHALL NOT offer move, resize, or maximise. A section that has no secondary options in the current setup SHALL NOT offer View options.

#### Scenario: Nothing to offer
- **WHEN** a phone shows Automations and only one server is attached
- **THEN** no View options control is offered

### Requirement: View options sheet controls

The sheet SHALL have a title naming the section, a **Reset** control when any option differs from its default, and a **Done** control. Changes SHALL apply as they are made. Done, Escape, and pressing the scrim SHALL close it.

#### Scenario: Opening and closing the sheet
- **WHEN** a user opens View options in Workflows and presses Done
- **THEN** the sheet closes

#### Scenario: Escape closes only the sheet
- **WHEN** the sheet is open and the user presses Escape
- **THEN** the sheet closes and nothing else closes with it

### Requirement: Focus and motion in the View options sheet

While the sheet is open, focus SHALL stay inside it, starting on its first control. On close, focus SHALL return to View options. With reduced motion requested, the sheet SHALL appear without sliding.

#### Scenario: Focus returns
- **WHEN** a user closes the sheet
- **THEN** focus is on View options

#### Scenario: Reduced motion
- **WHEN** reduced motion is requested and the user opens the sheet
- **THEN** the sheet appears without an entrance animation

### Requirement: Applied view options

A View option that hides rows SHALL count as applied while it differs from its default: the project filter while it leaves any project out, whose one token names the included projects, a repository chosen, a state other than the default, or finished items hidden. Sort, grouping, layout, and showing extra rows SHALL NOT count. While any option is applied, View options SHALL carry a marker, and its accessible name SHALL say that filters are applied.

#### Scenario: Sorting is not a filter
- **WHEN** a user changes only the sort
- **THEN** View options shows no marker

### Requirement: Applied options row

While any View option is applied, a row under the tabs SHALL show one removable token per applied option and a **Clear** control. Removing a token SHALL reset that option. Clear SHALL reset every applied option, and SHALL leave the search and the selected tab alone.

#### Scenario: A project left out
- **WHEN** a user leaves every project but api out of Workflows in the sheet and closes it
- **THEN** View options shows its marker, a token reads api, and the rows and counts cover api only

#### Scenario: Removing a token
- **WHEN** the user removes the api token
- **THEN** every project is included again, and the marker and the token row are gone

### Requirement: Rows on a compact section page

A compact section page SHALL show each item as a full-width row at least 44 CSS pixels tall. The row SHALL show a leading status mark, avatar, or kind icon, a one-line title, a trailing short age or count, and one detail line. Where the item has them, it SHALL also show small chips for state, checks, or labels. Rows SHALL be grouped under sticky group headers where the section groups them.

#### Scenario: Grouped rows
- **WHEN** a phone shows Tabs
- **THEN** rows sit under a sticky header per project

### Requirement: Rows that need the user

A row that needs the user SHALL say what it needs in its detail line, in the attention colour. Activating any row SHALL open the item as it does on a wide window, except where a section states otherwise.

#### Scenario: A waiting agent
- **WHEN** an agent tab is waiting for approval of a command
- **THEN** its row in Tabs says what it wants to run, in the attention colour

### Requirement: Tabs on a compact workspace

On a compact workspace the Tabs section's status tabs SHALL be **All**, **Needs you**, **Working**, **Done**, and **Idle**. Needs you SHALL cover waiting and blocked tabs. Rows SHALL be grouped by project, under each project's colour and name. A row SHALL show the tab's status, its agent or tab title, what it is doing or waiting for, the time in that state, and its pull request and checks chips.

#### Scenario: Needs you
- **WHEN** a phone shows Tabs, selects Needs you, and two of thirteen tabs are waiting or blocked
- **THEN** only those two rows are shown, under their projects

### Requirement: Tabs view options on a compact workspace

The Tabs View options sheet SHALL offer **Layout** (List or Projects) and **Untracked tabs**. While Untracked tabs is on, an **Untracked** status tab SHALL be added. The Board layout and Group by project SHALL NOT be offered on a compact workspace. A stored Board layout SHALL show as List there, and the stored choice SHALL be left as it is.

#### Scenario: Board on a phone
- **WHEN** a device that chose Board on a wide window shows Tabs on a phone
- **THEN** the rows show as List, and the wide window still shows Board

### Requirement: Workflows on a compact workspace

On a compact workspace the Workflows section's status tabs SHALL be **All**, **Needs you**, **Running**, and **Done**. A row SHALL show:

- the workflow's tone and name;
- its done and total steps as `n/m`, with a progress bar;
- the current step, or what the workflow needs;
- the project, the terminal, and the age.

Activating a row SHALL open the workflow's detail page.

#### Scenario: A row shows progress
- **WHEN** a workflow has six of nine steps done and its seventh step needs the user
- **THEN** its row reads 6/9, shows a progress bar two-thirds full, and says what the seventh step needs

### Requirement: Workflows view options on a compact workspace

The Workflows View options sheet SHALL offer **Sort**, **Group** (None, Project, or Workflow), the project checklist, and **Finished workflows**. Notes, Layout, and Narrow columns SHALL NOT be offered on a compact workspace.

#### Scenario: The Workflows sheet
- **WHEN** a user opens View options in Workflows on a phone
- **THEN** the sheet offers Sort, Group, the projects, and Finished workflows, and no Notes, Layout, or Narrow columns

### Requirement: Workflow detail page on a compact workspace

The workflow detail page SHALL fill the section, with a back control naming Workflows. It SHALL show:

- the project and terminal;
- the name;
- progress as a bar, with done and total counts and elapsed time;
- an **Open terminal** control;
- the brief;
- every step in order, with its status mark, title, note, and time.

It SHALL update live as steps change.

#### Scenario: Opening a workflow
- **WHEN** a user on a phone activates the Ship token refresh fix row
- **THEN** its detail page shows its brief and all nine steps

### Requirement: A step that needs the user

On the workflow detail page, a step that needs the user SHALL be highlighted and SHALL offer Open terminal. The page SHALL never answer or run a step itself.

#### Scenario: Step seven needs the user
- **WHEN** the detail page shows a workflow whose seventh step needs the user
- **THEN** step seven is highlighted and offers Open terminal

### Requirement: Leaving the workflow detail page

The back control and Escape SHALL return to the Workflows list with its tab, search, options, and scroll position as they were.

#### Scenario: Back to the list
- **WHEN** the user activates the back control
- **THEN** the Workflows list is shown with the same tab selected and scrolled to the same row

### Requirement: Bots on a compact workspace

On a compact workspace the Bots section's status tabs SHALL be the wide filter chips: **All**, **Needs you**, **Working**, and **Stopped**. Each count SHALL count bots, as the chips do. A row SHALL show:

- the bot's avatar with its status;
- its name and activity chip;
- its pending request, live session, or latest session;
- its next trigger, or its agent and model.

The build banner SHALL stay on the page above the rows while a build is shown.

#### Scenario: A working bot
- **WHEN** a phone shows Bots and a bot is reviewing a pull request
- **THEN** its row shows Working and what it is reviewing

### Requirement: Bots Needs you cards

The Bots Needs you tab SHALL show each pending request as a card naming the bot, what it wants, and its age, with **Open chat**. When the request is a permission request, the card SHALL also offer the request's own choices. Choosing one SHALL decide the request as the bot's chat does, on the connection of the server that owns the bot.

#### Scenario: Deciding from the list
- **WHEN** a phone shows Bots, selects Needs you, and a bot asks permission to run a command
- **THEN** a card names the bot and the command and offers the request's choices and Open chat, and choosing one decides the request

### Requirement: Deciding from a Bots Needs you card

While a decision from a card is pending, the card's choices SHALL be disabled. A decision that fails SHALL leave the card in place with its choices enabled and say that it failed. A request decided elsewhere SHALL leave the list.

#### Scenario: A decision fails
- **WHEN** a user chooses a permission choice on a card and the server rejects the decision
- **THEN** the card stays, says the decision failed, and offers its choices again

#### Scenario: Decided on another device
- **WHEN** a request shown as a card is decided from another device
- **THEN** its card leaves the Needs you tab

#### Scenario: Double activation
- **WHEN** a user activates a choice twice quickly
- **THEN** one decision is sent, and the choices are disabled until it settles

### Requirement: Bots container engine on a compact workspace

On a compact workspace the Bots All tab SHALL end with a container engine card naming the engine, the image state, and how many bot containers are running. Activating it SHALL open the View options sheet, which SHALL show the engine details. Bots SHALL offer View options only through the engine card, since it has no other secondary options.

#### Scenario: Engine at the end of the list
- **WHEN** a phone shows Bots with All selected
- **THEN** the last thing in the list is the container engine card

### Requirement: Automations on a compact workspace

On a compact workspace the Automations section's status tabs SHALL be:

- **All**;
- **Failing**: enabled automations whose last run failed or timed out;
- **Schedules** and **Events**: automations by trigger kind;
- **Off**: disabled automations.

A row SHALL show the trigger kind's icon, the name, the trigger and next run, the last outcome and its age, and the enable switch, which SHALL work in place.

#### Scenario: Failing
- **WHEN** a phone shows Automations, selects Failing, and one enabled automation's last run failed
- **THEN** only that automation's row is shown, with its failed outcome

### Requirement: Automations extras on a compact workspace

The Automations All tab SHALL end with a **Terminals opened by automations** row that shows their count and opens that list. The View options sheet SHALL offer the server selector, and SHALL be offered only while more than one server is attached. The empty state SHALL keep New automation and the starter templates.

#### Scenario: Automation terminals
- **WHEN** a phone shows Automations with two terminals opened by automations
- **THEN** the All list ends with a row reading Terminals opened by automations and 2

### Requirement: Recordings on a compact workspace

On a compact workspace the Recordings section's status tabs SHALL be **All**, **Today**, **This week**, and **Problems**. Problems SHALL cover interrupted and failed recordings. Rows SHALL be grouped under day headers. A row SHALL show the project's colour, the title, and the start time. It SHALL also show the project, folder, shell, size, and duration, and a state chip while the recording is not complete.

#### Scenario: Problems
- **WHEN** a phone shows Recordings and selects Problems
- **THEN** only interrupted and failed recordings are shown

### Requirement: Recordings actions on a compact workspace

A recording row SHALL offer **Delete recording** from a trailing more control. The Recordings View options sheet SHALL offer the server selector when more than one server is attached, and the last update time with **Refresh**.

#### Scenario: Deleting from a row
- **WHEN** a user opens a recording row's more control
- **THEN** Delete recording is offered

### Requirement: Pull requests and issues on a compact workspace

On a compact workspace the Pull Requests tabs SHALL be its scopes, **Review**, **Mine**, **Involved**, and **All**, and the Issues tabs SHALL be **Assigned**, **Created**, **Mentioned**, and **All**. The selected scope SHALL be the same state as the wide scope chips. A scope's tab SHALL show a count only once this Home tab has received that scope's result for the current State, repository, and account. A Review count above zero SHALL be marked.

#### Scenario: Review requests
- **WHEN** a phone shows Pull Requests with three review requests
- **THEN** the Review tab is selected and its count of 3 is marked

### Requirement: Forge scope counts

A forge scope tab's count SHALL be the number of items in the last result this Home tab received for it, followed by + when the forge has more pages. A scope with no received result for the current State, repository, and account SHALL show no count. Showing counts SHALL NEVER fetch.

#### Scenario: Scope not yet visited
- **WHEN** a phone shows Pull Requests and the Mine scope has not been loaded for the current State, repository, and account
- **THEN** the Mine tab shows no count, and no request is made for it

#### Scenario: More pages
- **WHEN** the Involved result holds 50 items and the forge has more pages
- **THEN** the Involved tab reads 50+

### Requirement: Forge rows on a compact workspace

A pull request or issue row SHALL show:

- the state icon;
- the title, on up to two lines;
- the number and author, and the repository only when rows are not grouped;
- its worktree chip, labels, and checks chip;
- the age.

Rows SHALL be grouped by repository unless the sheet says otherwise.

#### Scenario: Grouped by repository
- **WHEN** a phone shows three review requests across two repositories
- **THEN** the rows sit under the two repositories' headers and do not repeat the repository

### Requirement: Forge view options on a compact workspace

The forge View options sheet SHALL offer **State**, **Group** (Repository or None), the repository filter, the **Account** filter when two or more accounts serve the list, and the last update time with **Refresh**. A state other than Open, a chosen repository, and a chosen account SHALL count as applied. A list narrowed to an account that has nothing SHALL say so and offer **Show all accounts**; otherwise a scope that matches nothing SHALL say so and offer **Show all**.

#### Scenario: Merged pull requests
- **WHEN** a user sets State to Merged in the sheet
- **THEN** a Merged token is shown under the tabs and View options carries its marker

### Requirement: No Home sidebar on a compact workspace

On a compact workspace the Home sidebar SHALL NOT be shown at all. While Home is selected there, the sidebar toggle SHALL be absent, and its keyboard shortcut and command SHALL do nothing. The remembered Home sidebar visibility SHALL be neither read nor changed, so a wider window shows the Home sidebar as the user last chose there. The compact switcher's Home panel is how a compact workspace opens a section.

#### Scenario: No sidebar toggle on a phone
- **WHEN** a phone shows Home
- **THEN** no list of Home sections is shown and the header has no sidebar toggle

#### Scenario: The wide choice survives
- **WHEN** a device that last showed the Home sidebar on a wide window is used at phone width and then widened again
- **THEN** the Home sidebar is shown

### Requirement: Workflows status tabs on a compact workspace

The Workflows status tabs SHALL be the compact page's own state, and SHALL NOT change the stored status filter. While the stored status filter selects any tone, it SHALL apply on a compact page as one applied option whose token names the selected tones. Removing the token SHALL clear the stored status filter. A wide window SHALL show the stored status filter as it was.

#### Scenario: Two tones chosen on a wide window
- **WHEN** a device chose Needs you and Running on a wide window and then shows Workflows on a phone
- **THEN** All is selected, a token reads Needs you, Running, the rows and counts cover those tones, and widening the window shows both filters still selected

### Requirement: Unrestorable workflow on a compact workspace

On a compact workspace a workflow that could not be restored SHALL be a row titled "Workflow could not be restored" that names its terminal and project and has the Needs you tone. Its detail page SHALL say the same and offer only Open terminal.

#### Scenario: Unrestorable on a phone
- **WHEN** a phone shows Workflows and a terminal's workflow could not be restored
- **THEN** a Needs you row reads Workflow could not be restored and names the terminal

### Requirement: Workflow detail page follows its workflow

When the workflow shown on its detail page is removed or replaced, the detail page SHALL return to the Workflows list as the back control does.

#### Scenario: Workflow removed while open
- **WHEN** the workflow on the detail page is removed
- **THEN** the Workflows list is shown with its tab and options as they were

### Requirement: One compact drawer at a time

At most one compact drawer or sheet SHALL be open, as ADR-0125 records. Opening the compact switcher or the Command Bar SHALL close an open View options sheet. Widening the window past the compact breakpoint SHALL close it and move focus to the section's page. A press outside the sheet SHALL close only the sheet.

#### Scenario: Switcher over a sheet
- **WHEN** a View options sheet is open and the user opens the compact switcher
- **THEN** the sheet closes and the switcher opens

#### Scenario: Command Bar over a sheet
- **WHEN** a View options sheet is open and the user opens the Command Bar
- **THEN** the sheet closes and the Command Bar has focus

#### Scenario: Widening with a sheet open
- **WHEN** the window widens past the compact breakpoint while a sheet is open
- **THEN** the sheet is gone and the wide page is shown

## MODIFIED Requirements

### Requirement: Home sidebar visibility

The project bar's sidebar toggle, its keyboard shortcut, and its command SHALL remain available while Home is selected on a workspace wider than the compact breakpoint, and SHALL show and hide the Home sidebar. Home sidebar visibility SHALL be device presentation state, kept apart from every project's sidebar visibility: toggling one SHALL NEVER change the other. A device that has no stored Home sidebar visibility SHALL show the Home sidebar open. After that, the device SHALL remember the visibility the user last chose. Below the narrow layout breakpoint, the Home sidebar SHALL follow the same navigation-drawer presentation and dismissal routes as a project sidebar. On a compact workspace the Home sidebar SHALL NOT be shown, as the next requirement states.

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

### Requirement: Home sidebar sections

While Home is selected on a workspace wider than the compact breakpoint, the workspace SHALL offer a Home sidebar that lists these sections, in this order: **Home**, **Tabs**, **Bots**, **Automations**, **Workflows**, **Recordings**, **Pull Requests**, and **Issues**. **Pull Requests** SHALL be listed only while at least one enabled forge source serves pull requests with its Pull requests on Home setting on, and **Issues** only while one serves issues with its Issues on Home setting on. Both SHALL be hidden from a client whose authorization is bound to a project. **Pull Requests** SHALL carry a count of open pull requests that request the user's review, and **Issues** a count of open issues assigned to the user, each drawn in the neutral badge tone and omitted when zero or unknown.

Activating a section SHALL open it as a Home tab, or bring its tab to the front where one is already open, so that no section is ever open twice. The sidebar SHALL show as current the section that owns the Home tab in front, and SHALL show none as current when no Home tab is open. A tab opened from within a section SHALL count as belonging to that section; for example, a bot's tab belongs to Bots, an automation's tab to Automations, and a recording's replay to Recordings.

The Home sidebar SHALL NOT show any project's Explorer, Documentation, Agents, or Git panes, and a project's sidebar SHALL NOT show the Home sections. On a compact workspace the compact switcher's Home panel SHALL offer the same sections under the same rules for listing, hiding, counting, opening, and marking the current one. The sidebar items SHALL be reachable by keyboard, and SHALL expose the current section to assistive technology.

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

### Requirement: Rows are single unwrapped lines

On a workspace wider than the compact breakpoint, in the List view every row SHALL occupy exactly one line. Row text SHALL NEVER wrap, and content that does not fit the available width SHALL be truncated with a visible truncation indicator while the status affordance, project colour, and emoji stay visible. Narrowing the window SHALL truncate row text rather than reflow, re-order, or hide rows. The card views SHALL likewise truncate rather than wrap any single field, and SHALL NEVER hide a card because the window is narrow. On a compact workspace rows follow the compact section page's row requirements instead.

#### Scenario: Long title

- **WHEN** a panel title is wider than the available row width in the List view
- **THEN** the title is truncated with a visible truncation indicator and the row stays one line

#### Scenario: Narrow window

- **WHEN** the window is narrowed while the List view is shown
- **THEN** rows truncate their text and no row wraps, reorders, or disappears

#### Scenario: Narrow window in a card view

- **WHEN** the window is narrowed while a card view is shown
- **THEN** cards reflow into fewer columns, every field truncates rather than wrapping, and no card is hidden

### Requirement: Tabs section is the workspace dashboard

The Tabs section SHALL present the workspace dashboard — its rows, view modes, and activation behaviour — exactly as the dashboard requirements define them. On a compact workspace it SHALL present the same projects, panels, agents, untracked terminals, and terminals outside the window's projects as a compact section page, as the compact Tabs requirements state. A project with no panels SHALL show under All as its group header with a note that it has no tabs. Activating a project or panel from the Tabs section SHALL leave Home as those requirements define.

#### Scenario: Tabs shows the dashboard

- **WHEN** a user selects the Tabs section
- **THEN** every project and panel is shown in the dashboard's remembered view mode

#### Scenario: Activating a row from Tabs

- **WHEN** a user activates a panel row in the Tabs section
- **THEN** that panel's project is selected, Home is left, and the panel is focused

#### Scenario: Empty project on a phone

- **WHEN** a phone shows Tabs with All selected and a project has no panels
- **THEN** the project's header is shown with a note that it has no tabs

### Requirement: Dashboard view modes

The dashboard SHALL offer exactly three view modes over one model — List, Board, and Projects — selectable from a control in the dashboard header that names the current mode and is reachable by keyboard. On a compact workspace it SHALL offer only List and Projects, from the View options sheet, and SHALL show a remembered Board as List without changing what is remembered. Every mode SHALL present the same facts, differing only in arrangement: a status, count, or name SHALL NEVER read one way in one mode and another way in another.

- **List** SHALL present every project as a header row followed by its panels, one unwrapped line each.
- **Board** SHALL present one column per canonical status group, in the reading order Idle, Working, Needs you, Done, followed by the Untracked column. Each column holds one card per agent, or per panel where no agent owns it, named with the project it belongs to. Board is a triage view and MAY omit a project that has nothing in a column.
- **Projects** SHALL present one card per project holding that project's panels and agents.

The selected mode SHALL be per-device presentation state, SHALL NEVER be written to server-owned workspace state, and SHALL be remembered across reconnects. That memory SHALL be a hint: when it cannot be read, or when device storage is unavailable, the dashboard SHALL show the List view and SHALL report no error.

#### Scenario: Switching mode

- **WHEN** a user selects a different view mode
- **THEN** the dashboard re-arranges into that mode over the same projects, panels, and agents

#### Scenario: Board column order

- **WHEN** the Board view is shown
- **THEN** its columns read, from the start of the reading direction, Idle, Working, Needs you, Done, Untracked

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

### Requirement: Workflow column content

Each column, and on a compact workspace each workflow's detail page, SHALL show the workflow's name, its project and terminal title, steps done out of total, the time since its first step started or that it is finished, the brief holding the opening prompt, and each step's marker, time, and note as the expanded workflow panel shows them. Every `running`, `failed`, or `needs_input` step SHALL be highlighted. All workflow text SHALL be rendered as plain text.

#### Scenario: Running step

- **WHEN** a workflow has three of seven steps done with notes, and its fourth step has been running for 14 minutes
- **THEN** its column shows "3 of 7 done", the three notes, and the fourth step highlighted with "14m"

#### Scenario: Earlier failure and a running step

- **WHEN** step 2 failed and step 4 is running
- **THEN** both steps are highlighted

#### Scenario: Note containing markup

- **WHEN** a step's note is `<img src=x onerror=alert(1)>`
- **THEN** the column shows those characters and nothing else happens

### Requirement: Stacked workflows on a narrow width

While narrow on a window wider than the compact breakpoint, columns SHALL be stacked one above another, each at the full width of the section, and groups SHALL be stacked one above another with each group's columns stacked inside it, whatever the stored layout. The section SHALL have exactly one scroll area, which scrolls vertically and holds the header, toolbar, and every column; it SHALL NEVER scroll sideways, and no column or step list SHALL scroll on its own. On a compact workspace the section SHALL show rows and detail pages instead, as the compact Workflows requirements state.

#### Scenario: Narrow tab on a desktop

- **WHEN** a 560-pixel Workflows tab on a wide desktop window shows two workflows
- **THEN** the two columns are stacked, each as wide as the section, and the section scrolls vertically with no sideways scrolling

#### Scenario: Long workflow in a narrow tab

- **WHEN** a narrow Workflows tab on a wide window shows a workflow with more steps than fit
- **THEN** scrolling the section reaches its last step, and its step list does not scroll by itself

#### Scenario: Grouped in a narrow tab

- **WHEN** a device that remembers grouping by Project shows a narrow Workflows tab on a wide window
- **THEN** each project's group is stacked above the next with its columns stacked inside it

### Requirement: Workflows density

The section SHALL offer to show step notes **Full**, cut to **2 lines**, or for **Current only**, which shows the notes of every `running`, `failed`, or `needs_input` step and no other; and a **Narrow columns** toggle. Neither SHALL change which workflows are shown. On a compact workspace neither SHALL be offered, and the detail page SHALL show every step's note in full.

#### Scenario: Current only

- **WHEN** a user chooses Current only and step 2 failed while step 4 runs
- **THEN** the notes of steps 2 and 4 are shown and no other step's note
