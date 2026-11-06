## 1. Model

- [x] 1.1 Add `src/workspace/workflows/workflowsHomeModel.ts`: join `WorkflowsContext` with `dashboardSources` into rows keyed by server and session (workflow, project name and colour, terminal title, the dashboard panel row), dropping workflows whose terminal is not a listed panel; one `workflowTone` (alert for failed, needs_input or unrestorable; running; done; idle); `isHighlighted` (running, needs_input, failed); display name ("Workflow could not be restored" when unrestorable); latest step time. Verified by unit tests covering the join, a dropped unlisted session, the same session id on two servers, an unrestorable workflow's tone and name, and each tone including failed beside running.
- [x] 1.2 Add filtering (text over display name, terminal title, project name; statuses with none meaning all; excluded projects; show finished), status counts over the included projects, the needs-you count over all rows, and the shown-of-total count. Verified by unit tests for each filter, combinations, a new project being included, and the needs-you count ignoring filters.
- [x] 1.3 Add sorting (needs you first, recently updated, most progress, name) and grouping (none, project, display name) with per-group tone counts and groups ordered by their first member. Verified by unit tests for each sort, including workflows with no step times, and each grouping.

## 2. Device-local view options

- [x] 2.1 Add `src/workspace/workflows/workflowsHomeView.ts`: defaults, a versioned `localStorage` record validated field by field, read and write wrapped so any failure yields the defaults, and reset. Verified by unit tests for round trip, corrupt and partial records, throwing storage, and reset.

## 3. Section UI

- [x] 3.1 Add `WorkflowsHome.tsx` and `WorkflowsHome.css`: the toolbar (text, status chips with counts and `aria-pressed`, project checklist with include/leave out all, group, layout shown only while grouped, sort, notes, Show finished, Narrow columns, Reset view), the shown-of-total count, the columns (header, brief as a disclosure, steps with markers, times and notes, highlighted steps, open control, needs-you marking, unrestorable column), side-by-side groups and rows with keyboard-operable folding (`aria-expanded`) and dials, and the loading, no-workflows and no-match states. All workflow text as text nodes. Verified by `scripts/workflows-home-ui.test.mjs` (static renders of each option, each state, Current only with a failed and a running step, and the markup note case) and by `tsc --noEmit` reporting no error in the changed files.
- [x] 3.2 Tick elapsed and running times with one section-wide clock at the dial's interval. Verified by the single `useSectionNow` clock in `WorkflowsHome.tsx` (columns take `now` as a prop and hold no timer) and by a test that renders fifty workflows as fifty columns within a second.
- [x] 3.3 Read each column's terminal title from the live title stream (ADR-0058), so a rename shows while Home is in front and the filter and name sort use the title shown. Verified by the rename step in 5.1.

## 4. Home wiring

- [x] 4.1 Add `workflows` to `HOME_SECTIONS` between automations and recordings, its label and icon; give `HomeView` an optional badge count per section included in the accessible name. Verified by `src/workspace/homeTabs.test.ts` and the HomeView renders in `scripts/workflows-home-ui.test.mjs` (order, badge, accessible name, no badge at zero).
- [x] 4.2 Render the section from `HomeWorkspace` and `App.tsx` with `serverWorkflows`, `dashboardSources`, and `activateDashboardRow`; pass the needs-you count to the sidebar whether or not the tab is open. Verified by `tsc --noEmit` and the e2e in 5.1.
- [x] 4.3 Add **Show workflows** beside **Show dashboard** in the project and workspace Command Bar lists. Verified by the e2e in 5.1.

## 5. End to end

- [x] 5.1 Add `e2e/home-workflows.spec.ts` (run through `npm run test:e2e`): workflows in two projects appear as columns; a step update, a terminal rename, a workflow removal and a terminal close show live; the sidebar count with the tab closed; text, status and project filters; grouping by project as rows; folding by keyboard; reset; the view surviving a reload; Show workflows from a project and from Home; the open control focusing the terminal. Show workflows with no project shares the list that offers Show dashboard there, and a stale column resolves its panel at click time through `activateDashboardRow`; neither has a deterministic e2e. Verified by the suite passing in Docker.
- [x] 5.2 Update existing e2e and unit tests that assert five Home sections. Verified by `npm run test:workspace-models` and the affected e2e suites passing.

## 6. Checks

- [x] 6.1 Run `npm run lint`, `tsc --noEmit`, `npm run test:workflow-ui`, `npm run test:workspace-models`, and `openspec validate --all`. Verified by lint, typecheck and tests passing, and by `openspec validate --all` reporting no failure in this change (six failures in other changes predate it).
