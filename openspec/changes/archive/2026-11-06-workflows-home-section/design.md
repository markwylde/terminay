## Context

Workflows (ADR-0097) are server-owned records bound to one terminal session. Each client already keeps a read-through projection of every attached server's workflows, keyed by session id: `useServerWorkflows` in `src/workspace/workflows/useServerWorkflows.ts`, published through `WorkflowsContext` from `App.tsx`. The terminal pane's `WorkflowPanel` renders one workflow; the tab badge and sidebar rows render its progress dial (change `workflow-progress-dial`).

Home is the workspace-wide view. Its sections live in `homeSection.ts`, its sidebar in `HomeView.tsx`, and its tabs in their own device-local dockview (ADR-0040, `HomeWorkspace.tsx`). The Tabs section's dashboard is built from `dashboardSources` in `App.tsx`: per server, the window's projects and the panel inventory, where every terminal panel carries its `sessionId`, title, and project. Activating a dashboard row goes through `activateDashboardRow`, which selects the project, leaves Home, and focuses the panel.

The prototype the user settled on is the "Columns" mock-up with a toolbar of view options, plus grouping laid out side by side or as rows.

## Goals / Non-Goals

**Goals:**

- One place in Home that shows every workflow the window can see, with the expanded panel's detail.
- Filter, group, sort, and density options that a user can combine, remembered per device.
- A needs-you count on the sidebar so a waiting workflow is noticed from anywhere in Home.

**Non-Goals:**

- Acting on a workflow from Home: no remove, resume, retry, answer, or launch controls. Home opens the terminal, where those already live. This keeps Home from writing to a terminal it is not showing (ADR-0097 decision 3; the terminal-session boundary).
- Any server, protocol, or MCP change, or a cross-server merge of workflow records.
- Workflows of terminals the window's dashboard does not list.

## Decisions

### 1. Join the workflow projection to the dashboard's inventory in the renderer

The section's rows are built by a pure function, `workflowsHomeModel.ts`, from two things the client already has: `WorkflowsContext` (server id → session id → workflow) and `dashboardSources` (server id → projects → terminal panels with session ids). A workflow is shown only when its `(serverId, sessionId)` is a terminal panel in that server's inventory, which gives it a project name, project colour, terminal title, and the dashboard panel row that activation needs. The inventory's title is only the one the row was built with: a terminal's displayed title arrives on the title stream (ADR-0058), so the section reads each column's title from `TerminalTitleStoreContext` before filtering and sorting, as the dashboard's own rows do.

A window is bound to one server (ADR-0047), and `dashboardSources` carries panel inventory only for the window's current server, so the join yields that server's workflows and nothing else. Rows are still keyed by `serverId` so that session ids are never compared across servers.

*Boundary:* the project/window and terminal-session boundary. The section never asks for workflows the client cannot already see, and dropping workflows whose terminal the window does not list means it never names or opens a terminal outside this window's reach. Activation passes the column's dashboard panel row to `activateDashboardRow`, the existing authority path, so automation-space terminals open in a Home tab, a project another view shows is brought into this window, and a row whose panel has gone resolves to nothing at click time. No new route exists to keep honest.

The section shows a loading state until the current server's `ServerWorkflows` entry exists, which `useServerWorkflows` publishes only after its first read; a server without the workflows capability publishes none, and the section then shows the no-workflows state.

*Alternative considered:* a server-side "all workflows with project names" query. Rejected: it duplicates what the inventory already says, needs a protocol change, and would have to re-derive per-client visibility.

### 2. The column reuses the panel's pieces, not the panel

`WorkflowPanel` is pane chrome with collapse, overlay, and remove behaviour tied to one terminal. The section needs a read-only card. `WorkflowsHome.tsx` renders its own column from the same `WorkflowStepMarker`, `doneCount`, `elapsed`, and `stepTime` helpers, and reuses `WorkflowDial` from `WorkflowTabBadge.tsx` for folded groups. Text goes through React text nodes only.

The panel's `isActive` covers only `running` and `needs_input`. The section adds its own `isHighlighted` (`running`, `needs_input`, or `failed`), used both for highlighting and for which notes **Current only** keeps, since a failed step can sit beside a running one.

One clock ticks for the whole section (the dial's 30-second interval), not one per column, so fifty columns cost one re-render per tick.

*Alternative considered:* rendering `WorkflowPanel` in expanded mode inside a card. Rejected: it would bring the Remove control and the device-wide collapse setting into Home.

### 3. Tone and ordering come from one function

Each workflow gets one tone: `alert` when a step is `failed` or `needs_input` or the workflow is unrestorable, `running` when a step is `running`, `done` when every step is done, else `idle`. This matches the tab dial's tone. The status filters, group counts, sidebar badge, and Needs-you-first sort all use it, so they never disagree. An unrestorable workflow is named "Workflow could not be restored" for display, text matching, name sorting, and grouping by Workflow.

"Most recent change" is the latest `startedAt` or `endedAt` across the steps; a workflow with none sorts last. The workflow record carries no update time, and step-time rules keep times unchanged when only a note changes or a step moves between `running` and `needs_input`, so **Recently updated** reflects step starts and ends, not every edit. The spec states it that way; a true update time would need a protocol change, which is out of scope.

### 4. View options are one versioned record in device storage

`workflowsHomeView.ts` reads and writes one JSON record in `localStorage` under a versioned key. It stores the text filter, selected statuses, the project keys left out (`serverId:projectId`), group, layout, sort, notes, the two toggles, and the folded group keys. Every read is validated field by field and falls back to the default for anything missing or wrong; any storage exception yields the defaults. Storing projects left out, rather than included, means a new project shows by default.

*Boundary:* none crossed; this is device presentation state, like Home's tab arrangement (ADR-0040). It is never written to server-owned state.

The tab also keeps its live state while hidden, which Home tabs already guarantee by staying mounted.

### 5. Layout is CSS over one model

The model returns either a flat list or ordered groups. Side by side renders groups as boxes inside the one horizontal scroller; Rows renders a vertical scroller of groups, each with its own horizontal scroller and fixed-height columns whose step lists scroll. Notes density and narrow columns are class names on the scroller, so they never change the model's output.

### 6. Section wiring

`workflows` is added to `HOME_SECTIONS` between `automations` and `recordings`, with the lucide `ListChecks` icon (Automations already uses `Workflow`). `HomeView` takes an optional per-section badge count and adds it to the item's accessible name. `HomeWorkspace`'s `renderSection` widens to `'home' | 'tabs' | 'workflows'`, and `App.tsx` renders `WorkflowsHome` with `serverWorkflows`, `dashboardSources`, and `activateDashboardRow`. A remembered `workflows` section tab restores like any other section. **Show workflows** is added next to **Show dashboard** in both command lists in `App.tsx`.

## Risks / Trade-offs

- [Many workflows make one long row] → Filters, project rows, folding, and narrow columns, plus one shared clock. The number of workflows is bounded only by terminals, so a unit check renders fifty workflows and asserts one tick re-renders the section once; virtualisation waits until that check or real use shows a need.
- [A workflow whose terminal is not yet in the inventory disappears during reconnect] → Accepted; it reappears with the inventory, as dashboard rows do. When the connection is removed, its `ServerWorkflows` entry goes and the section shows loading until the next first read.
- [Fixed column height in Rows hides long step lists] → The step list scrolls within the column, and Current only notes shortens it.

## Migration Plan

None. A device with no stored view gets the defaults; a device that remembers Home tabs gains a new section it has never opened.

## Open Questions

None.
