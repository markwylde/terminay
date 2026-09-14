## MODIFIED Requirements

### Requirement: Application menu per host

Browser hosts SHALL expose an in-page application menu for the shared workspace containing File, Edit, View, and Help menus with the same command vocabulary as the Desktop native menu wherever the browser has an equivalent capability. On a wide workspace that menu SHALL present as a menu bar band above the workspace. On a compact workspace at 640px and below it SHALL present as a single menu control inside the workspace chrome row, opening one menu whose File, Edit, View, and Help commands stay grouped and labelled by their menu, so the same commands remain reachable without a band of its own. Native-only entries such as OS window management, Desktop update installation, native file dialogs, and DevTools SHALL remain absent or disabled unless the host capability exists. Desktop hosts SHALL advertise native menus and therefore omit the in-page application menu entirely, at every width. macOS native title-bar insets SHALL keep traffic lights separate from project tabs and workspace controls.

#### Scenario: Desktop omits the in-page menu

- **WHEN** a Desktop host renders the workspace
- **THEN** the in-page application menu bar is absent

#### Scenario: Native-only entries are hidden in the browser

- **WHEN** a browser host renders the application menu
- **THEN** OS window management, Desktop update installation, native file dialogs, and DevTools entries are absent or disabled

#### Scenario: Compact browser workspace collapses the band

- **WHEN** a browser host renders the workspace at 640px or narrower
- **THEN** no application menu band is rendered and a single menu control sits in the workspace chrome row

#### Scenario: Compact menu keeps every command

- **WHEN** the compact application menu control is opened
- **THEN** it presents the File, Edit, View, and Help commands grouped and labelled by their menu, with the same capability gating as the wide menu bar

### Requirement: Parity of Desktop and web workspace surfaces

Desktop and web SHALL render the same projects, panels, files, terminals, settings, recordings, agents, and connection state. Wide layouts SHALL resemble the Electron workspace. Narrow layouts SHALL replace wide tab strips and sidebars with accessible selectors, drawers, stacked surfaces, and touch controls while retaining the same server object ids; the selector that replaces the project tab strip and the panel tab strip SHALL be the unified switcher, reached from the workspace chrome row. A narrow-layout navigation drawer SHALL occupy the full height available to the workspace rather than a fixed fraction of the viewport, and SHALL overlay the workspace content rather than reducing the height allotted to it. Native-only window operations SHALL be capability-gated, and web clients SHALL manage server-owned logical workspace views through in-page navigation rather than requiring popup windows.

#### Scenario: Narrow layout keeps server object ids

- **WHEN** the workspace renders at a narrow width
- **THEN** selectors, drawers, and stacked surfaces are used while server object ids stay the same

#### Scenario: Narrow navigation drawer fills the viewport

- **WHEN** workspace navigation is opened at a narrow width
- **THEN** the drawer occupies the full height available to the workspace
- **AND** the workspace content is overlaid rather than compressed

#### Scenario: Narrow layout replaces both tab strips with one selector

- **WHEN** the workspace renders at 640px or narrower
- **THEN** the project tab strip and the panel tab strip are replaced by the unified switcher reached from the workspace chrome row

#### Scenario: Web needs no popup windows

- **WHEN** a web client manages server-owned logical workspace views
- **THEN** it uses in-page navigation rather than requiring popup windows

## ADDED Requirements

### Requirement: Compact switcher overlays rather than compresses

The unified switcher SHALL overlay the workspace rather than reduce the height given to the terminal, SHALL be dismissible by pressing outside it or by the platform's dismiss key, and SHALL return focus to the control that opened it. While it is open the workspace beneath SHALL keep its layout so dismissing it requires no terminal relayout.

#### Scenario: Opening the switcher does not resize the terminal

- **WHEN** the switcher opens over a compact workspace
- **THEN** the terminal beneath keeps its geometry and the switcher overlays it

#### Scenario: Dismissing returns focus

- **WHEN** the switcher is dismissed by pressing outside it or by the dismiss key
- **THEN** focus returns to the control that opened it
