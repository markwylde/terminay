## MODIFIED Requirements

### Requirement: Workspace status bar placement and appearance

A workspace window SHALL show one status bar along its bottom edge, below the workspace content and spanning the full window width, whenever the status bar visibility preference for the current layout is on. It SHALL be tinted with the active tab's project colour, the same colour that runs through the joined chrome band, and SHALL follow that colour when the active project tab changes. On the Home dashboard it SHALL use the Home chrome colour.

#### Scenario: Status bar follows the project colour

- **WHEN** the user switches from one project tab to another project tab with a different colour
- **THEN** the status bar takes the newly active project's colour

#### Scenario: Compact chrome

- **WHEN** the workspace renders in the compact chrome layout on a device with no saved compact preference
- **THEN** no status bar is shown

### Requirement: Status bar visibility preference

Whether the status bar is shown SHALL be a device-local preference that persists across restarts, held separately for the regular layout and the compact chrome layout. The regular layout preference SHALL default to shown and the compact chrome layout preference SHALL default to hidden. The **Show Status Bar** command SHALL toggle the preference for the layout currently in effect, and every menu that offers the command with a check mark in a workspace document SHALL show whether the status bar is currently shown in that document. Hiding the status bar SHALL give its height back to the workspace content.

#### Scenario: Default

- **WHEN** a user opens Terminay on a device with no saved preference
- **THEN** the status bar is shown in the regular layout and hidden in the compact chrome layout

#### Scenario: Hidden preference persists

- **WHEN** a user hides the status bar and restarts Terminay
- **THEN** the status bar remains hidden

#### Scenario: Showing the status bar at phone width

- **WHEN** the workspace renders in the compact chrome layout with the status bar hidden and the user chooses **Show Status Bar**
- **THEN** the status bar is shown and the View menu shows the command as checked

#### Scenario: Menu reflects compact default

- **WHEN** the browser host renders in the compact chrome layout with no saved compact preference
- **THEN** the View menu shows **Show Status Bar** unchecked
