## MODIFIED Requirements

### Requirement: Compact bar presentation

On a compact bar at phone width or 640px and below, the workspace chrome SHALL be a single row holding, in order: the application menu control where the host renders one, the file-explorer toggle, the dashboard control, a project-and-terminal breadcrumb that grows to fill the remaining width, and the connection control on the trailing edge. The breadcrumb SHALL name the active project and the active terminal, SHALL truncate the project name before the terminal title when space runs out, and SHALL open the unified switcher wherever it is pressed. The panel tab strip SHALL be absent on a compact workspace, and New project SHALL live in the switcher instead of as header `+` chrome. A pending application update SHALL stay visible on the row rather than being folded away. Above 640px the bar SHALL present the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip.

#### Scenario: Phone-width chrome
- **WHEN** the project bar is at 640px or narrower
- **THEN** the chrome is one row of application menu, file-explorer toggle, dashboard, breadcrumb, and connection control, and the panel tab strip is absent

#### Scenario: Breadcrumb names where the user is
- **WHEN** a compact workspace has an active project and an active terminal
- **THEN** the breadcrumb names that project and that terminal, truncating the project name first

#### Scenario: Either breadcrumb segment opens the switcher
- **WHEN** a user presses the project segment or the terminal segment of the breadcrumb
- **THEN** the unified switcher opens, and no other menu opens

#### Scenario: Compact All projects menu
- **WHEN** the compact switcher opens
- **THEN** it spans the window with compact rows listing every project of every attached connection, and offers New project instead of header `+` chrome

#### Scenario: A pending update stays visible
- **WHEN** an application update is pending on a compact bar
- **THEN** its control stays on the row, between the breadcrumb and the connection control

#### Scenario: Wide bar is unchanged
- **WHEN** the project bar is wider than 640px
- **THEN** the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip are present

## ADDED Requirements

### Requirement: Unified compact switcher

A compact workspace SHALL provide one switcher that presents every terminal of every project of every attached connection, grouped by connection and then by project. Each project group SHALL name its project with that project's colour and SHALL offer a new terminal for that project. Each terminal row SHALL name its terminal and SHALL activate that terminal on its own server when pressed, selecting that terminal's project first when it is not the active one. A connection heading SHALL appear for every attached connection, including when only one is attached, so a row's owning server is never ambiguous. The switcher SHALL offer New project and Add connection alongside the per-group new terminal, so every create action absorbed from the collapsed chrome remains reachable. The switcher SHALL open from the breadcrumb and from the connection control, presenting the same content from both.

#### Scenario: Grouped by connection and project
- **WHEN** the switcher opens with two attached connections holding projects with terminals
- **THEN** rows appear under a heading for each connection and a group for each project of that connection

#### Scenario: Activating a terminal in a background project
- **WHEN** a user presses a terminal row belonging to a project that is not active
- **THEN** that project becomes active on its own server and that terminal becomes the active terminal

#### Scenario: Connection control opens the same switcher
- **WHEN** a user presses the connection control on a compact workspace
- **THEN** the unified switcher opens with the same grouped content the breadcrumb opens

#### Scenario: Create actions survive the collapse
- **WHEN** the switcher is open
- **THEN** it offers a new terminal for each project group, New project, and Add connection

#### Scenario: Single connection still names its server
- **WHEN** exactly one connection is attached
- **THEN** its heading still appears above its project groups

### Requirement: Compact project editing survives the collapse

A project group heading in the switcher SHALL open that project's editor on a
long press, the same gesture a project switcher row carries, so editing a
project stays reachable at a width where no project tab is rendered. A short
press on a heading SHALL do nothing, leaving activation to the terminal rows
beneath it.

#### Scenario: Long-pressing a project heading
- **WHEN** a user long-presses a project group heading in the switcher
- **THEN** that project's editor opens

#### Scenario: A short press on a heading is inert
- **WHEN** a user taps a project group heading without holding
- **THEN** nothing is activated and the switcher stays open

### Requirement: Compact switcher filtering

The switcher SHALL offer a text filter that matches terminal titles, project names, and connection names. The filter SHALL start collapsed as a search control and SHALL expand into a field only when a user asks for it; nothing in the switcher SHALL take focus when it opens, so reaching a project or terminal never raises a software keyboard. Collapsing the filter SHALL clear it and restore the full grouped list. A filter SHALL keep a group whose project or connection name matches, keep a terminal row whose title matches, and SHALL hide groups left with no rows. Clearing the filter SHALL restore the full grouped list. The filter SHALL NOT change which terminal is active.

#### Scenario: The switcher opens without taking focus
- **WHEN** the switcher opens
- **THEN** the filter is a collapsed search control, no field holds focus, and no software keyboard is raised

#### Scenario: Collapsing the filter restores the list
- **WHEN** a user collapses an expanded filter that was narrowing the list
- **THEN** the filter clears and every group returns

#### Scenario: Filtering by terminal title
- **WHEN** a user types text matching one terminal's title
- **THEN** only that terminal's row and its enclosing project and connection headings remain

#### Scenario: Filtering by project name
- **WHEN** a user types text matching a project name
- **THEN** that project's group and all of its terminal rows remain

#### Scenario: Filter matches nothing
- **WHEN** the filter matches no terminal, project, or connection
- **THEN** the switcher reports that nothing matches and still offers its create actions

### Requirement: Compact connection control presentation

On a compact workspace the connection control SHALL present as a glyph without the server name, SHALL keep the exposure tone it carries on a wide bar, and SHALL carry a reachability indicator for its connection. Its accessible name SHALL still name the current server so the control is identifiable without the visible label.

#### Scenario: Name gives way to the glyph
- **WHEN** the workspace is 640px or narrower
- **THEN** the connection control shows a glyph with its exposure tone and a reachability indicator, and no server name

#### Scenario: Accessible name keeps the server
- **WHEN** assistive technology reads the compact connection control
- **THEN** its accessible name includes the current server
