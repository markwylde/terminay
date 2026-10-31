## MODIFIED Requirements

### Requirement: Native menu bar only on project windows

On Windows and Linux, Terminay Desktop SHALL attach the native application menu only to project-host workspace windows. On Linux a project-host window SHALL show it as a menu bar. On Windows, where Terminay draws the title bar, a project-host window SHALL reach the same menu from its title-bar menu button and from a bare Alt press. Every other Desktop window SHALL have no native menu. That includes auxiliary settings, macros, recordings and edit windows, terminal pop-out windows, and transient helper windows. This SHALL hold for the whole life of each window, including after the application menu is rebuilt because settings or keyboard shortcuts changed. A window with no menu SHALL still dispatch configured application keyboard shortcuts and the terminal copy accelerator. On macOS, the single global application menu SHALL be unchanged.

#### Scenario: Project window shows the menu bar

- **WHEN** a project-host workspace window opens on Linux
- **THEN** it shows the native Terminay, Edit, View, Window and Help menu bar

#### Scenario: Project window on Windows reaches the menu

- **WHEN** a project-host workspace window opens on Windows
- **THEN** its title bar has a menu button that opens the native application menu, with the same menus Linux shows in its menu bar

#### Scenario: Settings window has no menu bar

- **WHEN** the Settings auxiliary window opens on Windows or Linux
- **THEN** it has no native menu bar and no menu button

#### Scenario: Other secondary windows have no menu bar

- **WHEN** a macros, recordings, edit-tab or terminal pop-out window opens on Windows or Linux
- **THEN** it has no native menu bar and no menu button

#### Scenario: Menu rebuild does not re-attach the bar

- **WHEN** a keyboard shortcut or other setting changes while a secondary window is open on Windows or Linux, and the application menu is rebuilt
- **THEN** project-host windows reach the rebuilt menu and the secondary window still has no menu

#### Scenario: Shortcuts in a window without a menu bar

- **WHEN** a configured application shortcut or `Ctrl+Shift+C` is pressed in a secondary window on Windows or Linux
- **THEN** the command or terminal copy is dispatched as it is in a project-host window

#### Scenario: macOS global menu

- **WHEN** any Terminay window is focused on macOS
- **THEN** the single global application menu is shown as before

## ADDED Requirements

### Requirement: Windows title-bar menu button

On Windows, a project-host Desktop window SHALL draw a menu button at the left end of its title bar, before the sidebar and home controls. Pressing it SHALL open the native application menu as a dropdown anchored below the button, with every menu and command the application menu holds, including native-only commands. Pressing and releasing Alt with no other key between SHALL open the same dropdown, and pressing Alt or Escape while it is open SHALL close it. A key chord that includes Alt, such as Alt+B sent to a shell, SHALL NOT open the menu. The request to open the menu SHALL carry no command. Main SHALL open its own application menu in the window that asked, so the renderer never names or runs a native command through this path.

#### Scenario: Open the menu from the button

- **WHEN** a user presses the menu button in a Windows project window
- **THEN** the native application menu opens below the button, listing Terminay, Edit, View, Window and Help

#### Scenario: Open the menu with Alt

- **WHEN** a user presses and releases Alt alone in a Windows project window, including while a terminal has focus
- **THEN** the same menu opens, and the terminal receives no input

#### Scenario: An Alt chord is not a menu request

- **WHEN** a user presses Alt+B in a focused terminal on Windows
- **THEN** the terminal receives Alt+B and no menu opens

#### Scenario: Not on other platforms

- **WHEN** a project window opens on macOS or Linux, or in a browser host
- **THEN** no title-bar menu button is drawn

### Requirement: One scrollbar style

Every scrollable surface the shared renderer draws, in Desktop and browser hosts alike, SHALL use one thin scrollbar style with a thumb and no arrow buttons, the same style the terminal's scrollbar uses. No surface SHALL show the platform's default scrollbar arrows, on Windows or any other platform.

#### Scenario: Terminal scrollbar on Windows

- **WHEN** a terminal on Windows has scrollback
- **THEN** its scrollbar shows a thumb and no arrow at either end

#### Scenario: Other panes

- **WHEN** a sidebar, settings page, file viewer or menu list overflows
- **THEN** its scrollbar has the same thin arrowless style as the terminal's

### Requirement: Windows secondary windows have a native frame

On Windows, only a project-host workspace window SHALL draw its own title bar. Settings, Macros, Recordings, edit windows, terminal pop-outs and About SHALL use the ordinary Windows frame, with the system title bar and its minimise, maximise and close buttons above the page, and the page SHALL reserve no band at its top for caption buttons.

#### Scenario: Settings on Windows

- **WHEN** Settings opens on Windows
- **THEN** it has the Windows title bar and caption buttons above its content, and its sidebar and header start at the top of the page with no empty band

#### Scenario: A project window keeps its own title bar

- **WHEN** a project window opens on Windows
- **THEN** its tab row is the title bar, with the caption buttons drawn over its right end
