# Workspace and project tabs

## Summary

Terminay organizes work as project tabs. A project has an optional root folder,
name, colour, icon, per-project navigation state, and a Dockview layout holding
terminal, file, and folder panels. Projects and panels are movable without
turning a terminal title into an identity boundary.

## User contract

- Users can create, rename, reorder, close, and colour/icon project tabs.
- A project root can be selected directly or derived from the active terminal's
  working directory. Closing the final panel closes the project; closing the
  first project does not unexpectedly quit the app.
- New terminals open in the active project. Tabs can split the active layout
  horizontally or vertically, be reordered, moved to another project, or popped
  out into a native window.
- Project tabs can be dragged between native windows. The receiving window shows
  an insertion target, adopts the project and its panels, and preserves live PTY
  ownership/scrollback through the Electron session bridge.
- Files and folders opened from project navigation become dockable panels in the
  relevant project. Closing a panel must dispose only that panel's resources;
  terminal termination is explicit terminal lifecycle behaviour.

## Boundaries and persistence

Project layout and presentation state are local app state. A project is a UI
and navigation boundary, while an Electron terminal session remains the stable
identity used by services. Remote and MCP scopes are derived from the owning
window/project at the main-process boundary, never from tab labels.

## Acceptance outcomes

- Multi-project work remains independent when roots, tabs, layouts, or sidebar
  settings change.
- Moving or popping a project does not duplicate a terminal session or lose its
  connection to activity, agent, recording, or remote services.
- Keyboard and menu commands operate on the active project/panel and fail
  clearly when their required target is absent.

