# Settings, shortcuts, and desktop integration

## Summary

Settings centralize server, connection-host, and temporary client preferences
for terminal rendering and input, shell launch, themes, accessibility, sidebar
and file behaviour, recordings, remote access, agents, MCP, dictation, and AI
features. The Command Bar and native menu use the same command model and
configurable keyboard accelerators.

## Behaviour

- Settings search, edit, preview where appropriate, reject or normalize invalid
  persisted values, persist in their declared scope, and can reset to
  documented defaults.
- Server values remain authoritative for shared state. An explicitly
  classified device override (currently the dictation microphone device) wins
  only in that device's effective read; host, transient, and unknown values
  are ignored and never persisted into the server snapshot.
- Users manage server-owned
  [shell profiles and terminal launch](./shell-profiles-and-terminal-launch.md),
  including server/project defaults, structured arguments and environment,
  discovered profile availability, and new-terminal cwd policy; they also
  configure xterm appearance, scrolling, accessibility, paste/cursor behaviour,
  theme and tab hue, file defaults, sidebar defaults, and shortcut bindings.
- The Command Bar searches built-in commands and saved macros. Built-ins honour
  the active panel/project requirement and display user-configured shortcuts.
- The server-bundled UI requests semantic secondary-route presentation.
  Desktop opens dedicated native windows for settings (including its
  Extensions section), project-environment management, macros, and recordings,
  and uses modal editing only for tab/project editing, when its negotiated
  `nativeWindows` capability is present. Browser hosts and compatible Desktop
  shells without that capability present the same routes in-page with route or
  editing semantics appropriate to the viewport.
- Native menus, macOS/Linux integration, external links, reveal actions, and
  application lifecycle are coordinated by Electron. Browser hosts provide a
  visible in-page menu bar for File, Edit, View, and Help so shared commands
  remain discoverable without native application menus.
- In a macOS Desktop terminal, **Cmd+V** uses the bound Electron smart-paste
  route, not renderer Clipboard API read permission. It inserts copied file
  paths or text directly and materializes an image-only clipboard item as a
  temporary PNG whose shell-escaped path is inserted. This capability is
  available only during an active user gesture; browser terminals retain their
  exact-origin text paste route.
- Host capability negotiation selects exactly one application-menu
  presentation. Desktop uses its native menu and the shared renderer does not
  render the browser menu bar. Browser hosts render the in-page menu. On macOS,
  project controls respect the native title-bar/traffic-light inset and never
  overlap either native chrome or an in-page menu.
- File and the Command Bar expose **Create a new terminal tab**, **Create a
  new project**, then the management surfaces **Remote Control**, **Project
  Environments…**, **Extensions…**, **Macros**, **Recordings**, and
  **Settings** through the same semantic route/command model. **Remote
  Control** opens or focuses the connection-management window on Desktop.
  **Project Environments…** opens or focuses its dedicated management window
  on Desktop; **Extensions…** opens or focuses the established Settings window
  at the Extensions section. Web uses the corresponding in-page routes. These
  surfaces manage the selected Terminay Server or host connection list as
  specified, not project/tab editor sheet chrome.
- Closing Terminay proceeds immediately when every terminal is at its shell
  prompt. If any terminal in any open project has a non-shell foreground
  process, Desktop reports the affected terminal count and asks whether to
  **Quit Terminay** or **Keep Running**. **Keep Running** is the default and
  cancel action. One accepted quit enters graceful shutdown without showing a
  second confirmation.
- The app periodically checks the GitHub release endpoint and surfaces available
  updates without downloading or installing software implicitly.

## Privacy and persistence

[Server-owned workspace state](./server-owned-workspace-state.md) classifies
settings by authority:

- server settings for shells, workspace behaviour, files/Git, recordings,
  agents, AI, macros, secrets, and exposure;
- connection-host settings for remembered server metadata, native window
  geometry, and inherently device-specific behaviour; and
- transient client state that is not persisted as product configuration.

Terminay Desktop continues to own native menus, windows, updater, clipboard,
dialogs, and OS credential storage. Shared settings/recordings/edit components
can render as native auxiliary windows on Desktop or in-page routes on web.
The shared terminal-settings hook reads and observes server settings through
the transport-neutral `SettingsClient` bundled with the selected server UI;
the host bridge never answers or translates server settings operations. Shared
components do not subscribe to preload events directly.
No legacy terminal-settings preload global or snapshot adapter exists; missing
selected-server settings authority is reported as unavailable rather than
falling back to device-local settings.
File-panel diff-layout changes use the same settings command facade and remain
server-authoritative across the shared UI hosts.
File-extension defaults saved in Settings are observed by already-mounted
Desktop and browser workspaces through that same selected-server client; the
file panel must not consult a separate browser-local settings snapshot.
Macro definitions and secret actions likewise require an explicitly supplied
selected-server client. There is no ambient macro compatibility context or
preload-shaped fallback; a host without secret capability returns a typed
unavailable error while macro definitions remain server-authoritative.

API keys and other secrets use the appropriate server or client vault and are
never returned as plaintext after being saved. Settings that enable
integrations describe their data exposure and remain opt-in where they capture
or transmit content. The server vault reports only lock/availability state,
revision, and secret metadata (identifier, label, configured state, and
version). Set, replace, test, delete, and key-rotation operations run inside
the server vault; a secret is available to server code only through a scoped
callback and is never part of a settings snapshot, protocol response, or
diagnostic record.
Vault set/replace/test/delete/rotation operations are revisioned and expose
only metadata. `restartLock` is an explicit host lifecycle boundary, and
adapter/decryption failures are converted to bounded operation codes without
forwarding paths, provider messages, or plaintext.

## Acceptance outcomes

- A setting change reaches every affected open renderer predictably.
- Keyboard accelerators reject reserved/invalid combinations and do not conflict
  with text entry unexpectedly.
- Desktop actions preserve window/project/session boundaries.
- Extensions appear within the ordinary Settings navigation, and all extension
  commands focus that section rather than creating an Extensions-only modal.
- Project Environments and Remote Control open as reusable management windows
  consistent with Settings, Macros, and Recordings on Desktop and as the
  equivalent shared in-page routes on web.
- An idle application closes without a warning. When foreground work exists,
  dismissing the close alert or choosing **Keep Running** leaves every project
  and terminal running, while choosing **Quit Terminay** performs the normal
  graceful application shutdown.
- Embedded Desktop AI metadata failures cross the authenticated server bridge
  as bounded, user-facing provider errors. The bridge does not expose raw
  provider stdout or stderr and does not collapse actionable errors into an
  opaque command-dispatch failure.
- AI model discovery, dictation credentials, Parakeet runtime management, and
  transcription belong to the selected Terminay Server. The renderer may use
  the browser media API to capture microphone audio, but Desktop exposes no
  feature-aware AI or dictation preload global and owns no provider fallback.
- Web menu actions and tab/project double-click editing open the in-page
  settings, macros, recordings, or edit-tab route instead of no-oping when
  native windows are unavailable.
- A Desktop workspace has one native application menu and no in-page
  File/Edit/View/Help bar. The equivalent browser workspace has the in-page
  menu and no native-only commands.
- Server setting changes are revisioned and reach every authorized connected
  client without exposing secret values.
