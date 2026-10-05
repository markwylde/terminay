## Context

Home is a controlled shell (`src/workspace/HomeView.tsx`) that renders one of
three sections chosen by `homeSection` state in `App`. Three things make it
forget:

- `App.tsx` renders `{isHomeSelected ? <HomeView …/> : null}`, so selecting a
  project unmounts all of Home. Project workspaces are instead kept mounted and
  hidden with CSS.
- The section is a ternary over `HomeOverview`, `WorkspaceDashboard`, and
  `AutomationsSection`, so changing section unmounts the other two.
- `AutomationsSection` models list, detail, editor, and terminal as a local
  `Page` state machine, and `AutomationEditor` keeps the draft in `useState`.

Each project has its own `DockviewReact` instance. Its panels are canonical
server objects: the renderer adds a panel only after the server creates it,
`useDockviewPanelLifecycle` turns a Dockview removal into `closeServerPanel`,
and `reconcileServerPanels` removes any Dockview panel the server does not know.
Layout is expressed to the server as named commands, never as a Dockview
document (`server-owned-workspace-state`).

The Command Bar is implemented inside `ProjectWorkspace`, one per project, with
a hardcoded item list. Its key handler is gated on the project being active, so
it cannot open on Home or with no project. The Home search band
(`HomeSearch.tsx` over `homeSearchModel.ts`) is the only place that searches
projects, tabs, agents, and automations.

The workspace UI is one bundle shared by Desktop, browser, and phone hosts
(ADR-0008, ADR-0018). At 640px and below the Dockview tab strip is hidden.

In-force ADRs that bear on this: ADR-0008 and ADR-0018 (one bundle, hosts are
protocol-blind), ADR-0011 (trust boundaries), ADR-0028 (no polling), ADR-0031
(automations are server-owned; MCP authority is scope times policy).

## Goals / Non-Goals

**Goals:**

- Home tabs behave like project panel tabs: open, close, reorder, split.
- Nothing typed into a Home tab is lost by looking elsewhere.
- Every Automations page is a tab; the section is only a list.
- One place to search for anywhere to go: the Command Bar, reachable from
  every view.
- No server, protocol, or persistence change.

**Non-Goals:**

- Floating or pop-out Home tabs.
- Dragging tabs between Home and a project.
- Keeping unsaved edits across a relaunch.
- Sharing Home's arrangement between devices.
- Redesigning the Command Bar's command list or the compact switcher.

## Decisions

### 1. Home owns a second kind of Dockview, apart from the project lifecycle

A new `HomeWorkspace` component hosts one `DockviewReact` for Home with its own
component map and tab component. It does not use `useDockviewPanelLifecycle`,
`useTerminalAdoptionController`, or `reconcileServerPanels`.

*Why:* those hooks encode "a panel is a server object". A Home tab closing must
never call `closeServerPanel`, and reconciliation would delete every Home tab as
non-canonical. Sharing the code would mean threading a "not really a panel" flag
through the project/terminal-session boundary, which is a security boundary for
remote access and MCP.

*Alternative rejected:* model Home as a reserved project on the server so the
existing machinery applies. That makes device presentation into shared workspace
state, contradicts "Home is not a project", and would show one device's Home
tabs on every other.

*Boundary:* none crossed. Home tabs are renderer presentation only; every
action a tab offers still goes through the existing authorised client
operations.

### 2. Home stays mounted and is hidden, as projects are

`App` mounts `HomeWorkspace` the first time Home is shown and keeps it from
then on, hiding it with the same `visibility: hidden` treatment as an inactive
`.project-workspace` and marking it `inert`. A window that never visits Home
never builds it; a tab asked for before Home exists (the Command Bar choosing
an automation from a project) is queued and opened as soon as it does.

*Why:* it is the only way a draft survives leaving Home without hoisting every
piece of tab state into a store. It also matches how projects already work.

*Consequences to handle:* effects that assumed "mounted means visible" must be
gated on `isHomeSelected` instead — the `automationClock` tick, any window-level
key listener, and focus-on-mount. Hidden Home must not take keyboard focus.

*Alternative rejected:* persist drafts to a store and keep unmounting. More code
per tab kind, and still loses scroll, filters, and expanded rows.

### 3. Inactive Home tabs keep their React tree

Home panels are added with Dockview's `renderer: 'always'`, so an inactive tab's
DOM stays attached and hidden rather than being detached.

*Why:* detaching loses scroll position and can lose input state; the editor is
exactly the tab that must not. The cost is that hidden tabs stay in the DOM;
Home tabs are light and few.

This is verified first, by a spike task, before the rest is built: type into an
editor tab, switch tab, switch project, return.

### 4. One open-or-focus entry point with typed tab descriptors

A `homeTabs` module defines the descriptor union and the id each maps to:

| Descriptor | Id | Singleton |
|---|---|---|
| section `home` / `tabs` / `automations` | `section:<name>` | yes |
| automation | `automation:<serverId>:<automationId>` | yes |
| automation editor | `automation-edit:<serverId>:<automationId>` | yes |
| new automation (blank or duplicate) | `automation-new:<n>` | no |
| run | `run:<serverId>:<automationId>:<runId>` | yes |
| automation terminal | `automation-terminal:<serverId>:<panelId>` | yes |

`openHomeTab(descriptor, { from })` focuses the panel with that id or adds it
next to `from` (else in the active group). The sidebar, the empty state, the
overview widgets, the Automations list, the Command Bar, and the missed-run
notice all call it. It replaces the `automationsFocus` nonce prop and the `Page`
state machine.

Each descriptor also names its section (`automation*` and `run` belong to
`automations`), which is how the sidebar's current item is derived from the
active panel instead of from stored `homeSection` state.

*Alternative rejected:* keep one Automations panel with internal navigation.
That is the present behaviour moved into a tab and fixes nothing the user asked
for.

### 5. `AutomationsSection` splits into panel components over shared data

`AutomationsListPanel`, `AutomationDetailPanel`, `AutomationEditorPanel`,
`AutomationRunPanel`, and `AutomationTerminalPanel` each read the existing
`useServerAutomations` projection, which already lives in `App`, through a Home
context. The server selector stays in the list panel; every other panel is bound
to the `serverId` in its descriptor, so it does not move when the selector does.

Every Home tab stays rendered (decision 3), so each panel watches the
projection for the thing it shows and closes its own tab when that is gone
(ADR-0028: driven by the existing server events, no timer). A panel whose
server has not attached yet, or whose automations have not loaded, waits rather
than closes, so a restored tab does not vanish during connect; a server that
was attached and no longer is closes it. A run that is missing when its tab
opens asks the run log once more before it is treated as gone, because a run
started a moment ago may not be in the log yet.

### 6. Unsaved edits are tracked per tab and guard every close route

The editor panel reports `dirty` (form differs from its initial value) into a
Home tab registry. The Home tab component shows the mark and owns the close
button; close, Cancel, and the keyboard close all go through one
`requestCloseHomeTab(id)` that asks when dirty, using the in-app confirmation
pattern the delete flow already uses rather than a native dialog, so it works in
browser and phone hosts. Programmatic closes for stale tabs bypass the prompt
and raise a notice instead.

`AutomationEditor` stops re-seeding its form when `initial` changes identity;
its descriptor fixes what it edits for the tab's lifetime.

### 7. Home's arrangement is stored on the device as a Dockview document

`HomeWorkspace` writes `api.toJSON()` to localStorage on Dockview's
layout-change event (event-driven, no interval) under
`terminay.view.home-layout.v1`, and restores with `fromJSON` inside a
try/catch. Before restoring, the document is filtered: panels whose ids do not
parse to a known descriptor are dropped, `automation-new:*` panels are dropped,
and an empty result falls back to the Home section tab alone.

*Why a Dockview document here when workspace state forbids one:* that rule
exists because project layout is shared, server-owned, and must render on
devices of any size. Home's arrangement is none of those; it is the same class
of state as the active tab and sidebar visibility. Serialising it gives splits
and sizes for free where a hand-rolled list would only restore a flat strip.
The document is treated as an untrusted hint and never leaves the device.
ADR-0040 records this split.

The existing `terminay.view.home-section.v1` key is read once when no layout is
stored, to open the section the device last showed, and is no longer written.

### 8. One Command Bar dialog, drawn by whoever is in front

The dialog, its keyboard navigation, command scoring, and the place results
move out of `App.tsx` into `src/workspace/CommandBar.tsx`. A project still
draws the Command Bar with its own commands and macros, as it always has; with
Home in front, or with no project in the window, the workspace view draws the
same dialog with the commands that are its own (new project, new automation,
show dashboard, sidebar, status bar, settings). Both append places from
`searchHome(…)` after commands and macros, and only for a non-empty query.
Choosing a place calls the existing `chooseHomeSearchResult`, with sections and
automations routed to Home's tabs.

`open-command-bar` is answered by the workspace view whenever Home is selected
or the window holds no project, from the accelerator, the menu, and the compact
chrome control alike; the control's `disabled` binding is removed.

*Why not hoist the whole launcher into `App`:* a project's command list closes
over that project's terminals, macros runner, and dialogs, and the macro
parameter modal lives beside it. Lifting all of that to list project commands
over Home would have them act on a project the person cannot see. With Home in
front the Command Bar therefore lists no command that needs a project, the
same as when there is none; the accelerators for those commands still follow
the "command target while Home is selected" rule.

*Why one dialog and one navigation hook rather than two launchers:* two would
drift. The two hosts differ only in the command list they pass in.

*Boundary:* none crossed. Command execution still runs through the project's
`executeCommand`; this moves presentation only.

### 9. Home's chrome reuses the project tab-strip styling

`HomeWorkspace` wraps Dockview in `.workspace.dockview-theme-dark` so the
existing `--dv-*` variables and `.dv-tab` rules apply, with `--project-chrome`
set to the neutral Home colour. The `.home-band` element and its CSS are
removed; the tab strip takes its row, so the Home control still joins the strip
below it. A `HomeTab` tab component renders icon, title, unsaved mark, and close
button with the same chip markup classes as `TerminalTab`. The project-only
`+` and profile buttons are not injected into Home's strip. The macOS drag-region
rules are extended to Home's strip.

### 10. Compact workspaces show the active tab only

The existing rule hides `.dv-tabs-and-actions-container` in compact chrome. In
compact chrome `HomeWorkspace` additionally maximises the active group so a
remembered split does not squeeze two panes into a phone, and restores it when
the workspace widens. Non-section tabs render a header close control (the
former Back button's place) so they can be left without a tab strip.

### 11. Automation terminals keep their inner terminal host

`AutomationTerminalPanel` renders the existing `AutomationTerminalView`, which
mounts its own single-panel Dockview for `TerminalPanel`, with the inner tab
strip hidden. Flattening the terminal directly into Home's Dockview would mean
giving `TerminalPanel` a second host with different lifecycle rules; that is
left for a later change. Closing the Home tab detaches the view using its
existing unmount guard, which does not close the server terminal.

## Risks / Trade-offs

- [`renderer: 'always'` does not keep state as expected, or a hidden Home
  steals focus or key events] → spike task first; fall back to hoisting the
  editor form into the tab registry, which decision 6 already introduces.
- [Nested Dockview: dragging a Home tab over the inner terminal Dockview, or
  `.workspace .dv-*` CSS applying to both levels] → inner strip hidden and inner
  drop targets disabled; e2e covers dragging across it.
- [A restored Dockview document from an older build fails to load] → versioned
  key, try/catch, fall back to the default tab; unit-tested filter.
- [Stale-tab cleanup closes a tab during a slow connect] → only close when the
  server's automation list has loaded and lacks the id.
- [Moving the Command Bar dialog regresses project commands] → item assembly
  and launcher state stay in the project; existing Command Bar e2e must pass
  untouched apart from the Home cases.
- [Removing `/` surprises users of Home search] → the Command Bar shortcut is
  shown in the Home empty state and the overview.
- [Test churn across five e2e files] → keep existing `data-terminay-*` hooks on
  the moved elements; `data-terminay-home-view` reports the current section as
  before.
- [Spec sequencing: three unarchived changes modify requirements this change
  also modifies] → see Migration Plan.

## Migration Plan

1. Land behind no flag; the change is device-local and has no data to migrate
   beyond reading the old section key once.
2. Archive order: `compact-unified-switcher`, then `compact-command-bar-entry`,
   then this change, so "Compact bar presentation" folds in the right order.
   `dashboard-views-and-agent-detail`, the `dashboard-board-*` changes, and
   `notifications-icon-and-project-dot` touch other requirements in
   `workspace-dashboard` and can archive in any order relative to this one.
   `automation-prompt-agent-action` edits `AutomationEditor` fields; rebase the
   panel split onto it.
3. Rollback is a revert. A device that stored a Home layout simply ignores the
   key.

## Open Questions

- Should a `+` control in Home's tab strip offer New automation? Left out for
  now; the list's button and the Command Bar cover it.
- Should automation terminals be flattened into Home's Dockview (decision 11)?
  Deferred until the nested host proves awkward.
- Should **Run now** open the run's tab every time? It does, so the output is
  in front; a person running an automation repeatedly collects a tab per run.
