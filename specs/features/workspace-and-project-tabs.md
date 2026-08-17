# Workspace and project tabs

## Summary

Terminay organizes work as project tabs. A project has one immutable
[project environment](./project-environments.md), an optional root folder
interpreted by that environment, name, colour, icon, default shell-profile override, per-project navigation
state, and a Dockview layout holding terminal, file, and folder panels. Projects
and panels are movable where environment boundaries permit without turning a
terminal title into an identity boundary.

## User contract

- Users can create, rename, reorder, close, and colour/icon project tabs.
- The project-bar split button's primary `+` creates a project on **This
  server** immediately. Its arrow opens an accessible environment chooser with
  This server, recent SSH/Puzed targets, provider create/browse actions,
  **Project Environments…**, and **Extensions…**. Project Environments opens or
  focuses its first-class management window/route; Extensions opens or focuses
  Settings at the Extensions section. **This server** identifies the selected
  Terminay Server because it may be remote from the client.
- New projects use the selected environment profile's default root or verified
  account home. They never copy an active project root from another
  environment. Target/root validation completes before a normal tab is
  committed. A successful user-created project receives one terminal through
  the selected server's normal terminal-launch resolver; this is an explicit
  creation flow, never a renderer repair for an empty workspace.
- Project creation commits its initial colour and icon atomically with the
  server-owned project so rapid creation cannot reuse an uncommitted colour.
- A project root can be selected directly or derived from the active terminal's
  working directory. Closing the final panel closes the project; closing the
  first project does not unexpectedly quit the app.
- New terminals open in the active project. Tabs can split the active layout
  horizontally or vertically, be reordered, moved to another project, or moved
  into another workspace view.
- Dropping a terminal, file, or folder tab at a new position commits that panel
  order to canonical workspace state in both desktop and web clients; a later
  workspace refresh or reconnect preserves the dropped order.
- A project can use the server's default shell profile or select a project
  default under the canonical
  [shell profiles and terminal launch](./shell-profiles-and-terminal-launch.md)
  policy. That selection affects future sessions only.
- Project editing shows the immutable environment identity/status and lets the
  user select a canonical root inside it or restore the environment default.
  Retargeting a project is not an edit operation.
- Moving a whole project between views preserves its environment. Moving a
  panel between unequal environments is rejected atomically; a terminal is not
  recreated on another machine. Same-environment moves remain unavailable
  until every dependent identity can be rebound atomically.
- Desktop presents workspace views as native windows. Project tabs can be
  dragged between them; web clients manage the same views in-page. Moving a
  project preserves its panels, live PTYs, scrollback, and service identities.
- A newly torn-off native window becomes the active window once its workspace
  is ready; the first interaction with its terminal controls is delivered to
  that control rather than being consumed only to activate the window.
- Each native project-host window presents exactly one server-owned workspace
  view. Tearing a project into a new native window creates a destination view
  and canonically moves the existing project into it; it does not copy the
  project into renderer state or close the source project.
- Closing a native project-host window closes only that window and detaches its
  workspace-view presentation while another project-host window remains. App
  shutdown begins only when the final project-host window closes or the user
  explicitly invokes Quit.
- Double-clicking a project tab opens project-tab editing in the current host's
  auxiliary-route presentation. Desktop may use a native modal window; web uses
  an in-page edit-tab surface. Saving updates the server-owned project name,
  root, colour, and icon; cancel leaves project state unchanged.
- Files and folders opened from project navigation become dockable panels in the
  relevant project. Closing a panel must dispose only that panel's resources;
  terminal termination is explicit terminal lifecycle behaviour.
- Closing or moving the final canonical panel/project in a container leaves its
  active selection absent rather than serializing an undefined optional field.
  The resulting workspace revision remains a valid snapshot/delta that every
  connected presentation can reconcile, including when local file panels remain.
- Closing an idle terminal proceeds immediately. Closing a terminal evaluates
  foreground-process state only for that terminal's exact session; activity,
  output, agent work, or process observation in another terminal cannot delay
  it. Closing a terminal whose PTY has a non-shell foreground process asks
  whether to **Close Terminal** or **Keep Running** before terminating it. Close
  protection obtains a bounded fresh observation for that session. If the
  sample cannot complete, Terminay still closes immediately unless a committed
  or partial sample already identified a non-shell foreground process; missing
  observation is not treated as a running process.
- Closing a project proceeds immediately when all of its terminals are at their
  shell prompts. If one or more project terminals have non-shell foreground
  processes, Terminay reports the affected terminal count and asks whether to
  **Close Project** or **Keep Running**. Moving a project or terminal between
  views is not a close and never triggers this warning.

## Boundaries and persistence

Project identity, immutable environment binding, layout, panel membership, and
logical workspace views are canonical server state under
[server-owned workspace state](./server-owned-workspace-state.md). Desktop
windows and browser views are presentations of that state. A project is a
navigation and authorization boundary, while the immutable server terminal
session id remains the identity used by services. Remote and MCP scopes derive
from authenticated server/project/session identities, never from tab labels or
client focus.

## Acceptance outcomes

- Multi-project work remains independent when roots, tabs, layouts, or sidebar
  settings change.
- One view may contain This server, SSH, and Puzed projects without clients
  connecting directly to the target machines.
- Moving or popping a project does not duplicate a terminal session or lose its
  connection to activity, agent, recording, or remote services.
- After a project is torn into a new native window, the source window shows the
  source view's remaining projects and the destination shows only the
  destination view's projects. A later workspace refresh preserves that split.
- Keyboard and menu commands operate on the active project/panel and fail
  clearly when their required target is absent.
- Reconnecting from a fresh client restores project and panel identity from
  server state without recreating live terminals.
- Sequentially closing every canonical terminal while another local panel stays
  visible removes each terminal exactly once and leaves workspace reconciliation
  current; the final removal cannot strand an exited terminal presentation.
- Reloading or closing a renderer detaches its presentation and must not turn
  Dockview disposal into canonical panel-close commands; restored renderers
  hydrate the same panels and terminal sessions.
- Terminal and project close warnings depend on canonical PTY foreground-process
  state, not recent output, agent status, tab attention, or display settings.
- Sustained output or slow foreground-process observation in one terminal never
  delays an unrelated terminal close, workspace command, or project-view
  interaction. A terminal close remains scoped to its exact session; a project
  close evaluates only the project's contained sessions.
- A foreground process in one native window protects that window with a scoped
  close warning; confirming it never closes sibling project windows. Only the
  final native project-host window uses the application quit warning and
  graceful shutdown path.
