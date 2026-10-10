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

The desktop host SHALL check for a newer release of its selected update
channel when it starts and at least once an hour afterwards. When a build can
install updates in place, it SHALL download a newer release in the background
and surface it only once the download is complete and verified. When it cannot,
it SHALL surface that a newer release exists and link to its release page, and
download nothing. A failed check or download SHALL be reported without
disrupting the workspace, and SHALL be retried at the next check.

#### Scenario: Update available

- **WHEN** a packaged macOS build, or a Linux build running from a writable
  AppImage, finds a newer release on its channel
- **THEN** the release is downloaded in the background without prompting
- **AND** the title-bar update action appears only after the download has been
  verified

#### Scenario: Update available on a build that cannot install in place

- **WHEN** an unpackaged build, or a Linux build that is not a writable
  AppImage, finds a newer release
- **THEN** the title-bar update action names the new version and opens its
  release page
- **AND** nothing is downloaded

#### Scenario: Check fails

- **WHEN** the release feed or a download is unreachable or malformed
- **THEN** no update action is shown for that attempt and the workspace is
  unaffected
- **AND** the next scheduled check tries again

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

### Requirement: Verified in-place update installation

A downloaded update SHALL be installed only after its SHA-512 digest matches
the digest in the channel's published update metadata. On macOS, the update
SHALL be installed only if its code signature satisfies the designated
requirement of the running application. Update metadata and payloads SHALL be
fetched over HTTPS from the project's GitHub releases only.

The title-bar action for a downloaded update SHALL read **Restart to update**
and name the version. Choosing it SHALL quit Terminay through the normal quit
path, install the update, and relaunch. A downloaded update that has not been
installed SHALL be installed when the user next quits Terminay.

#### Scenario: Restart to update

- **WHEN** the user chooses Restart to update
- **THEN** Terminay quits through its normal quit path, including any
  confirmation that path requires
- **AND** relaunches as the downloaded version

#### Scenario: Update installed on quit

- **WHEN** an update has been downloaded and the user quits Terminay without
  choosing Restart to update
- **THEN** the update is installed and the next launch runs the new version

#### Scenario: Digest mismatch

- **WHEN** a downloaded payload does not match the published SHA-512 digest
- **THEN** it is discarded, no update action is shown, and it is never
  installed

### Requirement: Release notes for an available update

When an update is available, the user SHALL be able to open a **What's new**
dialog from the update action. On the stable channel, the dialog SHALL list the
release notes of every stable release newer than the installed version, up to
and including the available one, newest first, each headed by its version and
linking to its release page. On the beta channel, it SHALL show the notes
published with the available beta build. Release notes SHALL be rendered from
Markdown into sanitized HTML with no script, no inline event handlers, no
remote resource loads, and links that open in the system browser.

#### Scenario: Several releases behind

- **WHEN** the installed version is two stable releases behind the available
  one
- **THEN** What's new shows both releases' notes, newest first

#### Scenario: Notes cannot be fetched

- **WHEN** the release notes cannot be retrieved
- **THEN** the dialog says so and links to the release page, and the update
  can still be installed

### Requirement: Update channel setting

Update channel SHALL be a device setting with the values **Stable** (the
default) and **Beta**. Stable follows tagged releases. Beta follows the rolling
`main` prerelease, whose versions are the next stable version with a `beta`
prerelease component. Changing the channel SHALL take effect at the next check,
which starts immediately. Changing channel SHALL NOT install a lower version
than the one running; the installation stays where it is until its new channel
publishes something newer.

#### Scenario: Opt in to beta

- **WHEN** the user selects the Beta update channel
- **THEN** an update check against the rolling `main` prerelease starts
  immediately

#### Scenario: Return to stable from a newer beta

- **WHEN** a Beta installation running a version newer than the latest stable
  release switches to Stable
- **THEN** no update is offered until a stable release newer than the running
  version is published

### Requirement: Manual update check

The desktop Help menu SHALL offer **Check for Updates…**. Choosing it SHALL
check the selected update channel immediately, regardless of when the last
check ran, and SHALL report the outcome in a native dialog once the check
settles. A manual check SHALL follow the same download, verification, and
installation rules as a scheduled check, and SHALL NOT install anything by
itself. The title-bar update action SHALL reflect the result of a manual check
as soon as it settles. Only the native menu SHALL be able to bypass the
scheduled pacing; a renderer SHALL NOT.

#### Scenario: Nothing newer

- **WHEN** the user chooses Check for Updates… and the channel has nothing newer
  than the running version
- **THEN** a dialog says Terminay is up to date and names the running version
  and channel

#### Scenario: Newer release found shortly after a scheduled check

- **WHEN** a scheduled check ran a minute ago and the user chooses Check for
  Updates… after a newer release was published
- **THEN** the release feed is checked again immediately
- **AND** a dialog names the newer version and says it is downloading
- **AND** the title-bar update action appears once the download is verified,
  without waiting for the next scheduled check

#### Scenario: Update already downloaded

- **WHEN** the user chooses Check for Updates… and a downloaded update is
  waiting and nothing newer exists
- **THEN** a dialog names that version and says it is ready to install

#### Scenario: Check fails

- **WHEN** the release feed is unreachable during a manual check
- **THEN** a dialog says the check failed and gives the reason
- **AND** the workspace is unaffected

#### Scenario: Check already running

- **WHEN** the user chooses Check for Updates… while a check is in flight
- **THEN** no second check starts and the dialog reports the running check's
  outcome

### Requirement: Beta channel follows stable releases

On the Beta update channel, an update check SHALL consider both the rolling
`main` prerelease and the latest stable release, and SHALL offer whichever has
the higher version by semantic-version precedence, provided it is newer than
the running version. A stable release offered on the Beta channel SHALL be
downloaded, verified, and installed exactly as it is on the Stable channel; its
What's new SHALL list the stable release notes newer than the installed version,
and its release link SHALL open the tagged release page. Offering a stable
release SHALL NOT change the update channel setting. When only one of the two
sources can be read, the check SHALL proceed with that source; the check fails
only when neither can be read.

#### Scenario: Stable release newer than the latest beta

- **WHEN** a Beta installation runs 5.8.0-beta.14, the rolling prerelease is
  5.8.0-beta.15, and the latest stable release is 5.8.0
- **THEN** 5.8.0 is offered
- **AND** What's new shows the stable release notes and links to the 5.8.0
  release page

#### Scenario: Beta newer than the latest stable release

- **WHEN** the rolling prerelease is 5.9.0-beta.3 and the latest stable release
  is 5.8.0
- **THEN** 5.9.0-beta.3 is offered with the notes published with that beta build

#### Scenario: Beta resumes after a stable release

- **WHEN** a Beta installation running stable 5.8.0 checks after `main`
  publishes 5.9.0-beta.1
- **THEN** 5.9.0-beta.1 is offered
- **AND** the update channel setting is still Beta

#### Scenario: Neither source is newer

- **WHEN** both the rolling prerelease and the latest stable release are at or
  below the running version
- **THEN** no update is offered and nothing is downloaded

#### Scenario: One source unreachable

- **WHEN** the stable release metadata cannot be read and the rolling
  prerelease is newer than the running version
- **THEN** the rolling prerelease is offered
- **AND** the check is not reported as failed

#### Scenario: Both sources unreachable

- **WHEN** neither source can be read
- **THEN** the check is reported as failed without disrupting the workspace and
  is retried at the next check

### Requirement: About window

Desktop SHALL offer **About Terminay**, in the application menu on macOS and in
the Help menu on Windows and Linux. It SHALL open a Terminay About window, not
the native About panel. The window SHALL show the Terminay logo, name, and
running version, and a restrained abstract artwork in the loading-indicator
colours that stops moving when the system asks for reduced motion. It SHALL say
Terminay is made by Mark Wylde and is open source under the GNU AGPL, version 3.0
or later. It SHALL link to terminay.com, to the source repository at
github.com/markwylde/terminay, and to the licence. The window SHALL run no
script and have no preload. It SHALL open only those links, in the default
browser, and SHALL NOT navigate itself. Only one About window SHALL be open at a
time.

#### Scenario: Opening About

- **WHEN** the user chooses About Terminay
- **THEN** the Terminay About window opens showing the running version, the
  author, the AGPL licence, and links to terminay.com and the GitHub repository

#### Scenario: Following a link

- **WHEN** the user clicks the terminay.com, repository, or licence link
- **THEN** it opens in the default browser and the About window stays as it was

#### Scenario: Unexpected navigation

- **WHEN** the About window is asked to open or navigate to any other URL
- **THEN** nothing opens and the window does not navigate

#### Scenario: About already open

- **WHEN** the user chooses About Terminay while the About window is open
- **THEN** the open window is focused and no second window opens

#### Scenario: Reduced motion

- **WHEN** the system asks for reduced motion
- **THEN** the artwork is shown without movement

### Requirement: Browser About

A browser host's in-page Help menu SHALL offer **About Terminay**. It SHALL open
a dialog over the workspace showing the same About document as the Desktop
window, with the running version of the served UI. The document SHALL run no
script, SHALL open its links only in a new browser tab, and SHALL NOT navigate
the workspace page. Escape, the close control, or a click outside the dialog
SHALL close it.

#### Scenario: Opening About in a browser

- **WHEN** the user chooses Help, About Terminay in a browser
- **THEN** the About dialog opens showing the version, the author, the AGPL
  licence, and links to terminay.com and the GitHub repository, and Settings
  does not open

#### Scenario: Following a link in a browser

- **WHEN** the user clicks a link in the browser About dialog
- **THEN** it opens in a new tab and the workspace page stays as it was

### Requirement: Change-driven desktop settings reads

Terminay Desktop SHALL serve its device-local settings from a cached parsed
value and SHALL refresh that value from change notification rather than by
re-reading the backing files on each access. A write issued by Desktop itself
SHALL invalidate the cache as part of that write, so a read taken immediately
afterwards observes the written value without waiting for a notification. When
no change notification is active for those files, Desktop SHALL read them on
every access rather than serve a value it cannot know to be current. A cached
value SHALL be indistinguishable from a fresh read: the same settings, the same
defaults when a file is absent or malformed.

#### Scenario: Repeated reads while nothing changes

- **WHEN** Desktop reads its device-local settings repeatedly and no settings
  file has changed
- **THEN** the settings are served from the cached value
- **AND** the backing files are not re-read for each access

#### Scenario: Settings file edited outside the app

- **WHEN** a device-local settings file is changed by something other than
  Desktop
- **THEN** the change notification invalidates the cache
- **AND** the next read observes the changed settings

#### Scenario: Desktop writes its own settings

- **WHEN** Desktop writes device-local settings
- **THEN** the cache is invalidated as part of that write
- **AND** a read taken immediately afterwards observes the written settings

#### Scenario: No change notification available

- **WHEN** change notification for the settings files cannot be established or
  has failed
- **THEN** Desktop reads the settings files on every access
- **AND** no cached value is served

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

### Requirement: Application icon notification badge

Terminay Desktop SHALL show the Notifications count on its application icon: on the macOS Dock tile, and on Linux through the launcher count that the desktop's launcher or taskbar reads for the application's desktop entry. The badge SHALL equal the sum, over every open native workspace window, of the number that window's header Notifications control shows, and SHALL follow that number whenever it changes. At zero the icon SHALL carry no badge. A window that closes or reloads SHALL stop contributing until it reports again. Quitting Terminay SHALL leave no badge behind.

Each native window SHALL report only a count for itself, through the closed Desktop host action bound to that window. The host SHALL accept only a non-negative integer within its documented bound and SHALL reject anything else without changing the badge. The report SHALL carry no terminal, project, or server detail.

On a Linux desktop that offers no launcher count, and on any platform without an application icon badge, the icon SHALL remain unbadged and nothing else SHALL change. Browser and installed web clients SHALL NOT report a count.

#### Scenario: Notifications arrive while Terminay is in the background
- **WHEN** three terminals need attention or have finished unviewed and Terminay is not the frontmost application
- **THEN** the application icon shows 3

#### Scenario: A notification is dismissed
- **WHEN** the icon shows 3 and one notification is dismissed or its terminal is viewed
- **THEN** the icon shows 2, matching the header

#### Scenario: The last notification clears
- **WHEN** the header Notifications count reaches zero in every window
- **THEN** the application icon carries no badge

#### Scenario: Notifications in two windows
- **WHEN** one native window's header shows 2 and another's shows 1
- **THEN** the application icon shows 3

#### Scenario: A window with notifications closes
- **WHEN** a native window whose header shows 2 is closed while another window's header shows 1
- **THEN** the application icon shows 1

#### Scenario: Invalid count
- **WHEN** a window reports a count that is negative, fractional, non-numeric, or above the bound
- **THEN** the report is rejected and the badge is unchanged

#### Scenario: Linux desktop without a launcher count
- **WHEN** Terminay runs on a Linux desktop whose launcher does not implement a launcher count
- **THEN** the icon is unbadged and Terminay otherwise behaves the same

#### Scenario: Terminay quits with notifications outstanding
- **WHEN** Terminay quits while the icon shows a count
- **THEN** the icon carries no badge afterwards

### Requirement: Server-authoritative file and macro definitions

File-panel diff-layout changes SHALL use the same settings command facade and SHALL remain server-authoritative across the shared UI hosts. File-extension defaults saved in Settings SHALL be observed by already-mounted Desktop and browser workspaces through that same selected-server client, and the file panel SHALL NOT consult a separate browser-local settings snapshot. Macro definitions and categories SHALL require an explicitly supplied selected-server client; there SHALL be no ambient macro compatibility context or preload-shaped fallback. The macro settings client SHALL expose macro definitions and categories only, and no host SHALL offer it a secret action.

#### Scenario: File-extension default changed

- **WHEN** a file-extension default is saved in Settings
- **THEN** already-mounted Desktop and browser workspaces observe it through the selected-server client

#### Scenario: Macro settings client surface

- **WHEN** the Macros window is given its selected-server client on any host
- **THEN** the client reads, replaces, resets, and observes macro definitions and categories, and exposes no operation that reads, saves, or deletes a secret
