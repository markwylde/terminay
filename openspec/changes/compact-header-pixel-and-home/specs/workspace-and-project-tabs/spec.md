## MODIFIED Requirements

### Requirement: Compact bar presentation

On a compact bar at phone width or 640px and below, the workspace chrome SHALL be a single row holding, in order: the application menu control where the host renders one, the file-explorer toggle, the Command Bar control, a project-and-terminal breadcrumb that grows to fill the remaining width, the Notifications control, and a trailing control. The trailing control SHALL be Pixel's dock while the active server has Pixel on, and the connection control otherwise. While Pixel's dock takes the trailing place, the breadcrumb SHALL show when the active server is unreachable or has a server upgrade available, and SHALL say so in its accessible name. The row SHALL NOT carry a dashboard control; the unified switcher SHALL instead offer a Home control as the first control of its toolbar, shown whatever the switcher's filter, marked as current while Home is selected, which selects Home and closes the switcher. The Command Bar control SHALL open the Command Bar whichever view is selected, including Home and a window that holds no project. The breadcrumb SHALL name the active project and the active terminal, SHALL truncate the project name before the terminal title when space runs out, and SHALL open the unified switcher wherever it is pressed. The panel tab strip SHALL be absent on a compact workspace, for a project and for Home alike, and New project SHALL live in the switcher instead of as header `+` chrome. A pending application update SHALL stay visible on the row rather than being folded away. Above 640px the bar SHALL present the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip.

#### Scenario: Phone-width chrome
- **WHEN** the project bar is at 640px or narrower and Pixel is off
- **THEN** the chrome is one row of application menu, file-explorer toggle, Command Bar control, breadcrumb, Notifications control, and connection control, and the panel tab strip is absent

#### Scenario: Pixel takes the trailing place
- **WHEN** the project bar is at 640px or narrower and the active server has Pixel on
- **THEN** Pixel's dock is the trailing control of the row and the connection control is absent

#### Scenario: Server trouble without the connection control
- **WHEN** Pixel's dock takes the trailing place and the active server is unreachable
- **THEN** the breadcrumb shows that the server is unreachable

#### Scenario: Going Home from the switcher
- **WHEN** a user opens the unified switcher on a compact workspace and presses its Home control
- **THEN** Home is selected and the switcher closes

#### Scenario: Opening the Command Bar by touch
- **WHEN** a user presses the Command Bar control on a compact workspace with a project in front
- **THEN** the Command Bar opens over that project, and no other menu opens

#### Scenario: No project in front
- **WHEN** Home is selected on a compact workspace and the window holds no project
- **THEN** the Command Bar control is present and opens the Command Bar

#### Scenario: Command Bar on Home
- **WHEN** a user presses the Command Bar control on a compact workspace while Home is selected
- **THEN** the Command Bar opens over Home

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
- **THEN** its control stays on the row, between the breadcrumb and the Notifications control

#### Scenario: Wide bar is unchanged
- **WHEN** the project bar is wider than 640px
- **THEN** the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip are present
