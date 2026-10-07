## Why

On a phone the workspace spends three stacked bands of chrome — the browser
application menu bar, the project bar, and the panel tab strip — before a single
line of terminal appears. With the software keyboard up that leaves a terminal
barely a few lines tall, and the bands that cost the most are the ones a phone
user touches least: a `File Edit View Help` strip nobody reads one-handed, and a
server name that is usually the only server attached.

Worse, finding a terminal takes three different controls that each behave
differently: the compact project switcher for projects, the panel tab strip for
terminals inside the active project, and the connection menu for servers. The
thing a user actually wants — *that terminal, wherever it lives* — is never in
one place.

## What Changes

- On a compact workspace (640px and narrower) the chrome collapses to **one
  40px row**: application menu button, file-explorer toggle, dashboard, a
  project-and-terminal breadcrumb that grows to fill the row, and a connection
  glyph on the trailing edge.
- The browser application menu bar stops being its own band on a compact
  workspace and becomes a single menu button inside that row, holding the same
  File, Edit, View, and Help commands as one grouped menu.
- The connection control stops rendering the server name on a compact
  workspace and becomes a glyph carrying its exposure tone and a reachability
  dot.
- The breadcrumb and the connection glyph open **one unified switcher** — a
  sheet listing every terminal of every project of every attached connection,
  grouped by connection and then by project, each row carrying the terminal's
  activity state and, where the window holds that terminal's live buffer, its
  most recent non-empty output line.
- The switcher filters by name across terminals, projects, and connections, and
  carries the create actions the collapsed chrome absorbed: a new terminal per
  project group, New project, and Add connection.
- The panel tab strip hides on a compact workspace; the switcher is how a
  terminal is chosen there. Panel tabs are unchanged everywhere else.
- Desktop and any workspace wider than 640px keep today's chrome exactly:
  application menu bar, full project tab strip with overflow switcher, named
  connection control, and the panel tab strip.

## Capabilities

### New Capabilities

None. This changes how existing surfaces present below a breakpoint; no new
product capability is introduced.

### Modified Capabilities

- `workspace-and-project-tabs`: the compact bar presentation requirement is
  replaced. A compact bar is a single row whose project control is a
  project-and-terminal breadcrumb opening the unified switcher, rather than a
  project-only switcher; the panel tab strip is absent on a compact workspace;
  and the switcher owns the create actions the row no longer shows.
- `connections-and-client-hosts`: the application menu on a compact browser
  workspace presents as one menu button inside the workspace chrome rather than
  its own menu bar band, and the connection control presents as a glyph. The
  narrow-layout contract gains the unified switcher as the named selector that
  replaces the wide tab strips.
- `terminal-activity-signals`: switcher rows present the same per-terminal
  activity vocabulary the tab, header menu, and dashboard already use, so a
  fourth surface cannot invent a fifth reading of a state.

## Impact

- `src/App.tsx` — compact branch of the project tab bar header; breakpoint
  observation; wiring the switcher to existing activation, creation, and
  connection handlers.
- `src/workspace/` — a new unified switcher surface and its row model, built
  from the existing composed project/terminal inventory and
  `TerminalActivityOverviewItem` vocabulary; `ProjectTabList`,
  `ProjectSwitcherMenu`, and `ConnectionsControl` gain compact presentations.
- `src/web/ConnectedWebRendererWorkspace.tsx` — the browser application menu
  gains a compact single-button presentation rendered inside the workspace
  chrome instead of above it, passed through the existing host presentation
  boundary rather than a new global.
- `src/components/TerminalPanel.tsx` — the existing per-session terminal context
  reader supplies the preview line; it already reads the local xterm buffer this
  window renders, so no protocol surface and no privileged boundary is crossed.
- `src/App.css` and the responsive workspace styles — the compact row, the sheet,
  and hiding the panel tab strip below the breakpoint.
- `e2e/` — compact-viewport coverage for the collapsed row, the switcher, and
  the unchanged wide layout.
