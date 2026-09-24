## ADDED Requirements

### Requirement: Native menu bar only on project windows

On Windows and Linux, Terminay Desktop SHALL attach the native application menu bar only to project-host workspace windows. Every other Desktop window SHALL have no native menu bar. That includes auxiliary settings, macros, recordings and edit windows, terminal pop-out windows, and transient helper windows. This SHALL hold for the whole life of each window, including after the application menu is rebuilt because settings or keyboard shortcuts changed. A window with no menu bar SHALL still dispatch configured application keyboard shortcuts and the terminal copy accelerator. On macOS, the single global application menu SHALL be unchanged.

#### Scenario: Project window shows the menu bar

- **WHEN** a project-host workspace window opens on Windows or Linux
- **THEN** it shows the native File, Terminal, Edit, View, Window and Help menu bar

#### Scenario: Settings window has no menu bar

- **WHEN** the Settings auxiliary window opens on Windows or Linux
- **THEN** it has no native menu bar

#### Scenario: Other secondary windows have no menu bar

- **WHEN** a macros, recordings, edit-tab or terminal pop-out window opens on Windows or Linux
- **THEN** it has no native menu bar

#### Scenario: Menu rebuild does not re-attach the bar

- **WHEN** a keyboard shortcut or other setting changes while a secondary window is open on Windows or Linux, and the application menu is rebuilt
- **THEN** project-host windows show the rebuilt menu bar and the secondary window still has no menu bar

#### Scenario: Shortcuts in a window without a menu bar

- **WHEN** a configured application shortcut or `Ctrl+Shift+C` is pressed in a secondary window on Windows or Linux
- **THEN** the command or terminal copy is dispatched as it is in a project-host window

#### Scenario: macOS global menu

- **WHEN** any Terminay window is focused on macOS
- **THEN** the single global application menu is shown as before
