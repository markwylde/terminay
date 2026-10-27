## ADDED Requirements

### Requirement: Auxiliary windows fit their display and close by shortcut

Terminay Desktop SHALL open each native auxiliary window (Settings, Remote Control, Recordings, Performance Log) no larger than the work area of the display that holds the project window it was opened from, centred in that work area, so its title bar and window controls are on screen. A display with room SHALL show the window at its preferred 1180×820 size. The close-terminal command, from its keyboard shortcut or the Terminal menu, SHALL close a focused auxiliary window. Unsaved macro edits SHALL still be confirmed before the window closes.

#### Scenario: Settings on a small display

- **WHEN** a user opens Settings from a project window on a display whose work area is smaller than 1180×820
- **THEN** the Settings window fits inside that work area and its close button is visible

#### Scenario: Settings from a full-screen window

- **WHEN** a user opens Settings from a full-screen project window on macOS and presses ⌘W
- **THEN** the Settings window closes

#### Scenario: Close shortcut with unsaved macro edits

- **WHEN** Settings holds unsaved macro edits and the user presses the close-terminal shortcut
- **THEN** Terminay asks whether to discard the changes before closing Settings
