## Context

Workflows (ADR-0097) are server-owned checklists bound to one terminal session. An agent drives them through `get_workflow` and `update_workflow_step`. Today they are flat:

- `WorkflowTemplateStep` and `WorkflowStep` have no dependency field.
- `applyStepUpdate` allows at most one active step and refuses a second one with `step_active`.
- The resume point is "the active step, else the first unsettled step".
- The client draws one column of markers (`WorkflowPanel.tsx`) and edits steps as a draggable list (`StepList` in `WorkflowsCategory.tsx`).

The user settled the product shape with prototypes (see proposal). Steps declare dependencies, and the plan's shape is drawn from them, not authored. The run view is either a vertical "quiet stages" panel or a horizontal metro drawer, chosen from a ⋯ menu that also holds Remove. The template editor is an outline.

Constraints:

- Terminay Server owns workflow state and validates every input. Clients and agents are untrusted.
- The workspace UI is bundled by the server (`workflows.v1` capability). A client and the server it talks to therefore ship together, so there is no mixed-version template editing to protect against.
- Terminay never runs a step (ADR-0097 decisions 1–3 stand).

## Goals / Non-Goals

**Goals:**

- Dependencies on templates and workflows, validated by the server, kept acyclic by construction.
- Several steps active at once, and a refusal (`step_blocked`) when a step starts before its dependencies are settled.
- Launch and resume text, `get_workflow` and the resume point that follow dependencies.
- The vertical panel with derived brackets, the collapsed capsule rail, the horizontal drawer and strip, the ⋯ menu, and the device-local layout setting.
- The outline editor, which derives dependencies from its shape and keeps dependencies it cannot show until the shape changes.
- One definition of "current steps" for the tab, Home and the compact switcher.

**Non-Goals:**

- Terminay starting, scheduling or advancing steps. The agent still decides what to run, including in parallel.
- Conditional branches, loops, or steps that run only when another fails.
- Undo after Remove. The prototype showed Undo, but removing ends the server record. Re-creating it would mint new ids and lose statuses and times, so the inline confirmation is the safeguard.
- Resizing the horizontal drawer, or a note density control for it. Its notes show in the selected station's detail line.

## Decisions

### 1. `after` is a list of earlier step ids, stored as given

Each template step and workflow step gains `after: readonly string[]`. Validation (`normalize.ts`) requires every id to name a step *above* it, rejects a repeated dependency or a repeated request id (never silently de-duplicating), and allows at most 200 links in total. Referring only upward makes cycles impossible, so no cycle detection is needed, and list order stays a topological order.

Dependencies are stored as given, sorted into step order. They are not reduced. `get_workflow` returns what the agent or editor said. The client works out the transitive reduction for display.

*Alternative considered:* storing only the transitive reduction. It would make a later "remove step B" silently drop a dependency that only went through B, and it surprises an agent that reads back different `after` lists from the ones it sent.

**Absent vs empty.** A step command without an `after` field means "after the step above". An empty array means "no dependencies". The record schema versions become 2. Reading stored version 1 data is covered in the Migration Plan.

**Boundary:** server-owned persisted state. The server validates; the client never decides a dependency's validity.

### 2. Request-local ids map `after` in MCP and template commands

`create_workflow`, `create_workflow_template` and `update_workflow_template` take an optional `id` per step, and `after` refers to those ids. The server assigns fresh ids, or keeps known template step ids exactly as it does today, and rewrites `after` through the mapping. An `after` naming an unknown or later id is `bad_request` naming the step.

**Sizing.** A request id is at most 64 characters. The serialized size is the larger of the request's own encoding (with its given ids and `after` as sent) and the stored encoding (with server ids, as `get_workflow` returns it). Both must fit 56 KiB. Long request aliases therefore can't push a request past the 64 KiB MCP frame, and server ids can't push a response past it. The client's `workflowSerializedSize` in `packages/client-core` computes the same stored encoding, so Settings shows the size the server enforces. A stdio test sends a request at the bound with 64-character aliases.

*Alternative considered:* `after` as 1-based positions. It is easier for agents to write, but the existing spec forbids addressing steps by position. Ids also round-trip with `get_workflow_template`.

### 3. `step_blocked` replaces `step_active`

`applyStepUpdate` drops the single-active rule. Dependencies constrain only **starting** a step:
- moving to `running` or `needs_input` from a status that is not active;
- moving to `done` from `not_started`.

Starting a step checks that every dependency is settled. Otherwise it throws `step_blocked` with `stepIds` (unsettled dependencies, in step order). Every other transition is allowed:
- moving between `running` and `needs_input`;
- finishing an active step;
- repeating `done` with a new note;
- `failed`, `skipped` and `not_started`.

A step already under way, or one carried over from an older out-of-order record, can therefore always report progress and finish, even after a dependency has been reopened.

*Alternative considered:* checking dependencies on every report. It strands a running step whenever a prerequisite is restored, which the agent can't fix.

The new code is threaded through every error map that lists `step_active` today: `errors.ts`, `protocol.ts`, `controlEndpoint.ts`, `dispatcher.ts`, `appControlAdapter.ts` and `stdio.ts`. `step_active` is removed. This is a **breaking MCP change**. An agent that relied on `step_active` to serialise itself now gets parallelism instead.

**Boundary:** MCP control endpoint and stdio adapter. Error codes pass through unchanged.

### 4. Readiness and resume point are server-computed

`steps.ts` gains `readyStepIds(workflow)` and a new `resumeStepId`: the first active step, else the first ready step, else the first unsettled step. `SessionWorkflowView` carries `readyStepIds`, so clients and MCP read one answer.

The launch and resume instructions in `packages/protocol/src/workflows.ts` say:

- start a step only once everything in its `after` list is done or skipped;
- ready steps may be worked at the same time.

### 5. One pure graph module drives every view

`src/workspace/workflows/workflowGraph.ts` (client-only, pure, unit-tested) exports:

- `analyzeStages(steps)` → `{ tree, reduced, implied }`. This is the prototype's `analyze`:
  - ancestor sets give the transitive reduction;
  - a recursive decomposition splits a set in series at "cut" steps (comparable with every other step), else into parallel tracks by the connected components of the comparability graph, else into local rank layers;
  - implied dependencies come from walking the tree.
  - Tracks keep step order. It is deterministic and O(n³) for n ≤ 50.
- `stageDepth(tree)`. The rail width is `min(72, 36 + 8·max(0, depth − 1))`.
- `metroLayout(steps)`:
  - column = 1 + the deepest dependency's column;
  - lane = the first free lane, preferring a dependency's lane, the same as the prototype;
  - edges, with done/waiting state.
- `traceDependencies(steps, id)` → `{ upstream, downstream }`.
- `groupTone(steps)` gives the bracket colour.

The vertical panel, the rail, Home's Workflows columns, the drawer and strip, and the outline editor all consume it. Brackets therefore look the same everywhere, and no surface invents its own shape.

*Alternative considered:* an authored tree stored on the server. It was rejected by the user's decision that brackets are derived. It would also let MCP-created workflows (which give only `after`) and edited ones disagree.

### 6. Layout and collapse settings stay device-local

`workflowPanelSetting.ts` gains:

- `terminay.workflowLayout.v1` (`vertical` | `horizontal`, default and fallback vertical);
- `terminay.workflowDrawer.v1` (`collapsed` | `expanded`, default collapsed) for the horizontal layout.

They follow the same store, `storage`-event sharing and `useSyncExternalStore` hooks as the existing collapse, width and notes settings. Nothing is sent to the server.

**Boundary:** none crossed. These are renderer-local preferences.

### 7. The terminal pane reserves width or height

`TerminalPanel.tsx` today asks `panelLayout()` how much width to reserve on the right. A sibling `drawerLayout(paneHeight, rowHeight, setting)` decides between expanded, strip, or strip with overlay, using the 10-row minimum. The terminal host then gets `bottom` reserved instead of `right`. The xterm fit runs on either change, exactly as the width resize does now.

The vertical rail's reserved width becomes the computed rail width (36–72), not the constant `WORKFLOW_RAIL_WIDTH`.

### 8. One options menu component

`WorkflowOptionsMenu.tsx` renders the ⋯ button and a `role="menu"` popover:

- "Show as" radio items;
- a separator;
- "Remove workflow…", which swaps to an inline confirmation (Cancel / Remove).

It uses the existing `client.remove(target)` call and its failure text. Focus returns to the ⋯ button on Escape. Key events stop at the menu, so the terminal receives nothing. The panel's foot `RemoveWorkflow` control is deleted. The unrestorable-workflow state keeps its own remove offer, because there is no workflow to show options for.

### 9. Outline editor model

`src/components/workflows/workflowOutlineModel.ts` (pure, unit-tested) holds a draft's steps as an outline: `Item = StepKey | { tracks: Item[][] }`.

- `outlineFromSteps(steps)` builds it with `analyzeStages`.
- Operations: `addThen`, `addAlongside`, `addTrack`, `addAtEnd`, `removeStep` (collapses empty tracks and one-track brackets), `moveWithinTrack`.
- `stepsFromOutline(outline)` returns the steps in outline order with `after` derived.

A shape change can imply far more links than the stored graph had: the rank-layer fallback joins every step of one layer to every step of the next. Saving then counts the derived links first. Over 200, the save is refused with the implied count and the bound, the same way any bound is enforced, and the user can restructure.

`DraftTemplate` carries a `shapeChanged` flag:

- while it is false, saving keeps each step's stored `after`;
- once any shape operation runs, saving uses the derived dependencies.

The editor shows the reduced-vs-implied "after …" text and the notice when they differ. `templateFingerprint` includes `after`, so a shape change marks the template unsaved.

The existing drag-and-Alt+Arrow handle code is reused per track.

### 10. One "current steps" helper

`workflowPanelModel.ts` gains `currentSteps(steps)` (needs-input, then running, in step order; else the first failed; else the first ready) and `currentStepLabel(steps)` ("Server + 2 more"). The other places call them:

- `tabSummary`;
- `homeOverviewItems.currentStep`;
- `workflowsHomeModel`;
- the compact switcher's second line.

That replaces their three hand-rolled versions. A step needing input reads "Docs needs you + 2 more". The collapsed strip is the one exception: it has room for a row, so it lists every active step in step order.

### 11. Drawer height

The expanded drawer is as tall as its header plus its map need, at most 240px. `drawerLayout` takes that height, the pane height and the row height. It expands when `paneHeight − drawerHeight ≥ 10 rows`. Otherwise it shows the 46px strip, with the 85%-of-pane overlay on expand. The ⋯ menu handles Escape before the overlay does: the first Escape closes the menu, the second closes the overlay.

## Risks / Trade-offs

- [An agent written for `step_active` now sees two steps running and may be confused] → The launch and resume text explain the dependency rule. `step_blocked` names exactly what is unsettled. A plain list still behaves sequentially, because each step waits on the one above.
- [The outline cannot express a partial dependency (e.g. E2E waiting only on UI)] → The editor keeps such dependencies until the shape changes and says so. MCP can still author any DAG.
- [The derived arrangement may surprise users for unusual DAGs (the local-rank fallback)] → "after …" text always shows any dependency the brackets don't imply, so nothing is hidden. Unit tests pin the decomposition for the spec's example shapes.
- [A larger `get_workflow` response] → `after` is inside the 56 KiB serialized bound, counted as server ids, plus a 200-link cap.
- [More layout states in `TerminalPanel` (vertical and horizontal, each collapsed, expanded or overlay)] → The layout decisions live in pure functions (`panelLayout`, `drawerLayout`) with unit tests. E2E covers each state.

## Migration Plan

- **Reading version 1 data.** A stored template or workflow step without `after` loads as waiting on the step above it. The lenient loaders apply this chain *without* re-checking the size bound or the link cap. A template that was valid near 56 KiB is therefore never dropped because its implied chain adds bytes. Its next save from Settings or MCP is checked normally.
- **Out-of-order version 1 workflows.** Before this change, any step could run in any order, so a converted record can have a running or done step whose implied predecessor isn't settled. Because dependencies constrain only starting (decision 3), such a step can still report and finish. Nothing is rewritten on load. A record is written as version 2 on its next change.
- Fixtures in `workflow-service.test.mjs` cover:
  - a version 1 template at the size bound;
  - a version 1 workflow with step 3 running while step 2 is not started, which then finishes.
- **Rollback loses the graph.** An older server reads a version 2 file, ignores `after`, and rewrites the record without it on its next change. Upgrading again then reads that record as a chain, so the parallel shape of any template or workflow touched while downgraded is lost. Untouched files keep `after`. This is accepted and documented in ADR-0128. The test for it: a version 2 record stripped of `after` by the old normaliser loads as a chain.

## Open Questions

- None blocking. The prototype the user approved, with the reference `analyze` and `metro` code, is kept at `openspec/adr/evidence/0128-dag-run-layouts-prototype.html`. ADR-0097 decision 4 ("Templates are flat, ordered lists") is superseded by a new ADR recorded in the adr step. Decisions 1–3 carry forward unchanged.
