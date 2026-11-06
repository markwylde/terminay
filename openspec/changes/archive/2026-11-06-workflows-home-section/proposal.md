## Why

A workflow is only visible inside its own terminal pane, so with agents driving workflows in several terminals across several projects there is no one place to see which are moving, which are stuck, and which need you. You have to open each project and look at each terminal in turn, and a workflow waiting for an answer can sit unnoticed.

## What Changes

- Add a **Workflows** section to the Home sidebar, between Automations and Recordings. Its sidebar item shows how many workflows need you (a step that failed or is waiting for input, or a workflow that could not be restored).
- The section shows every workflow on a terminal the dashboard lists (the window's one server, ADR-0047) as a horizontally scrolling row of columns. Each column is the expanded workflow panel as a card: name, project, terminal, progress, elapsed time, the brief, and each step with its marker, time and note. Its open control opens the terminal exactly as its dashboard row does. A workflow that could not be restored gets a column that says so.
- A toolbar sets how the row is shown:
  - **Filter** by text (workflow name, terminal title, project name), by status (Needs you, Running, Done; any combination, none meaning all), and by project (a checklist of projects).
  - **Group** by nothing, by project, or by workflow name. Grouped workflows are laid out **side by side** in one row, or as **rows**, one row per group, each scrolling sideways on its own. A group can be folded down to its header and a progress dial for each workflow.
  - **Sort** by needs-you-first, recently updated, most progress, or name.
  - **Notes**: show each step's note in full, cut to two lines, or only the current step's.
  - **Show finished** and **Narrow columns** toggles, and **Reset view**.
- The view choices are remembered on the device, and never written to the server.
- The section updates live, says when workflows are still loading, and has empty states for no workflows and for a view that matches none.
- The Command Bar gains **Show workflows** wherever it offers **Show dashboard**, which opens the section.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-dashboard`: Home's sidebar and its empty state gain a sixth section, Workflows. New requirements define the Workflows section, its columns, its view options, how they are remembered, and its needs-you count.

## Impact

- `src/workspace/homeSection.ts`, `HomeView.tsx`, `HomeWorkspace.tsx`: the new section, its icon, its sidebar badge, and its tab.
- New `src/workspace/workflows/WorkflowsHome.tsx`, `workflowsHomeModel.ts` (pure filter, group and sort), `workflowsHomeView.ts` (device-local view options), and `WorkflowsHome.css`. The step list shares the expanded panel's markers and times from `workflowIcons.tsx` and `workflowPanelModel.ts`.
- `src/App.tsx`: renders the section from the existing `WorkflowsContext` joined with the dashboard sources, so each workflow is named by its project and terminal, and activation goes through the dashboard's existing panel activation.
- E2E coverage under `e2e/` for the section and its options.
- No server, protocol, or MCP change. The section reads only the workflow state and workspace inventory clients already receive, so it shows only workflows whose terminals this client can already see, on the window's one server.
