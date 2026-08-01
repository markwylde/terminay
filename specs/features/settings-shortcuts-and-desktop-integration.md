# Settings, shortcuts, and desktop integration

## Summary

Settings centralize server, connection-host, and temporary client preferences
for terminal rendering and input, shell launch, themes, accessibility, sidebar
and file behaviour, recordings, remote access, agents, MCP, dictation, and AI
features. The Command Bar and native menu use the same command model and
configurable keyboard accelerators.

## Behaviour

- Settings search, edit, preview where appropriate, normalize invalid legacy
  values, persist in their declared scope, and can reset to documented
  defaults.
- Server values remain authoritative for shared state. An explicitly
  classified device override (currently the dictation microphone device) wins
  only in that device's effective read; host, transient, and unknown values
  are ignored and never persisted into the server snapshot.
- Users can configure shell/startup arguments; xterm appearance, scrolling,
  accessibility, paste/cursor behaviour, theme and tab hue; file defaults;
  sidebar defaults; and shortcut bindings.
- The Command Bar searches built-in commands and saved macros. Built-ins honour
  the active panel/project requirement and display user-configured shortcuts.
- Terminay opens dedicated native windows for settings, macros, recordings, and
  tab/project editing on Desktop. Browser hosts present the same settings,
  macros, recordings, and edit-tab routes in-page with modal or route
  semantics appropriate to the viewport.
- Native menus, macOS/Linux integration, external links, reveal actions, and
  application lifecycle are coordinated by Electron. Browser hosts provide a
  visible in-page menu bar for File, Edit, View, and Help so shared commands
  remain discoverable without native application menus.
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
the transport-neutral `SettingsClient`; a host compatibility adapter may bridge
legacy preload calls during migration, but shared components do not subscribe
to preload events directly.
File-panel diff-layout changes use the same settings command facade and remain
server-authoritative across the shared UI hosts.

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
- Web menu actions and tab/project double-click editing open the in-page
  settings, macros, recordings, or edit-tab route instead of no-oping when
  native windows are unavailable.
- Server setting changes are revisioned and reach every authorized connected
  client without exposing secret values.
