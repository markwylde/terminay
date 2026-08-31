# Workspace and project tabs

## Summary

Terminay organizes work as project tabs. A project has one immutable
[project environment](./project-environments.md), an optional root folder
interpreted by that environment, name, colour, icon, default shell-profile override, per-project navigation
state, and a Dockview layout holding terminal, file, and folder panels. Projects
and panels are movable where environment boundaries permit without turning a
terminal title into an identity boundary.

Markdown and MDX files can use the rich
[Documentation presentation](./documentation-sidebar-and-editor.md) within a
canonical file panel; changing presentation does not change panel or file
identity. Project-sidebar sizing and title-visibility behavior is governed by
[Project sidebar layout](./project-sidebar-layout.md).

## User contract

- Users can create, rename, reorder, close, and colour/icon project tabs.
  The active project tab’s colour continues into the panel tab strip and the
  sidebar group tab bar, so that chrome reads as one band. Sidebar
  pane titles use the dark project-bar surface with white labels. Pane bodies
  share the terminal background. Sidebar pane titles stay quiet on hover; only title
  actions such as refresh, explorer file rows, and the 4px resize rail
  highlight. The sidebar toggle is an icon on the dark project bar; hover
  highlights it slightly. The new-project `+` and environment-chooser arrow
  are separate icon buttons with the same even pacing as the panel-strip
  add controls, not a joined chip. Panel tabs on that strip use a 4px corner: the
  active panel tab is the solid chip, and inactive tabs stay quiet until hover.
- The project tab bar never steals trailing chrome. Sidebar toggle, new-project
  control, activity, and the Local connection pill stay fully visible. When
  project tabs no longer fit, overflowed tabs leave the strip and remain
  reachable from a Local-matching project switcher: colour swatch, label,
  numeric badge, and chevron opening a shared menu of every project in the
  view. On a compact bar (phone-width / ≤640px) the strip collapses to that
  switcher showing the active project name, with the count badge and chevron
  trailing at the right of the pill. Its All projects menu spans the window
  so names stay readable, with compact rows matching the rest of the chrome,
  and New project lives in that menu instead of as
  header `+` chrome. On a wider bar the overflowing
  strip fills the space before `+` and Local, the switcher stays pinned to
  that right edge, and at least one extra tab continues behind it — the
  pill covers about half of that last tab — rather than leaving a hole or
  looking like a last tab-like button. The wide-bar switcher menu stays an
  anchored dropdown. The active tab stays among
  the real tabs. When every tab fits, `+` still sits immediately after the
  last tab and Local stays trailing. The
  strip is click-and-drag to reorder only for visible tabs; the shared menu
  lists every project, can activate or close one, and can reorder via its
  grips so portrait web clients are not stuck with a drag-to-reorder strip
  they cannot scroll. Dragging along the visible strip reorders there; native
  tear-off starts only after the pointer leaves the bar. A dropped
  visible-tab or switcher-row order commits through `project.move` in the
  current view so a later snapshot cannot snap the tab back. Menu grips
  track the pointer (they are not HTML5 drag sources) so they work inside
  the desktop title-bar drag region, and the menu stays open through the
  drop. The new-project `+` and environment
  chooser sit immediately after the last visible tab, or after the overflow
  switcher when the strip is filling the bar. Activity and Local stay
  trailing; opening the environment chooser must not grow or shift the tab
  bar.
- A user-created project or terminal receives keyboard focus in that xterm
  so typing starts immediately. Creation chrome such as the project and
  terminal `+` controls must not keep focus after the new session is ready.
- Creating a project immediately adds a non-active pending tab with the future
  project label and a spinning project icon. Validation, canonical project
  creation, terminal launch, and terminal hydration happen behind that tab
  without covering or replacing the active project, which remains usable. When
  the terminal is ready, Terminay activates and focuses the new project only if
  the user has not selected another project since creation began. If the user
  has moved elsewhere, the ready project remains in the background. A creation
  failure activates the pending tab and presents its error there.
- The project-bar split button's primary `+` creates a project on **This
  server** immediately. Its arrow opens an accessible environment chooser with
  This server, recent SSH/Puzed targets, provider create/browse actions, and
  **Project Environments…**. Project Environments opens or focuses its
  first-class management window/route. **This server** identifies the selected
  Terminay Server because it may be remote from the client.
- New projects use the selected environment profile's default root or verified
  account home. They never copy an active project root from another
  environment. Target/root validation completes before the pending tab becomes
  a normal project tab. A successful user-created project receives one terminal through
  the selected server's normal terminal-launch resolver; this is an explicit
  creation flow, never a renderer repair for an empty workspace. After a Local
  Desktop restart, each restored project likewise receives one fresh terminal
  so a project is never shown empty. Remote SSH/Puzed roots are not treated as
  missing local folders; their replacement PTY is seeded through the live
  environment. The project tab shows a spinner while that connection or a
  user-created project is still loading. Explorer does not open SFTP until
  that replacement terminal exists.
- Project creation commits its initial colour and icon atomically with the
  server-owned project so rapid creation cannot reuse an uncommitted colour.
- A project root can be selected directly or derived from the active terminal's
  working directory, including terminals on SSH/Puzed environments. Closing the
  final panel closes the project; closing the first project does not
  unexpectedly quit the app.
- New terminals open in the active project of that presentation. Tabs can split
  the active layout horizontally or vertically, be reordered, moved to another
  project, or moved into another workspace view.
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
- Long-pressing the project switcher pill edits the active project. Long-pressing
  a project row in that menu edits that project. A short press still opens the
  menu or activates the project. Long-press does not toggle the menu, switch
  projects, or start a reorder.
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
  whether to **Close Terminal** or **Keep Running** before terminating it. A
  silent interactive process remains busy even when it has helper children; a
  unique running command is not required. Close protection obtains a bounded
  fresh observation for that session. If the sample cannot complete, Terminay
  still closes immediately unless a committed or partial sample already
  identified a non-shell foreground process; missing observation is not treated
  as a running process.
- Closing a project proceeds immediately when all of its terminals are at their
  shell prompts. If one or more project terminals have non-shell foreground
  processes, Terminay reports the affected terminal count and asks whether to
  **Close Project** or **Keep Running**. Moving a project or terminal between
  views is not a close and never triggers this warning.
- Closing a native project-host window uses the same bounded fresh
  foreground-process observation for terminals in that window's workspace view.
  Activity snapshots are not sufficient: a command that has already started may
  not yet be committed as `foregroundBusy`. If one or more of those terminals
  have a non-shell foreground process, Terminay asks whether to **Close Window**
  or **Keep Running**. The final project-host window uses **Quit Terminay**
  instead. If the sample cannot complete, the window closes immediately unless a
  committed or partial sample already identified a non-shell foreground
  process.

## Boundaries and persistence

Project identity, immutable environment binding, layout, panel membership,
project-local sidebar layout, and logical workspace views are canonical server
state under
[server-owned workspace state](./server-owned-workspace-state.md). The ordered
project list in a view and the ordered panels in a project are broadcast to
every connected presentation. Which project tab is active, and which terminal
or panel is active inside that project, is local to that presentation: a
desktop window and a web client on the same server can show different active
tabs. Desktop windows and browser views also retain their own per-project
sidebar visibility. A project is a navigation and authorization boundary, while
the immutable server terminal session id remains the identity used by services.
Remote and MCP scopes derive from authenticated server/project/session
identities, never from tab labels or client focus.

## Acceptance outcomes

- Multi-project work remains independent when roots, tabs, layouts, or sidebar
  state changes. Reloading restores the current device's sidebar visibility and
  selected sidebar group for each project; reconnecting restores each project's
  pane order, dimensions, collapse choices, and supported pane navigation state
  without changing a different device's visibility, selected group, or active
  project tab.
- Resizing a project sidebar previews locally and commits once when the
  interaction finishes. The sidebar tab bar switches Explorer, Documentation,
  and Agents. Every visible pane title in the active group remains on-screen,
  the sidebar itself does not scroll vertically, and overflowing pane content
  scrolls inside its own pane.
- One view may contain This server, SSH, and Puzed projects without clients
  connecting directly to the target machines.
- Moving or popping a project does not duplicate a terminal session or lose its
  connection to activity, agent, recording, or remote services.
- After a project is torn into a new native window, the source window shows the
  source view's remaining projects and the destination shows only the
  destination view's projects. A later workspace refresh preserves that split.
- Keyboard and menu commands operate on the active project/panel and fail
  clearly when their required target is absent.
- A crowded project bar keeps Local and the new-project control on-screen.
  Overflowed projects stay available from the Local-matching switcher menu on
  both desktop overflow and compact/mobile chrome. Compact chrome opens a
  full-width All projects menu that also creates a project, and the compact
  switcher keeps its count and chevron on the trailing edge of the pill. On
  a wide overflowing bar the strip fills through to `+` and Local, the
  switcher stays on that right edge, at least one extra tab continues
  behind the pill, and the active project remains a real tab.
- The active project tab stays visually joined to its panel tab strip and the
  sidebar group tab bar. Sidebar
  pane titles use the dark project-bar surface with white labels and stay
  quiet on hover, pane bodies share the terminal background, title actions
  and explorer rows still highlight, the sidebar toggle is an icon until hover,
  the project-bar `+` and environment-chooser arrow keep the same even icon
  pacing as the panel-strip add controls, and inactive panel tabs stay
  secondary to the active chip.
- Reconnecting from a fresh client restores project and panel identity from
  server state without recreating live terminals.
- Two connected presentations of the same server keep independent active
  project tabs and independent active terminals. Creating, reordering, or
  closing a project still appears in every client's list; activating a tab on
  one client does not change another client's selection. When a locally
  selected project or panel disappears, that presentation falls back locally.
- Sequentially closing every canonical terminal while another local panel stays
  visible removes each terminal exactly once and leaves workspace reconciliation
  current; the final removal cannot strand an exited terminal presentation.
- Closing an already-exited terminal tab succeeds while another live terminal
  remains. That close does not wait on killing a finished PTY, does not offer a
  connection retry that replaces the workspace transport, and does not stall
  sibling terminals.
- Reloading or closing a renderer detaches its presentation and must not turn
  Dockview disposal into canonical panel-close commands; restored renderers
  hydrate the same panels and terminal sessions and can type into still-running
  shells.
- Terminal and project close warnings depend on canonical PTY foreground-process
  state, not recent output, agent status, tab attention, or display settings.
  A silent non-shell foreground process still warns when it has helper children.
- Sustained output or slow foreground-process observation in one terminal never
  delays an unrelated terminal close, workspace command, or project-view
  interaction. A terminal close remains scoped to its exact session; a project
  close evaluates only the project's contained sessions.
- A foreground process in one native window protects that window with a scoped
  close warning; confirming it never closes sibling project windows. Only the
  final native project-host window uses the application quit warning and
  graceful shutdown path.
