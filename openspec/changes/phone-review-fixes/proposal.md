## Why

A screen-by-screen review of Terminay at phone width found five places where the
phone layout gets in the way:

- The Command Bar shows an `ESC` hint beside its search field. A phone has no
  Escape key, and pressing the hint does nothing, so there is no obvious way to
  close the bar.
- The switcher rail's server control opens a popout menu over the drawer, while
  every other rail item (Home, each project) shows its own panel in the drawer.
- The launcher dropup picks its target folder from a cloud of chips. With many
  worktrees and folders, the chips fill the dropup and are hard to scan.
- On Home, the header's sidebar toggle opens a full-screen list of the Home
  sections. The switcher's Home panel already lists the same sections, so this
  is a second, worse copy of it.
- Home's list pages (Tabs, Bots, Automations, Workflows, Recordings, Pull
  Requests, Issues) spend most of a phone screen on search fields, filter chips,
  and view options before the first row appears. On Bots, the Container engine
  card also takes a screen of its own, and the header is cramped.

## What Changes

- The Command Bar's Escape hint is a button named **Close command bar** that
  closes the Command Bar when pressed, at every width.
- The switcher rail's server control becomes a rail item labelled **Servers**.
  Selecting it shows a Servers panel in the drawer, as Home and projects do. The
  panel lists every server the window can show, with the current one marked,
  each server's available upgrade, and an **Add connection** bar at the bottom.
  The popout server menu is removed.
- The launcher dropup's target-folder chips become one **Open in** control
  naming the chosen folder. Pressing it opens a filterable list of the
  project's folders: typing narrows the list, and choosing a folder sets the
  target and closes the list.
- **BREAKING** (presentation only): on a compact workspace, Home has no Home
  sidebar. The switcher's Home panel is the only way to open a Home section.
- On a compact workspace, the header's trailing panel button opens a **Home
  options panel** on the right while Home is selected. The panel holds the
  front section's search, filters, view controls, and section-specific extras.
  The section page keeps only its title row, primary action, and list. The
  button is offered only when the front section has options, and shows when a
  filter is applied.
- On Bots on a compact workspace, the Container engine card sits in the Home
  options panel. The title row holds the title and **New bot** on one line, and
  the page uses the same gutters as the other sections.
- On a compact workspace, the Workflows toolbar (text filter, status filter, and
  every view option) is shown in full in the Home options panel instead of
  partly in the page behind **View options**.

Out of scope: the Settings category pages. The review said they could be better
on a phone, but did not say what to change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: the Command Bar has a close
  control.
- `workspace-and-project-tabs`: the Servers rail item and panel replace the rail's
  server menu. The launcher dropup picks its folder with a filterable list. The
  compact chrome row's panel button opens the Home options panel while Home is
  selected.
- `workspace-dashboard`: there is no Home sidebar on a compact workspace. The
  Home options panel holds each section's toolbar. Bots has a compact
  presentation. On a compact workspace, the Workflows toolbar lives in the
  panel, and the View options control is only for a narrow Workflows tab on a
  wide window. Every section has an on-page clear control when a filter
  matches nothing.
- `in-page-windows`: compact edge drawers are not in-page windows (ADR-0125).

The change also adds ADR-0125. It supersedes in part ADR-0053's list of
surfaces exempt from the shared window frame.

## Impact

- Renderer only. No server, protocol, preload, or storage change.
- Files:
  - `src/workspace/CommandBar.tsx`
  - `src/workspace/CompactSwitcher.tsx` and `CompactSwitcher.css`
  - `src/workspace/CompactChromeRow.tsx`
  - `src/App.tsx`
  - `src/workspace/HomeWorkspace.tsx` and `HomeView.tsx`
  - a new `src/workspace/HomeOptionsPanel.tsx`
  - every section's toolbar:
    - `WorkspaceDashboard.tsx`
    - `bots/BotsSection.tsx`
    - `automations/AutomationPanels.tsx`
    - `workflows/WorkflowsHome.tsx`
    - `recordings/RecordingsPanels.tsx` and `src/shared/SharedRecordingsLibraryPane.tsx`
    - `src/forge/ForgeHome.tsx` and `ForgeViews.tsx`
- Archive order: archive this change after `simplify-phone-header` and
  `workflows-home-on-phones`, because it modifies requirements those changes
  add.
- E2E:
  - `compact-rail-drawer`
  - `compact-rail-drawer-visual`
  - `compact-chrome-switcher`
  - `server-upgrade`
  - `home-workflows`
  - a new `compact-home-options` suite
