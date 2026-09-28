## ADDED Requirements

### Requirement: Show Status Bar command

**Show Status Bar** SHALL be a first-class application command that toggles the device-local status bar visibility setting. It SHALL appear in the View menu on Desktop as a checkbox item reflecting the current setting, and in the browser host's in-page View menu as a checked item reflecting the same setting. It SHALL be searchable in the Command Bar and rebindable in the shortcut settings surface, with no default accelerator. It SHALL require no active panel. The setting SHALL be classified as device-local, SHALL default to shown, and SHALL NOT be written to server-owned settings.

#### Scenario: Toggling from the View menu

- **WHEN** a Desktop user chooses **View → Show Status Bar** while the status bar is shown
- **THEN** the status bar hides and the menu item is no longer checked

#### Scenario: Browser in-page menu

- **WHEN** a browser host renders its in-page View menu
- **THEN** it offers **Show Status Bar** checked according to the device's setting

#### Scenario: Device-local setting

- **WHEN** a user hides the status bar on one device
- **THEN** other devices connected to the same server keep their own status bar setting
