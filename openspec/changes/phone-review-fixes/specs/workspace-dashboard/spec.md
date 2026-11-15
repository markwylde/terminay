## ADDED Requirements

### Requirement: Home options panel on a compact workspace

On a compact workspace, while Home is selected, the search, filter, and view controls of the Home tab in front SHALL be presented in a Home options panel rather than on the page. It SHALL open from the compact chrome row's sidebar toggle and slide in over the content from the right-hand edge, leaving a strip of the page visible. It SHALL show a header naming the section and a close control, above controls that scroll when they do not fit.

#### Scenario: Opening options on Workflows

- **WHEN** a phone shows the Workflows section and the user presses the sidebar toggle
- **THEN** the Home options panel slides in from the right with the Workflows filters, and the Workflows list stays on the page behind it

#### Scenario: Wide window has no options panel

- **WHEN** Home shows the Workflows section on a window wider than the compact breakpoint
- **THEN** the Workflows toolbar is on the page and no Home options panel is offered

### Requirement: The Home options panel is a navigation drawer

The Home options panel SHALL be a compact navigation drawer of the same kind as the compact switcher, mirrored to the right-hand edge, and not an in-page window: it SHALL NOT fill the viewport and SHALL NOT offer move, resize, or maximise affordances.

#### Scenario: Panel leaves the page visible

- **WHEN** the Home options panel is open on a phone
- **THEN** a strip of the section's page is visible beside the panel and the panel has no move, resize, or maximise control

### Requirement: Closing the Home options panel

The Home options panel SHALL close on its close control, on the sidebar toggle, on the dismiss key, and on a press on the strip of page beside it. It SHALL also close when the Home tab in front changes, when Home is left, when the workspace stops being compact, and when the compact switcher or the Command Bar opens, so that it is never shown together with either. Under reduced motion it SHALL appear and disappear without sliding.

#### Scenario: Changing section closes the panel

- **WHEN** the Home options panel is open and the user opens Bots from the switcher's Home panel
- **THEN** the Home options panel is closed and Bots is in front

#### Scenario: Switcher closes the panel

- **WHEN** the Home options panel is open and the user opens the compact switcher
- **THEN** the panel closes and the switcher opens

#### Scenario: Dismissing beside the panel

- **WHEN** the Home options panel is open and the user presses the strip of page beside it
- **THEN** the panel closes and nothing on the page is activated

### Requirement: Focus around the Home options panel

While the Home options panel is open it SHALL keep keyboard focus within itself, starting on its first control. When it closes, focus SHALL return to the sidebar toggle, or to the compact title block when the toggle is no longer offered, or to the page when the workspace is no longer compact.

#### Scenario: Focus returns to the toggle

- **WHEN** a keyboard user opens the Home options panel and presses the dismiss key
- **THEN** the panel closes and focus is on the sidebar toggle

#### Scenario: Focus when the toggle goes away

- **WHEN** the Home options panel is open on Workflows and the user opens the Home overview from the switcher
- **THEN** the panel is closed and focus is on the compact title block

### Requirement: Home options panel keeps section state

A control changed in the Home options panel SHALL apply to the page at once. Every filter and view option SHALL survive closing and reopening the panel, switching to another Home tab and back, and crossing the compact breakpoint in either direction, because each belongs to its section and not to the panel.

#### Scenario: Filters survive a round trip

- **WHEN** a user types `deploy` into the Workflows text filter in the Home options panel, opens Bots, returns to Workflows, and widens the window past the compact breakpoint
- **THEN** the Workflows text filter still reads `deploy` and the list is filtered by it

### Requirement: Home options panel toggle

On a compact workspace the sidebar toggle SHALL be offered on Home only while the Home tab in front has options. While that section shows fewer items than it would with its filters at their defaults, the toggle SHALL show a marker and its accessible name SHALL say that filters are applied; grouping, sorting, and view-mode choices SHALL NOT count.

#### Scenario: Filter applied

- **WHEN** a user chooses the Closed state in the Home options panel on Pull Requests and closes the panel
- **THEN** the list on the page shows closed pull requests, and the sidebar toggle shows a marker and says filters are applied

#### Scenario: Grouping is not a filter

- **WHEN** a user groups the Workflows section by Project in the Home options panel and changes nothing else
- **THEN** the sidebar toggle shows no marker

#### Scenario: Section without options

- **WHEN** a phone shows the Home overview section
- **THEN** the compact chrome row shows no sidebar toggle

### Requirement: Section controls in the Home options panel

On a compact workspace each Home section SHALL keep on its page its title, its count or summary line, its primary action, its refresh control where it has one, and its content, including the controls that act on its items. The section's search, filter, grouping, sorting, and view controls SHALL be in the Home options panel instead, wherever another requirement places them in the section's header or toolbar.

#### Scenario: Item actions stay on the page

- **WHEN** a phone shows the Automations section
- **THEN** New automation and each automation's own controls are on the page, and the server selector is in the Home options panel

### Requirement: The Home overview has no options

On a compact workspace the Home overview section SHALL have no options, and SHALL keep its layout editing on the page.

#### Scenario: Overview keeps its layout editing

- **WHEN** a phone shows the Home overview section
- **THEN** its Edit control is on the page

### Requirement: Empty filter results on a compact workspace

On a compact workspace, while a Home section's filters hide every item, the page SHALL say that nothing matches and SHALL offer a control that resets that section's filters to their defaults.

#### Scenario: Filter matches nothing

- **WHEN** a filter applied in the panel matches no workflow
- **THEN** the Workflows page says nothing matches and offers to clear the filter, and activating it shows every workflow again

#### Scenario: Recordings filter matches nothing

- **WHEN** a recordings search in the panel matches no recording
- **THEN** the Recordings page says nothing matches and offers to clear the search

#### Scenario: Clearing from the page

- **WHEN** a Bots filter applied in the panel matches no bot and the user activates the page's clear control
- **THEN** every bot is listed again and the sidebar toggle shows no marker

### Requirement: Home options panel contents for Tabs, Bots, and Automations

On a compact workspace the Home options panel SHALL hold, for Tabs, the filter field, Group by project while the Board view is selected, the view-mode switcher, and the summary chips; for Bots, the filter field, the status chips, and the Container engine summary; and for Automations, the server selector.

#### Scenario: Bots page on a phone

- **WHEN** a phone shows the Bots section
- **THEN** the page shows the Bots title, its description, New bot, and the bots, and shows no filter field, status chips, or Container engine card

#### Scenario: Tabs options

- **WHEN** a phone shows the Tabs section and the user opens the Home options panel
- **THEN** the panel holds the filter field, the view-mode switcher, and the summary chips, and choosing Board changes the page to the Board view

### Requirement: Home options panel contents for Workflows, Recordings, and forges

On a compact workspace the Home options panel SHALL hold, for Workflows, the toolbar; for Recordings, the search field and the server selector; and for Pull Requests and Issues, the scope chips, the state and grouping controls, and the repository filter.

#### Scenario: Pull Requests options

- **WHEN** a phone shows the Pull Requests section and the user opens the Home options panel
- **THEN** the panel holds the scope chips, the state and grouping controls, and the repository filter, and the page keeps the title, count, refresh control, and list

### Requirement: Filters that count as applied

The filters that count toward the Home options panel's filters-applied marker SHALL be: for Tabs, the filter text and a summary-chip filter; for Bots, the filter text and a status chip other than All bots; for Workflows, the text filter, the status filter, an excluded project, and Show finished turned off; for Recordings, the search text; for Pull Requests and Issues, a scope, state, or repository other than the default. Automations SHALL have no filter that counts.

#### Scenario: Show finished turned off

- **WHEN** a user turns off Show finished in the Workflows options and changes nothing else
- **THEN** the sidebar toggle shows the filters-applied marker

#### Scenario: Repository filter

- **WHEN** a user limits Pull Requests to one repository in the Home options panel
- **THEN** the sidebar toggle shows the filters-applied marker

### Requirement: Bots on a compact workspace

On a compact workspace the Bots section SHALL present its title and New bot on one row with the description beneath, SHALL list its bots beneath them, and SHALL list the terminals and bots that need the user after the bots. Its Container engine summary SHALL be in the Home options panel. Its content SHALL use the same side gutters and spacing between blocks as the other Home sections on a compact workspace, and no block SHALL touch the screen edge or the block before it.

#### Scenario: Bots header on a phone

- **WHEN** a phone shows the Bots section
- **THEN** the Bots title and New bot are on the same row, and the Container engine summary is not on the page

#### Scenario: Container engine in options

- **WHEN** a phone shows the Bots section and the user opens the Home options panel
- **THEN** the panel shows the Container engine summary with its engine, containers, image, and Check again control

## MODIFIED Requirements

### Requirement: Home sidebar visibility

The project bar's sidebar toggle, its keyboard shortcut, and its command SHALL remain available while Home is selected, and SHALL show and hide the Home sidebar. Home sidebar visibility SHALL be device presentation state, kept apart from every project's sidebar visibility: toggling one SHALL NEVER change the other. A device that has no stored Home sidebar visibility SHALL show the Home sidebar open. After that, the device SHALL remember the visibility the user last chose. Below the narrow layout breakpoint, the Home sidebar SHALL follow the same navigation-drawer presentation and dismissal routes as a project sidebar. On a compact workspace the Home sidebar SHALL NOT be shown at all: the sidebar toggle, its keyboard shortcut, and its command SHALL show and hide the Home options panel instead, and the remembered Home sidebar visibility SHALL be neither read nor changed. A wider window then shows the Home sidebar as the user last chose there. The compact switcher's Home panel is how a compact workspace opens a section.

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

- **WHEN** a phone shows Home and the user presses the sidebar toggle
- **THEN** no list of Home sections is shown, and the Home options panel opens when the Home tab in front has options

#### Scenario: Wide choice survives a phone visit

- **WHEN** a device that last showed the Home sidebar on a wide window is used at phone width, where the user opens and closes the Home options panel, and then is widened again
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

While narrow, the toolbar SHALL show the full-width text filter and the status filter, and place the project filter, grouping, sort, notes, Show finished, and Reset view behind one **View options** control. The layout control and Narrow columns SHALL NOT be offered. Every option SHALL be reachable by scrolling the section. While not narrow, View options SHALL NOT be offered and every option SHALL be shown directly. On a compact workspace the section is narrow, but its whole toolbar SHALL be in the Home options panel instead of on the page: the text filter, the status filter, the project filter, grouping, sort, notes, Show finished, and Reset view SHALL each be shown directly there, with no View options control, and the layout control and Narrow columns SHALL NOT be offered.

#### Scenario: Toolbar on a phone

- **WHEN** a Workflows tab 500 pixels wide is shown in a window wider than the compact breakpoint
- **THEN** the text filter and status filter are shown, grouping, sort, and notes are behind a collapsed View options control, and neither the layout control nor Narrow columns is offered

#### Scenario: Toolbar in the options panel

- **WHEN** a phone shows the Workflows section and the user opens the Home options panel
- **THEN** the panel shows the text filter, status filter, project filter, grouping, sort, notes, Show finished, and Reset view, and the page above the workflows shows no toolbar and no View options control

### Requirement: The View options control

The View options control SHALL be offered only where the narrow Workflows toolbar is on the page, never in the Home options panel. It SHALL be reachable by keyboard, SHALL expose whether it is expanded, and SHALL start collapsed each time the section is shown. While the view differs from the default, the control SHALL say so in its visible label and accessible name.

#### Scenario: Opening View options

- **WHEN** a user in a narrow Workflows tab activates View options
- **THEN** it reports itself expanded and shows the project filter, grouping, sort, notes, and Show finished

#### Scenario: A changed view on a phone

- **WHEN** a user in a narrow Workflows tab has grouped by Project and View options is collapsed
- **THEN** View options says the view differs from the default

#### Scenario: Short screen

- **WHEN** View options is expanded in a narrow Workflows tab too short to show every option
- **THEN** scrolling the section reaches every option, including Reset view

### Requirement: Touch-sized controls on a narrow width

While narrow, every control in the toolbar and View options, every Workflows control in the Home options panel, every project filter entry, and each column's open and fold controls SHALL be at least 36 CSS pixels tall.

#### Scenario: Control size on a phone

- **WHEN** a phone shows the Workflows section with the Home options panel open
- **THEN** no Workflows control in the panel, project filter entry, or open or fold control is less than 36 pixels tall
