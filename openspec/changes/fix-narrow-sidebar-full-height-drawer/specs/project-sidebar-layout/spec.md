## MODIFIED Requirements

### Requirement: Sidebar stack occupies available height without outer scrolling

The sidebar stack SHALL occupy its available height below the group tab bar without an outer vertical scrollbar. Each expanded pane body SHALL own any scrolling required by its content. This SHALL hold in every layout that presents the sidebar, including a narrow-layout navigation drawer, whose available height is the drawer's height rather than a fixed fraction of the viewport.

#### Scenario: Overflowing pane content

- **WHEN** the Files, Agents, Git, or Documentation body content overflows
- **THEN** that body scrolls and the sidebar element itself never scrolls vertically
- **AND** no pane title moves

#### Scenario: Overflowing pane content in a narrow drawer

- **WHEN** the sidebar is presented as a narrow-layout drawer and a pane body overflows
- **THEN** that body scrolls and neither the drawer nor the sidebar element scrolls vertically

#### Scenario: Stack fills the drawer

- **WHEN** the sidebar is presented as a narrow-layout drawer
- **THEN** the stack distributes the drawer's full height under the same rules used in a wide layout
- **AND** the sidebar is not capped to a fixed fraction of the viewport

## ADDED Requirements

### Requirement: Narrow-layout navigation drawer

Below the narrow layout breakpoint, visible workspace navigation SHALL be presented as a drawer occupying the full height available to the workspace, overlaying the workspace content rather than reducing the height allotted to it. Hidden navigation SHALL give the workspace content the full viewport. The drawer SHALL be dismissible by the navigation control, by the Escape key, and by activating the region over the content behind it.

#### Scenario: Opening navigation at a narrow width

- **WHEN** workspace navigation becomes visible below the narrow layout breakpoint
- **THEN** the navigation surface occupies the full height available to the workspace
- **AND** the workspace content keeps its own height rather than being compressed into a remaining row

#### Scenario: Closing the drawer restores the content

- **WHEN** the navigation drawer is dismissed
- **THEN** the workspace content occupies the full viewport
- **AND** its panels are not resized to a different geometry than before the drawer opened

#### Scenario: Dismissal routes

- **WHEN** the user activates the navigation control, presses Escape, or activates the region over the content behind the drawer
- **THEN** the drawer closes

#### Scenario: Wide layout is unaffected

- **WHEN** the workspace renders at or above the narrow layout breakpoint
- **THEN** navigation and content are presented side by side with the resize separator and the persisted navigation width

### Requirement: Navigation drawer focus and assistive-technology behaviour

An open narrow-layout navigation drawer SHALL move focus into itself, SHALL return focus to the control that opened it when it closes, and SHALL keep keyboard focus within itself while open. Workspace content behind an open drawer SHALL be exposed to assistive technology as unavailable for interaction.

#### Scenario: Focus enters and returns

- **WHEN** the navigation drawer opens and is later dismissed
- **THEN** focus moves into the drawer on open and returns to the control that opened it on close

#### Scenario: Focus stays within the drawer

- **WHEN** the drawer is open and the user cycles focus with the keyboard
- **THEN** focus remains within the drawer and does not reach the content behind it

#### Scenario: Content behind the drawer is inert

- **WHEN** assistive technology inspects the workspace while the drawer is open
- **THEN** the content behind the drawer is reported as unavailable for interaction
