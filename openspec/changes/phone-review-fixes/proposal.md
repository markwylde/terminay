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
- On a compact workspace, every Home list section is a **compact section page**,
  designed for a phone rather than squeezed from the wide page. The sections are
  Tabs, Bots, Automations, Workflows, Recordings, Pull Requests, and Issues.
  Each page has:
  - a title row with Search, **View options**, and the section's create
    control;
  - **status tabs with counts** as the main filter (for example, All · Needs
    you · Running · Done);
  - dense two-line rows;
  - a **View options sheet** from the bottom edge for sort, grouping, project,
    repository, and server.

  Options that hide rows show as removable tokens under the tabs. The wide
  pages are unchanged. On a compact Home the trailing sidebar toggle is not
  drawn.
- On a phone, activating a workflow opens a **workflow detail page**: its
  brief, every step with status, note, and time, and Open terminal.
- On Bots on a phone, the **Needs you** tab shows each pending request as a
  card. A permission request can be decided there. The container engine is a
  card at the end of the list that opens the sheet.

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
  compact chrome row has no sidebar toggle while Home is selected.
- `workspace-dashboard`: there is no Home sidebar on a compact workspace. Every
  Home list section has a compact section page with status tabs, search, rows,
  and a View options sheet. Workflows gains a compact detail page. Bots gains
  decidable Needs you cards. The narrow Workflows View options control is
  kept only for a narrow tab on a wide window.
- `in-page-windows`: compact drawers and sheets are not in-page windows
  (ADR-0125).

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
  - a new compact page kit in `src/workspace/compact/`, and
    `CompactEdgeDrawer` gaining a bottom edge
  - every section's page:
    - `WorkspaceDashboard.tsx`
    - `bots/BotsSection.tsx`
    - `automations/AutomationPanels.tsx`
    - `workflows/WorkflowsHome.tsx`
    - `recordings/RecordingsPanels.tsx` and `src/shared/SharedRecordingsLibraryPane.tsx`
    - `src/forge/ForgeHome.tsx` and `ForgeViews.tsx`
- Archive order: archive this change after `simplify-phone-header`,
  `workflows-home-on-phones`, and `forge-pull-requests-and-issues`, because it
  modifies requirements those changes add or change. Its Home sidebar sections
  requirement carries the forge change's eight sections.
- E2E:
  - `compact-rail-drawer`
  - `compact-rail-drawer-visual`
  - `compact-chrome-switcher`
  - `server-upgrade`
  - `home-workflows`
  - `home-sidebar`, `home-tabs`, `automations-ui`, `bots`
  - a new `compact-section-pages` suite, with a seeded screenshot run of every
    section populated with rows
