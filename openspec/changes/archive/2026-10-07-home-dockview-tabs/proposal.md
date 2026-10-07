## Why

Home does not behave like the rest of the workspace. A project gives the user
tabs they can keep open, reorder, split, and come back to; Home gives them one
page at a time. Starting a new automation, filling in half the form, and looking
at a project for a moment throws the form away, because Home shows a single
section and forgets where the user was as soon as they leave it. The same thing
happens when moving between Home's own sections, and there is no way to keep an
automation, its editor, and a run log open side by side.

Technically, Home is unmounted whenever a project is in front, its sections are
a one-of-three switch, and the Automations pages are a state machine inside one
component. Nothing in Home is a panel, so nothing in Home can stay open.

## What Changes

- Home gets its own tab strip and panel area with the same window management as
  a project: tabs can be opened, closed, reordered by dragging, and split side
  by side or stacked.
- The Home sidebar (Home, Tabs, Automations) becomes a launcher. Activating an
  entry opens that section as a tab, or brings its tab to the front if it is
  already open. The sidebar highlights the section of the tab in front.
- Everything inside Automations that used to replace the page opens a tab
  instead: a new automation, an automation's detail and run history, its editor,
  a run's log, and an automation terminal. The in-page Back navigation goes away.
- Home tabs keep their state while another Home tab or a project is in front, so
  an unsaved automation is still there on return. A tab with unsaved edits is
  marked, and closing it asks first.
- The tabs open in Home and their arrangement are remembered per device and
  restored on relaunch. Unsaved edits are not kept across a relaunch.
- **BREAKING** The search bar across the top of Home is removed, along with its
  `/` shortcut. Its results move into the Command Bar (`CmdOrCtrl+L`), which now
  also finds Home sections, projects, tabs, agents, and automations.
- The Command Bar opens while Home is in front and when the window holds no
  project. Commands that need a project are left out when there is none.
  **BREAKING** for the compact chrome: its Command Bar control is no longer
  disabled on Home.
- With every Home tab closed, Home shows an empty state that offers the three
  sections.
- On a compact workspace, where no tab strip is drawn, Home shows the tab in
  front and the sidebar drawer remains the way to move between sections.

Floating and pop-out Home tabs are out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`: Home holds tabs and an arrangement of its own; the
  sidebar opens tabs rather than selecting a single section; Home search is
  removed; Home tabs keep their state and are remembered per device; overview
  widgets open tabs.
- `automations`: the Automations section is a list tab, and automations,
  editors, run logs, and automation terminals open as Home tabs; unsaved edits
  are protected.
- `settings-shortcuts-and-desktop-integration`: the Command Bar also searches
  places, and is available with Home in front or no project.
- `workspace-and-project-tabs`: the compact Command Bar control is available on
  Home.
- `server-owned-workspace-state`: Home's open tabs and their arrangement are
  named as client-owned device-local state.

## Impact

- **UI**: `src/workspace/HomeView.tsx`, `HomeSearch.tsx` (removed),
  `homeSearchModel.ts` (reused by the Command Bar), `homeSection.ts`,
  `localViewState.ts`, `homeView.css`, `src/App.css`; the Home block and the
  Command Bar in `src/App.tsx`; `src/workspace/automations/AutomationsSection.tsx`
  (split into panels), `AutomationEditor.tsx`, `AutomationTerminalView.tsx`.
- **Clients**: the workspace UI is shared, so Desktop, browser, and phone hosts
  all change. No server, protocol, or persistence change: everything added is
  device-local presentation state.
- **Dependencies**: none new. `dockview` is already used for project panels.
- **Tests**: `e2e/home-sidebar.spec.ts`, `e2e/automations-ui.spec.ts`,
  `e2e/automations.spec.ts`, `e2e/project-tabs.spec.ts`,
  `e2e/compact-chrome-switcher.spec.ts`, `scripts/compact-chrome-breakpoint.test.mjs`,
  `scripts/local-view-state.test.mjs`, `scripts/home-search-model.test.mjs`.
- **Sequencing**: `compact-command-bar-entry` and `compact-unified-switcher`
  modify the same "Compact bar presentation" requirement and must be archived
  first; this change's delta is written against their resulting text.
