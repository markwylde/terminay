## Context

The workspace UI in `src/` is one responsive bundle served to every host
(ADR-0018): Desktop Electron, the browser, and the framed PWA session host all
render the same React tree, with host differences expressed as capabilities
rather than separate builds. Three separate controls currently answer "which
terminal am I looking at":

- `ProjectTabList` / `ProjectSwitcherMenu` (`src/workspace/`) — projects, with an
  existing compact mode that collapses the strip to a project-only switcher at
  640px.
- the Dockview panel tab strip inside `ProjectWorkspace` — terminals of the
  active project only.
- `RemoteAccessConnectionMenu` and `ConnectionsControl` — servers.

Above them, browser hosts render `ConnectedBrowserMenuBar` — a 30px band of
`File Edit View Help` that is a sibling of the workspace, not part of it
(`src/web/ConnectedWebRendererWorkspace.tsx`). Desktop hosts advertise
`nativeMenus` and omit it.

The change folds all four into one 40px row plus one sheet, below 640px only.
Nothing above that breakpoint changes.

## Goals / Non-Goals

**Goals:**

- One compact chrome row; one surface that answers "which terminal", across
  every project and every attached connection.
- Reuse the composed inventory and activity vocabulary that already feed the
  project tabs, the header activity menu, and the dashboard, so a fourth
  surface cannot invent a fifth reading of a state.
- No new protocol surface, no new privileged capability, no new host global.

**Non-Goals:**

- Changing wide-layout chrome, Dockview layout, or panel tab behaviour above
  640px.
- Server-side "last output line" storage or a protocol read for preview text.
- Replacing the wide project overflow switcher or the header activity menu.
- Gestural terminal switching (swipe between terminals) — noted as the natural
  follow-up if two taps proves too slow, but out of scope here.

## Decisions

### The compact application menu crosses the host boundary by composition, not by DOM

The burger must render *inside* the workspace chrome row, but its items are
browser-host concerns (`Disconnect`, `Switch connections`, browser auxiliary
routes) that `src/App.tsx` must not learn. Options considered:

1. **React portal** from the web menu bar into a slot element the header renders.
   Rejected: couples two components through a DOM id and makes ordering and
   unmount timing load-bearing.
2. **Move the menu definitions into `src/App.tsx`.** Rejected: pushes
   browser-only commands into the shared workspace tree, which every host
   renders. That is the boundary ADR-0018 draws — host difference belongs in
   capabilities, not in the shared tree's command list.
3. **Chosen: pass a render function through the existing host presentation
   boundary.** `ConnectedRendererWorkspace`'s `host.presentation` already carries
   `nativeMenus` and `nativeWindowControls`. It gains an optional
   `renderCompactApplicationMenu` supplied only by the browser composition. The
   shared tree renders it in the compact row when present and renders nothing
   when absent, so Desktop stays untouched without a branch on host kind.

This crosses the host/shared-workspace boundary in the direction that boundary
already allows: the host supplies capability-shaped things to the shared tree,
and the shared tree never reaches back.

### The preview line is a window-local buffer read, never a protocol read

`TerminalPanel` already registers a per-session `TerminalContextReader`
returning `recentOutput` from that panel's live xterm buffer — the same reader
the terminal-control surface uses. The switcher reuses that registry: the
preview is a read of what this window is already rendering, so it crosses no
privileged boundary, adds no protocol message, and cannot make the client an
activity authority (the terminal-activity-signals spec forbids that).

The consequence is honest and specified: a terminal with no mounted panel in
this window — another connection's project, or a project whose panels are not
realized — shows no preview line. That is stated as required behaviour rather
than worked around, because the alternatives (a server-side last-line field, or
mounting every project's panels) either widen the protocol or cost the memory
the compact layout is trying to save.

Preview text is read at open time and on a bounded interval while the sheet is
open, not subscribed per keystroke of output; the sheet is a decision surface,
not a second terminal view.

### One switcher component, two triggers, one open state

The breadcrumb and the connection glyph open the same component with the same
content. The connection glyph does not open a filtered or connection-scoped
variant: a user who taps the server icon wants to change *where they are*, and
the grouping already puts the connections at the top level. Open state lives in
`src/App.tsx` beside the existing `isRemoteMenuOpen` / `isActivityMenuOpen`
flags and is mutually exclusive with them, so two overlays can never stack.

### The breakpoint is observed once, in the shell

`App.tsx` already measures the project tab bar (`projectTabBarRef`) for overflow.
The compact decision reuses that observed width rather than adding a second
media-query source, so the row cannot disagree with itself about which
presentation is live. The panel tab strip's compact hiding is driven from the
same flag, passed down to `ProjectWorkspace`, rather than a CSS media query on a
different axis — a width rule in CSS and a width observation in JS drifting apart
is exactly the class of bug the single source avoids.

### Rows activate through the existing composed-tab handlers

A switcher row carries `{ serverId, projectId, sessionId }` and activates via the
same `activateComposedTab` / terminal-activation path the header activity menu
already uses, which handles cross-server activation and project selection. No new
activation route is introduced, so the project/window and terminal-session
security boundaries are enforced by the code that already enforces them.

## Risks / Trade-offs

- **Two taps to switch terminals, always.** → Accepted deliberately: the row
  count reclaimed (one 40px row instead of 30 + 40 + 38) is worth more on a
  phone than one-tap adjacency. A swipe gesture on the terminal body is the
  follow-up if it bites.
- **The switcher list grows with projects × terminals.** → The filter is
  specified, not optional, and rows are virtualization-free but bounded by the
  same inventory the dashboard already renders at this scale.
- **Preview lines absent for unmounted terminals could read as "empty
  terminal".** → Specified as *no preview line*, not an empty line or a
  placeholder, so absence never looks like content.
- **A compact row that overflows on a 320px viewport.** → Icons narrow before
  the breadcrumb truncates, and the breadcrumb truncates the project name before
  the terminal title; both are specified so the failure mode is ordered rather
  than arbitrary.
- **Hiding the panel tab strip removes the close affordance for terminals on
  compact.** → Closing stays available from the terminal's own context menu and
  from the switcher row is *not* added here; this is called out as a deliberate
  scope edge, not an oversight.

## Migration Plan

Presentation-only and breakpoint-gated; there is no persisted state, no protocol
version, and no server change. Rollback is reverting the change — a client
running the old bundle and a client running the new one talk to the same server
identically.

## Open Questions

- None blocking. No in-force ADR needs revisiting: this change sits inside
  ADR-0018's one-bundle-many-connections model and ADR-0011's trust boundaries
  without moving either.
