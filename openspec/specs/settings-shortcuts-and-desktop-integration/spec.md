# settings-shortcuts-and-desktop-integration Specification

## Purpose

Settings centralize server, connection-host, and temporary client preferences for terminal rendering and input, shell launch, themes, accessibility, sidebar and file behaviour, recordings, remote access, agents, MCP, dictation, AI features, and Desktop diagnostics. The Command Bar and native menu use the same command model and configurable keyboard accelerators.

## Requirements

### Requirement: Settings behaviour and validation

Settings SHALL support search, editing, and preview where appropriate. They SHALL reject or normalize invalid persisted values, persist in their declared scope, and be resettable to documented defaults.

#### Scenario: Invalid persisted value

- **WHEN** a persisted setting value is invalid
- **THEN** it is rejected or normalized rather than applied as-is

#### Scenario: Resetting a setting

- **WHEN** a user resets a setting
- **THEN** it returns to its documented default

#### Scenario: Searching settings

- **WHEN** a user searches Settings
- **THEN** matching settings are found and can be edited, with preview where appropriate

### Requirement: Server authority and device overrides

Server values SHALL remain authoritative for shared state. An explicitly classified device override SHALL win only in that device's effective read; the dictation microphone device is currently the only such override. Host, transient, and unknown values SHALL be ignored and SHALL NOT be persisted into the server snapshot.

#### Scenario: Device override applied

- **WHEN** a device has an explicitly classified device override such as the dictation microphone device
- **THEN** that value wins in that device's effective read only

#### Scenario: Unknown value offered

- **WHEN** a host, transient, or unknown value is offered for the server snapshot
- **THEN** it is ignored and not persisted

### Requirement: Configurable settings surface

Users SHALL be able to manage server-owned shell profiles and terminal launch, including server and project defaults, structured arguments and environment, discovered profile availability, and new-terminal cwd policy. They SHALL also configure xterm appearance, scrolling, accessibility, paste and cursor behaviour, theme and tab hue, file defaults, sidebar defaults, and shortcut bindings.

#### Scenario: Configuring shell launch

- **WHEN** a user edits shell profile settings
- **THEN** server and project defaults, structured arguments and environment, discovered profile availability, and new-terminal cwd policy are configurable

#### Scenario: Configuring appearance and input

- **WHEN** a user opens Settings
- **THEN** xterm appearance, scrolling, accessibility, paste and cursor behaviour, theme and tab hue, file defaults, sidebar defaults, and shortcut bindings are configurable

### Requirement: Desktop diagnostics category

Desktop Settings SHALL expose a **Diagnostics** category whose Performance logging toggle is a device-local Desktop preference, off by default, and writes only to the local Diagnostics folder. Browser hosts SHALL omit that category.

#### Scenario: Desktop diagnostics toggle

- **WHEN** a user enables Performance logging in Desktop Settings
- **THEN** the device-local preference is set and output is written only to the local Diagnostics folder

#### Scenario: Browser host

- **WHEN** Settings is opened in a browser host
- **THEN** the Diagnostics category is not present

### Requirement: Show Dashboard command

**Show Dashboard** SHALL be a first-class application command that selects the Home dashboard in the focused workspace view. It SHALL appear in the View menu on Desktop and in the browser host's in-page menu, SHALL be searchable in the Command Bar, and SHALL be rebindable in the shortcut settings surface like every other command, with a default accelerator of `CmdOrCtrl+0`. It SHALL require no active panel and SHALL remain available when a workspace view holds no projects.

#### Scenario: Invoking the command

- **WHEN** a user invokes **Show Dashboard**
- **THEN** the focused workspace view selects the Home dashboard

#### Scenario: Default accelerator

- **WHEN** a user has not rebound the command
- **THEN** `CmdOrCtrl+0` invokes it and the shortcut settings surface shows it as the default

#### Scenario: No projects open

- **WHEN** a workspace view holds no projects
- **THEN** **Show Dashboard** is still available and still selects the Home dashboard

### Requirement: Command Bar contents

The Command Bar SHALL search built-in commands, saved macros, and places. Built-ins SHALL honour the active panel and project requirement and SHALL display user-configured shortcuts. Commands that act on the workspace view rather than a panel, including **Show Dashboard**, SHALL remain available when no panel or project is active.

Places SHALL be Home's sections and every project, tab, and agent of every attached connection, and every automation of every connection that serves automations. Place matching SHALL be case-insensitive substring matching over names, SHALL rank a match at the start of a name or word above one elsewhere, and SHALL return nothing for an empty search, so that the Command Bar opens showing commands and macros alone. Results SHALL be grouped, with commands and macros first and then places by kind — sections, projects, tabs, agents, automations — each kind bounded. Choosing a place SHALL go to it: a section opens as a Home tab, a project or tab is activated as a dashboard row is, an agent as a dashboard agent is, and an automation opens in its Home tab. With more than one connection attached, a place SHALL name the server it belongs to.

The Command Bar SHALL open whichever view is selected, including Home and a window that holds no project. A command that requires a project SHALL be left out of the results when no project is in front: while Home is selected, and when the window holds no project.

#### Scenario: Searching the Command Bar

- **WHEN** a user searches the Command Bar
- **THEN** built-in commands and saved macros are returned with their user-configured shortcuts shown

#### Scenario: Command requiring an active panel

- **WHEN** a built-in command requires an active panel or project that is not present
- **THEN** the command honours that requirement rather than running

#### Scenario: View-scoped command without an active panel

- **WHEN** a user runs **Show Dashboard** with no active panel
- **THEN** it runs rather than being withheld

#### Scenario: Finding a tab in another project

- **WHEN** a user types part of a tab's title into the Command Bar and chooses that tab
- **THEN** the Command Bar closes, that tab's project is selected, and the tab is focused

#### Scenario: Finding an automation

- **WHEN** a user types part of an automation's name into the Command Bar while a project is in front and chooses it
- **THEN** Home is selected and that automation's tab is in front

#### Scenario: Opening with nothing typed

- **WHEN** a user opens the Command Bar and has typed nothing
- **THEN** commands and macros are listed and no places are

#### Scenario: Opening on Home

- **WHEN** a user presses the Command Bar shortcut while Home is selected
- **THEN** the Command Bar opens over Home, lists view-scoped commands, and lists no command that requires a project

#### Scenario: No project in the window

- **WHEN** a user opens the Command Bar in a window that holds no project
- **THEN** it opens, lists view-scoped commands and places, and lists no command that requires a project

### Requirement: Semantic secondary-route presentation

The server-bundled UI SHALL request semantic secondary-route presentation. When its negotiated `nativeWindows` capability is present, Desktop SHALL open dedicated native windows for settings — including its Extensions section — macros, and recordings, and SHALL use modal editing only for tab and project editing. Browser hosts and compatible Desktop shells without that capability SHALL present the same routes in-page with route or editing semantics appropriate to the viewport.

#### Scenario: Desktop with native windows

- **WHEN** the Desktop host negotiates the `nativeWindows` capability
- **THEN** settings, macros, and recordings open as dedicated native windows and only tab and project editing use modals

#### Scenario: Host without native windows

- **WHEN** a browser host or a Desktop shell without that capability requests the same routes
- **THEN** they are presented in-page with route or editing semantics appropriate to the viewport

### Requirement: Application menu presentation

Native menus, macOS and Linux integration, external links, reveal actions, and application lifecycle SHALL be coordinated by Electron. Browser hosts SHALL provide a visible in-page menu bar for File, Edit, View, and Help so shared commands remain discoverable without native application menus. Host capability negotiation SHALL select exactly one application-menu presentation: Desktop SHALL use its native menu and the shared renderer SHALL NOT render the browser menu bar, while browser hosts SHALL render the in-page menu. On macOS, project controls SHALL respect the native title-bar and traffic-light inset and SHALL NOT overlap either native chrome or an in-page menu.

#### Scenario: Desktop workspace menus

- **WHEN** a Desktop workspace renders
- **THEN** it has one native application menu and no in-page File/Edit/View/Help bar

#### Scenario: Browser workspace menus

- **WHEN** a browser workspace renders
- **THEN** it has the in-page menu bar and no native-only commands

#### Scenario: macOS chrome insets

- **WHEN** a macOS workspace renders project controls
- **THEN** they respect the native title-bar and traffic-light inset and overlap neither native chrome nor an in-page menu

### Requirement: macOS smart paste in the terminal

In a macOS Desktop terminal, **Cmd+V** SHALL use the bound Electron smart-paste route rather than renderer Clipboard API read permission. It SHALL insert copied file paths or text directly and SHALL materialize an image-only clipboard item as a temporary PNG whose shell-escaped path is inserted. This capability SHALL be available only during an active user gesture. Browser terminals SHALL retain their exact-origin text paste route.

#### Scenario: Pasting text or a file path

- **WHEN** a user presses Cmd+V in a macOS Desktop terminal with text or a file path on the clipboard
- **THEN** the value is inserted through the Electron smart-paste route

#### Scenario: Pasting an image

- **WHEN** the clipboard holds only an image
- **THEN** it is materialized as a temporary PNG and its shell-escaped path is inserted

#### Scenario: No active user gesture

- **WHEN** no active user gesture is in progress
- **THEN** the smart-paste capability is unavailable

#### Scenario: Browser terminal paste

- **WHEN** a user pastes into a browser terminal
- **THEN** the exact-origin text paste route is used

### Requirement: Management surface commands

File and the Command Bar SHALL expose **Create a new terminal tab**, **Create a new project**, and then the management surfaces **Remote Control**, **Extensions…**, **Macros**, **Recordings**, and **Settings** through the same semantic route and command model. **Remote Control** SHALL open or focus the connection-management window on Desktop, and **Extensions…** SHALL open or focus the established Settings window at the Extensions section. Web SHALL use the corresponding in-page routes. These surfaces SHALL manage the selected Terminay Server or host connection list, not project or tab editor sheet chrome.

#### Scenario: Opening Remote Control on Desktop

- **WHEN** a user invokes **Remote Control** on Desktop
- **THEN** the connection-management window opens or is focused

#### Scenario: Opening Extensions

- **WHEN** a user invokes **Extensions…**
- **THEN** the established Settings window opens or is focused at the Extensions section

#### Scenario: Web management routes

- **WHEN** a user invokes any management surface on the web host
- **THEN** the corresponding in-page route opens

### Requirement: Application close confirmation

Closing Terminay SHALL proceed immediately when every terminal is at its shell prompt. If any terminal in any open project has a non-shell foreground process, Desktop SHALL report the affected terminal count and ask whether to **Quit Terminay** or **Keep Running**. **Keep Running** SHALL be the default and cancel action. One accepted quit SHALL enter graceful shutdown without showing a second confirmation.

#### Scenario: Idle application closes

- **WHEN** every terminal is at its shell prompt and the user closes Terminay
- **THEN** the application closes without a warning

#### Scenario: Foreground work present

- **WHEN** any terminal in any open project has a non-shell foreground process and the user closes Terminay
- **THEN** Desktop reports the affected terminal count and offers **Quit Terminay** or **Keep Running**, with **Keep Running** as the default and cancel action

#### Scenario: Keep Running chosen

- **WHEN** the user dismisses the close alert or chooses **Keep Running**
- **THEN** every project and terminal keeps running

#### Scenario: Quit accepted

- **WHEN** the user chooses **Quit Terminay**
- **THEN** graceful shutdown proceeds without a second confirmation

### Requirement: Update availability checks

The app SHALL periodically check the GitHub release endpoint and surface available updates without downloading or installing software implicitly.

#### Scenario: Update available

- **WHEN** the periodic check finds a newer release
- **THEN** the update is surfaced without downloading or installing it implicitly

### Requirement: Settings classification by authority

Server-owned workspace state SHALL classify settings by authority: server settings for shells, workspace behaviour, files and Git, recordings, agents, AI, macros, secrets, and exposure; connection-host settings for remembered server metadata, native window geometry, and inherently device-specific behaviour; and transient client state that is not persisted as product configuration.

#### Scenario: Classifying a setting

- **WHEN** a setting is persisted
- **THEN** it is stored in its declared server, connection-host, or transient scope

### Requirement: Desktop host ownership

Terminay Desktop SHALL own native menus, windows, updater, clipboard, dialogs, and OS credential storage. Shared settings, recordings, and edit components SHALL be able to render as native auxiliary windows on Desktop or in-page routes on web.

#### Scenario: Shared component presentation

- **WHEN** a shared settings, recordings, or edit component renders
- **THEN** it appears as a native auxiliary window on Desktop or an in-page route on web

### Requirement: Server settings client boundary

The shared terminal-settings hook SHALL read and observe server settings through the transport-neutral `SettingsClient` held for the connection whose server is selected. The host bridge SHALL NOT answer or translate server settings operations. Shared components SHALL NOT subscribe to preload events directly. No terminal-settings preload global or snapshot adapter SHALL exist, and a missing settings authority on the selected connection SHALL be reported as unavailable rather than falling back to device-local settings or to another connection.

#### Scenario: Reading server settings

- **WHEN** a shared component reads or observes server settings
- **THEN** it uses the `SettingsClient` of the connection whose server is selected

#### Scenario: Settings authority missing

- **WHEN** the selected server's settings authority is unavailable
- **THEN** the condition is reported as unavailable and no device-local fallback is used

#### Scenario: Another connection is not a fallback

- **WHEN** the selected connection cannot answer a settings operation
- **THEN** the operation is not retried on any other attached connection

### Requirement: Server-authoritative file and macro settings

File-panel diff-layout changes SHALL use the same settings command facade and SHALL remain server-authoritative across the shared UI hosts. File-extension defaults saved in Settings SHALL be observed by already-mounted Desktop and browser workspaces through that same selected-server client, and the file panel SHALL NOT consult a separate browser-local settings snapshot. Macro definitions and secret actions SHALL require an explicitly supplied selected-server client; there SHALL be no ambient macro compatibility context or preload-shaped fallback. A host without secret capability SHALL return a typed unavailable error while macro definitions remain server-authoritative.

#### Scenario: File-extension default changed

- **WHEN** a file-extension default is saved in Settings
- **THEN** already-mounted Desktop and browser workspaces observe it through the selected-server client

#### Scenario: Host lacks secret capability

- **WHEN** a secret action runs on a host without secret capability
- **THEN** a typed unavailable error is returned and macro definitions remain server-authoritative

### Requirement: Secret storage and vault disclosure

API keys and other secrets SHALL use the appropriate server or client vault and SHALL NOT be returned as plaintext after being saved. Settings that enable integrations SHALL describe their data exposure and SHALL remain opt-in where they capture or transmit content. The server vault SHALL report only lock and availability state, revision, and secret metadata — identifier, label, configured state, and version. Set, replace, test, delete, and key-rotation operations SHALL run inside the server vault. A secret SHALL be available to server code only through a scoped callback and SHALL NOT be part of a settings snapshot, protocol response, or diagnostic record.

#### Scenario: Reading a saved secret

- **WHEN** a client reads vault state after a secret is saved
- **THEN** it receives only lock and availability state, revision, and secret metadata, never plaintext

#### Scenario: Integration disclosure

- **WHEN** a setting enables an integration that captures or transmits content
- **THEN** it describes its data exposure and remains opt-in

### Requirement: Vault operation boundaries

Vault set, replace, test, delete, and rotation operations SHALL be revisioned and SHALL expose only metadata. `restartLock` SHALL be an explicit host lifecycle boundary. Adapter and decryption failures SHALL be converted to bounded operation codes without forwarding paths, provider messages, or plaintext.

#### Scenario: Vault operation performed

- **WHEN** a set, replace, test, delete, or rotation operation runs
- **THEN** it is revisioned and returns only metadata

#### Scenario: Adapter or decryption failure

- **WHEN** a vault adapter or decryption failure occurs
- **THEN** it is converted to a bounded operation code without forwarding paths, provider messages, or plaintext

### Requirement: Setting propagation and accelerator validation

A setting change SHALL reach every affected open renderer predictably. Server setting changes SHALL be revisioned and SHALL reach every authorized connected client without exposing secret values. Keyboard accelerators SHALL reject reserved and invalid combinations and SHALL NOT conflict with text entry unexpectedly. Desktop actions SHALL preserve window, project, and session boundaries.

#### Scenario: Setting changed

- **WHEN** a server setting changes
- **THEN** the change is revisioned and reaches every affected open renderer and authorized connected client without exposing secret values

#### Scenario: Reserved accelerator

- **WHEN** a user binds a reserved or invalid key combination
- **THEN** the binding is rejected

### Requirement: Extensions presentation in Settings

Extensions SHALL appear within the ordinary Settings navigation, and all extension commands SHALL focus that section rather than creating an Extensions-only modal. Remote Control SHALL open as a reusable management window consistent with Settings, Macros, and Recordings on Desktop, and as the equivalent shared in-page route on web.

#### Scenario: Extension command invoked

- **WHEN** any extension command is invoked
- **THEN** the Settings window focuses its Extensions section and no Extensions-only modal is created

#### Scenario: Management window reuse

- **WHEN** Remote Control is invoked repeatedly on Desktop
- **THEN** the same reusable management window is focused, consistent with Settings, Macros, and Recordings

### Requirement: Embedded Desktop AI bridge error fidelity

Embedded Desktop AI metadata failures SHALL cross the authenticated server bridge as bounded, user-facing provider errors. The bridge SHALL NOT expose raw provider stdout or stderr and SHALL NOT collapse actionable errors into an opaque command-dispatch failure.

#### Scenario: Provider failure on embedded Desktop

- **WHEN** an AI metadata request fails on embedded Desktop
- **THEN** a bounded, user-facing provider error crosses the authenticated server bridge
- **AND** no raw provider stdout or stderr is exposed and the error is not collapsed into an opaque command-dispatch failure

### Requirement: Server ownership of AI and dictation capabilities

AI model discovery, dictation credentials, Parakeet runtime management, and transcription SHALL belong to the selected Terminay Server. The renderer MAY use the browser media API to capture microphone audio, but Desktop SHALL expose no feature-aware AI or dictation preload global and SHALL own no provider fallback.

#### Scenario: Renderer capability scope

- **WHEN** dictation or AI features run
- **THEN** the renderer only captures microphone audio through the browser media API
- **AND** model discovery, credentials, Parakeet runtime management, and transcription run on the selected server

#### Scenario: No Desktop provider fallback

- **WHEN** a server AI or dictation capability is unavailable
- **THEN** Desktop provides no preload global and no provider fallback

### Requirement: Web route parity for menu and editing actions

Web menu actions and tab or project double-click or long-press editing SHALL open the in-page settings, macros, recordings, or edit-tab route instead of doing nothing when native windows are unavailable.

#### Scenario: Editing a tab on web

- **WHEN** a user double-clicks or long-presses a tab or project on the web host
- **THEN** the in-page edit-tab route opens

#### Scenario: Web menu action without native windows

- **WHEN** a web menu action targets settings, macros, or recordings
- **THEN** the corresponding in-page route opens rather than no-oping

### Requirement: Settings and Extensions surfaces select a server

The Settings surface, including its Extensions section, SHALL carry a server
selector listing every attached connection. It SHALL default to the server that
owns the active project tab, and it SHALL present the settings, secrets, and
extension inventory of exactly the selected server. Values from two servers SHALL
NEVER be merged, summed, or shown as one list, and a change SHALL be committed
only on the selected server. Selecting a connection that is unavailable or
incompatible SHALL show that connection's state instead of settings.

#### Scenario: Default selection

- **WHEN** the user opens Settings while a project of an attached server is active
- **THEN** the server selector starts on that server and shows its settings

#### Scenario: Switching servers

- **WHEN** the user selects another attached connection
- **THEN** the surface shows only that server's settings and extensions, and no
  value from the previous server remains visible

#### Scenario: Editing applies to one server

- **WHEN** the user changes a setting while a server is selected
- **THEN** the change is committed on that server alone and no other attached
  server's settings change

#### Scenario: Selected connection is unavailable

- **WHEN** the selected connection is offline or incompatible
- **THEN** the surface reports that connection's state and sends it no settings
  operation

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

### Requirement: Open Command Bar command reach

**Open Command Bar** SHALL be reachable without a keyboard on every host. It SHALL appear in the Desktop application menu and in the browser host's in-page menu, and SHALL be rebindable in the shortcut settings surface like every other command, with a default accelerator of `CmdOrCtrl+L`. On a host with no keyboard it SHALL additionally be reachable from a workspace chrome control, because it is the only route to the commands and macros the compact chrome draws no control for.

#### Scenario: Browser host in-page menu
- **WHEN** a user opens the browser host's View menu
- **THEN** **Open Command Bar** is listed there and invoking it opens the Command Bar

#### Scenario: Desktop native menu
- **WHEN** a user opens the Desktop application menu
- **THEN** **Open Command Bar** is listed there with its configured accelerator

#### Scenario: A host with no keyboard
- **WHEN** a workspace is presented on a host that cannot send `CmdOrCtrl+L`
- **THEN** a chrome control opens the Command Bar without any keystroke

### Requirement: Editing commands

Tab editing and project editing SHALL be first-class application commands. **Edit Active Tab** SHALL open the editor for the terminal, file, or folder tab in front, and **Edit Active Project** SHALL open the editor for the project in front. Both SHALL be searchable in the Command Bar, SHALL appear in the Desktop application menu and in the browser host's in-page menu, and SHALL be rebindable in the shortcut settings surface like every other command, with no default accelerator. Each SHALL open the same editor its direct gesture opens, in the current host's auxiliary-route presentation, so an editor is never reachable by gesture alone.

#### Scenario: Editing the tab in front
- **WHEN** a user invokes **Edit Active Tab** with a tab in front
- **THEN** that tab's editor opens, the same editor a double-click or long-press on it opens

#### Scenario: Editing the project in front
- **WHEN** a user invokes **Edit Active Project** with a project in front
- **THEN** that project's editor opens, the same editor a long press on its switcher heading opens

#### Scenario: Nothing in front
- **WHEN** a user invokes **Edit Active Tab** with no tab in front
- **THEN** no editor opens and the workspace reports that a tab must be open first

#### Scenario: Searchable in the Command Bar
- **WHEN** a user searches the Command Bar for either command
- **THEN** it is returned with its user-configured shortcut shown

### Requirement: In-page menu commands do not depend on a binding

A host that draws its application menu in page SHALL invoke a command by naming it, not by synthesising the keystroke its accelerator would produce. A command that ships with no default binding SHALL therefore be invocable from that menu, and SHALL reach the same dispatch the Desktop native menu and the accelerator reach.

#### Scenario: An unbound command in the in-page menu
- **WHEN** a user selects an in-page menu entry for a command that has no accelerator bound
- **THEN** the command runs

#### Scenario: One dispatch for every route
- **WHEN** a command is invoked from the in-page menu, the native menu, or its accelerator
- **THEN** all three reach the same command dispatch
