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

### Requirement: Command Bar contents

The Command Bar SHALL search built-in commands and saved macros. Built-ins SHALL honour the active panel and project requirement and SHALL display user-configured shortcuts.

#### Scenario: Searching the Command Bar

- **WHEN** a user searches the Command Bar
- **THEN** built-in commands and saved macros are returned with their user-configured shortcuts shown

#### Scenario: Command requiring an active panel

- **WHEN** a built-in command requires an active panel or project that is not present
- **THEN** the command honours that requirement rather than running

### Requirement: Semantic secondary-route presentation

The server-bundled UI SHALL request semantic secondary-route presentation. When its negotiated `nativeWindows` capability is present, Desktop SHALL open dedicated native windows for settings — including its Extensions section — project-environment management, macros, and recordings, and SHALL use modal editing only for tab and project editing. Browser hosts and compatible Desktop shells without that capability SHALL present the same routes in-page with route or editing semantics appropriate to the viewport.

#### Scenario: Desktop with native windows

- **WHEN** the Desktop host negotiates the `nativeWindows` capability
- **THEN** settings, project-environment management, macros, and recordings open as dedicated native windows and only tab and project editing use modals

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

File and the Command Bar SHALL expose **Create a new terminal tab**, **Create a new project**, and then the management surfaces **Remote Control**, **Project Environments…**, **Extensions…**, **Macros**, **Recordings**, and **Settings** through the same semantic route and command model. **Remote Control** SHALL open or focus the connection-management window on Desktop. **Project Environments…** SHALL open or focus its dedicated management window on Desktop, and **Extensions…** SHALL open or focus the established Settings window at the Extensions section. Web SHALL use the corresponding in-page routes. These surfaces SHALL manage the selected Terminay Server or host connection list, not project or tab editor sheet chrome.

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

The shared terminal-settings hook SHALL read and observe server settings through the transport-neutral `SettingsClient` bundled with the selected server UI. The host bridge SHALL NOT answer or translate server settings operations. Shared components SHALL NOT subscribe to preload events directly. No terminal-settings preload global or snapshot adapter SHALL exist, and missing selected-server settings authority SHALL be reported as unavailable rather than falling back to device-local settings.

#### Scenario: Reading server settings

- **WHEN** a shared component reads or observes server settings
- **THEN** it uses the `SettingsClient` bundled with the selected server UI

#### Scenario: Settings authority missing

- **WHEN** the selected server's settings authority is unavailable
- **THEN** the condition is reported as unavailable and no device-local fallback is used

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

Extensions SHALL appear within the ordinary Settings navigation, and all extension commands SHALL focus that section rather than creating an Extensions-only modal. Project Environments and Remote Control SHALL open as reusable management windows consistent with Settings, Macros, and Recordings on Desktop, and as the equivalent shared in-page routes on web.

#### Scenario: Extension command invoked

- **WHEN** any extension command is invoked
- **THEN** the Settings window focuses its Extensions section and no Extensions-only modal is created

#### Scenario: Management window reuse

- **WHEN** Project Environments or Remote Control is invoked repeatedly on Desktop
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
