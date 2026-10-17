## ADDED Requirements

### Requirement: Pixel dock in the status bar

When the active tab's server has Pixel enabled, the right side of the status bar SHALL hold Pixel's dock, placed before the remote access indicator. The dock SHALL show a small static Pixel that fits within the status bar's height without changing it. It SHALL be keyboard-operable and SHALL carry an accessible name and tooltip that say Pixel's state. The dock SHALL follow the active tab's server: switching to a tab on a server with Pixel disabled SHALL remove it. The dock SHALL be present on the Home dashboard as well as on project tabs.

#### Scenario: Dock beside the remote indicator

- **WHEN** the status bar is shown and the active tab's server has Pixel enabled
- **THEN** the right side shows the docked Pixel immediately before the remote access indicator, and the status bar's height is unchanged

#### Scenario: Server without Pixel

- **WHEN** the user switches to a tab whose server has Pixel disabled
- **THEN** the status bar shows no Pixel dock

#### Scenario: Keyboard activation

- **WHEN** the dock has keyboard focus and the user presses Enter
- **THEN** Pixel comes out with its chat balloon open
