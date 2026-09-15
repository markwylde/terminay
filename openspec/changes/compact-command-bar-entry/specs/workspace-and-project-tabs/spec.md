## MODIFIED Requirements

### Requirement: Compact bar presentation

On a compact bar at phone width or 640px and below, the workspace chrome SHALL be a single row holding, in order: the application menu control where the host renders one, the file-explorer toggle, the dashboard control, the Command Bar control, a project-and-terminal breadcrumb that grows to fill the remaining width, and the connection control on the trailing edge. The Command Bar control SHALL open the Command Bar for the project in front and SHALL be unavailable when no project is in front. The breadcrumb SHALL name the active project and the active terminal, SHALL truncate the project name before the terminal title when space runs out, and SHALL open the unified switcher wherever it is pressed. The panel tab strip SHALL be absent on a compact workspace, and New project SHALL live in the switcher instead of as header `+` chrome. A pending application update SHALL stay visible on the row rather than being folded away. Above 640px the bar SHALL present the full project tab strip, its overflow switcher, the named connection control, and the panel tab strip.

#### Scenario: Phone-width chrome
- **WHEN** the project bar is at 640px or narrower
- **THEN** the chrome is one row of application menu, file-explorer toggle, dashboard, Command Bar control, breadcrumb, and connection control, and the panel tab strip is absent

#### Scenario: Opening the Command Bar by touch
- **WHEN** a user presses the Command Bar control on a compact workspace with a project in front
- **THEN** the Command Bar opens over that project, and no other menu opens

#### Scenario: No project in front
- **WHEN** the dashboard is selected on a compact workspace
- **THEN** the Command Bar control is present and disabled rather than looking live and doing nothing

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
