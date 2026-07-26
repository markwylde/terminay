# Settings, shortcuts, and desktop integration

## Summary

Settings centralize local preferences for terminal rendering and input, shell
launch, themes, accessibility, sidebar and file behaviour, recordings, remote
access, agents, MCP, dictation, and AI features. The Command Bar and native menu
use the same command model and configurable keyboard accelerators.

## Behaviour

- Settings search, edit, preview where appropriate, normalize invalid legacy
  values, persist locally, and can reset to documented defaults.
- Users can configure shell/startup arguments; xterm appearance, scrolling,
  accessibility, paste/cursor behaviour, theme and tab hue; file defaults;
  sidebar defaults; and shortcut bindings.
- The Command Bar searches built-in commands and saved macros. Built-ins honour
  the active panel/project requirement and display user-configured shortcuts.
- Terminay opens dedicated native windows for settings, macros, recordings, and
  tab/project editing. Native menus, macOS/Linux integration, external links,
  reveal actions, and application lifecycle are coordinated by Electron.
- The app periodically checks the GitHub release endpoint and surfaces available
  updates without downloading or installing software implicitly.

## Privacy and persistence

Preferences and macros are local JSON state. API keys and other secrets use
Electron safe storage when supported and are never returned as plaintext after
being saved. Settings that enable integrations describe their data exposure and
remain opt-in where they capture/transmit content.

## Acceptance outcomes

- A setting change reaches every affected open renderer predictably.
- Keyboard accelerators reject reserved/invalid combinations and do not conflict
  with text entry unexpectedly.
- Desktop actions preserve window/project/session boundaries.

