# Workspace and project tabs

## Summary

Terminay organizes work as project tabs. A project has an optional root folder,
name, colour, icon, default shell-profile override, per-project navigation
state, and a Dockview layout holding terminal, file, and folder panels. Projects
and panels are movable without turning a terminal title into an identity
boundary.

## User contract

- Users can create, rename, reorder, close, and colour/icon project tabs.
- Project creation commits its initial colour and icon atomically with the
  server-owned project so rapid creation cannot reuse an uncommitted colour.
- A project root can be selected directly or derived from the active terminal's
  working directory. Closing the final panel closes the project; closing the
  first project does not unexpectedly quit the app.
- New terminals open in the active project. Tabs can split the active layout
  horizontally or vertically, be reordered, moved to another project, or moved
  into another workspace view.
- A project can use the server's default shell profile or select a project
  default under the canonical
  [shell profiles and terminal launch](./shell-profiles-and-terminal-launch.md)
  policy. That selection affects future sessions only.
- Desktop presents workspace views as native windows. Project tabs can be
  dragged between them; web clients manage the same views in-page. Moving a
  project preserves its panels, live PTYs, scrollback, and service identities.
- Double-clicking a project tab opens project-tab editing in the current host's
  auxiliary-route presentation. Desktop may use a native modal window; web uses
  an in-page edit-tab surface. Saving updates the server-owned project name,
  root, colour, and icon; cancel leaves project state unchanged.
- Files and folders opened from project navigation become dockable panels in the
  relevant project. Closing a panel must dispose only that panel's resources;
  terminal termination is explicit terminal lifecycle behaviour.

## Boundaries and persistence

Project identity, layout, panel membership, and logical workspace views are
canonical server state under
[server-owned workspace state](./server-owned-workspace-state.md). Desktop
windows and browser views are presentations of that state. A project is a
navigation and authorization boundary, while the immutable server terminal
session id remains the identity used by services. Remote and MCP scopes derive
from authenticated server/project/session identities, never from tab labels or
client focus.

## Acceptance outcomes

- Multi-project work remains independent when roots, tabs, layouts, or sidebar
  settings change.
- Moving or popping a project does not duplicate a terminal session or lose its
  connection to activity, agent, recording, or remote services.
- Keyboard and menu commands operate on the active project/panel and fail
  clearly when their required target is absent.
- Reconnecting from a fresh client restores project and panel identity from
  server state without recreating live terminals.
