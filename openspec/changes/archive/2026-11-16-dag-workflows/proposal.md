## Why

Workflows run one step at a time. A routine like "propose, have two reviewers look at it, then build the server, the UI and the docs" can only be written as a single line, so the agent works through steps it could do side by side one after another, and the panel can't show that two pieces of work are under way at once. Users want workflows shaped as a dependency graph (a DAG): each step waits on the steps it needs, and anything whose dependencies are met can run alongside other work.

The data model, the "one active step" rule, the panel and the template editor all assume a flat list, so this needs a change to each of them, not just a new panel.

## What Changes

- **Steps declare what they wait on.** Every template and workflow step has a dependency list (`after`) naming earlier steps; a repeated or forward reference is refused. A step with no dependencies starts at launch. A step given without one waits on the step above it, so a plain list still means "one after another".
- **BREAKING** (MCP): the single-active-step rule goes. Any number of steps may be `running` or `needs_input`. Starting a step whose dependencies are not all done or skipped fails with a new `step_blocked` error, which names them. A step already under way can always report and finish. `step_active` is no longer returned.
- `get_workflow` returns each step's `after` and a `ready_step_ids` list. `create_workflow`, `create_workflow_template` and `update_workflow_template` accept `after` on each step, which refers to other steps in the same request by the `id` given to them.
- The resume point and the launch and resume instructions follow dependencies, not list order. They tell the agent that steps whose dependencies are met may be worked at the same time.
- **The run view can be vertical or horizontal.** Vertical is the side panel. Steps that run at the same time sit inside a bracket, a line joins steps that run one after another inside a bracket, and "after …" shows only a dependency the brackets cannot. Horizontal is a drawer along the bottom of the pane that draws the workflow as a metro map: stations for steps, with lines that split and join. Collapsed, the drawer is a one-row strip.
- **A ⋯ menu at the top right of the panel or drawer** holds "Show as Vertical / Horizontal" and "Remove workflow…", which replaces the Remove control at the foot of the panel. The layout is one device-local choice. Collapsed or expanded is remembered for each layout separately.
- **The template editor becomes an outline.** Each step has "+ then" (add a step after it) and "+ alongside" (run a new step at the same time). Each group has "+ another track alongside". The outline itself sets every step's dependencies. Steps are reordered within their track.
- Every surface that names a workflow's "current step" (tab tooltips, Home, the compact switcher) works out which steps are current from dependencies, and names how many more are active when there is more than one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: dependencies on templates and workflows, the step status rules (several active steps, `step_blocked`), the resume point and the instructions, the MCP tool shapes, the vertical panel's brackets and collapsed rail, the new horizontal drawer, the ⋯ menu with layout and Remove, the device-local layout setting, the outline template editor, and how current steps are named.
- `workspace-dashboard`: the Workflows widget's current step when several steps are active, and Home's Workflows columns showing the vertical panel's brackets.

## Impact

- `packages/server-core/src/workflowService/` (types, normalize, steps, launchText, protocol, store): the dependency list, its validation, schema version 2 with loading of stored version 1 records, `step_blocked`, the resume point and `ready_step_ids`.
- `packages/protocol/src/workflows.ts`: the launch and resume instructions.
- `packages/client-core/src/workflows.ts`: types and the template input.
- `apps/terminay-server/src/mcp/workflowTools.ts`, `workflowAdapter.ts`: tool schemas and descriptions, and the error codes.
- `src/workspace/workflows/`: a shared layout model (brackets and metro), the panel, a new horizontal drawer, the ⋯ menu, panel settings, and current-step naming on the tab, Home and compact surfaces.
- `src/components/settings/WorkflowsCategory.tsx`, `src/components/workflows/`: the outline editor.
- Tests: server-core, protocol and MCP unit tests, plus e2e suites for workflows and the panel. ADR-0097 decision 4 ("templates are flat, ordered lists") is superseded by a new ADR.
