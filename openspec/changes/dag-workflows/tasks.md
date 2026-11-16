## 1. Server model: dependencies and status rules

- [x] 1.1 Add `after: readonly string[]` to `WorkflowTemplateStep`, `WorkflowStep`, and `WorkflowStepInput`, and bump both schema versions to 2 (`packages/server-core/src/workflowService/types.ts`). Verified by `npx turbo run build --filter=@terminay/server-core` compiling.
- [x] 1.2 Validate `after` in `normalize.ts`. Request-local ids map to server ids, and a step without `after` defaults to the step above it while `[]` means none. Every dependency must name an earlier step, with repeated dependencies and repeated request ids rejected (never de-duplicated) and at most 200 in total. Request ids are at most 64 characters, and the serialized size is the larger of the request encoding and the stored encoding with server ids. Stored v1 steps without `after` are read as a chain without re-checking bounds. `instantiateWorkflow` copies `after` onto the new ids. Verified by new cases in `packages/server-core/test/workflow-service.test.mjs`:
  - default chain and empty list;
  - a later, unknown, self or repeated reference refused, naming the step;
  - 201 links refused;
  - long aliases counted toward the size;
  - a v1 template at the 56 KiB bound still loads;
  - a v1 record loads as a chain;
  - a v2 record stripped of `after` loads as a chain;
  - a launched copy keeps its shape.
- [x] 1.3 In `steps.ts`, remove the single-active rule. Add `step_blocked` (with `stepIds`) when a step *starts* (to running or needs_input from a non-active status, or to done from not_started) while any dependency is unsettled, and add `readyStepIds` and the new `resumeStepId`. Replace `step_active` with `step_blocked` in `errors.ts` and `protocol.ts`. Verified by unit tests for:
  - two steps running together;
  - a blocked start and done-from-not-started;
  - skip and fail never blocked;
  - a running step finishing after its dependency is restored;
  - repeated done with a new note;
  - a v1 out-of-order workflow whose running step finishes;
  - the resume point scenarios in the spec delta, and ready ids.
- [x] 1.4 Expose `readyStepIds` on `SessionWorkflowView` and carry `after` through template commands and the store (`protocol.ts`, `store.ts`, `templateRepository.ts`). Verified by `workflow-composition.test.mjs` round-tripping a DAG template through save, reload and launch.
- [x] 1.5 Update the launch and resume instructions in `packages/protocol/src/workflows.ts` to name `after`, readiness and working ready steps together. Verified by `packages/protocol/test/workflows.test.mjs` asserting the words, and the launch text staying under 16 KiB for the largest opening prompt.

## 2. MCP surface

- [x] 2.1 Add per-step `id` and `after` to the `create_workflow`, `create_workflow_template` and `update_workflow_template` schemas, return `after` and `ready_step_ids` from `get_workflow`, and return `after` (no readiness) from `get_workflow_template` (`apps/terminay-server/src/mcp/workflowTools.ts`, `workflowAdapter.ts`, `stdio.ts`). Update tool descriptions to explain dependencies and `step_blocked`. Verified by `apps/terminay-server/test/workflow-tools.test.mjs`:
  - the parallel create scenario;
  - the unknown `after` id;
  - repeated given ids in template create;
  - a round-trip update keeping ids and `after`.
- [x] 2.2 Thread `step_blocked` through `controlEndpoint.ts`, `dispatcher.ts`, `appControlAdapter.ts` and `stdio.ts`, and remove `step_active`. Verified by `apps/terminay-server/test/stdio.test.mjs`:
  - `step_blocked` with the dependency id arrives through stdio;
  - a 50-step request at the size bound with 64-character aliases succeeds;
  - one just over the bound is refused, with both requests inside the frame.

## 3. Client core and shared graph model

- [ ] 3.1 Add `after` and `readyStepIds` to the client-core types and parsing (`packages/client-core/src/workflows.ts`), with missing `after` read as a chain. Make `workflowSerializedSize` count dependencies as server ids, the same way the server's stored encoding does. Verified by the build, a client-core parse test covering both shapes, and a size test matching the server's figure for the same template.
- [ ] 3.2 Add `src/workspace/workflows/workflowGraph.ts` with `analyzeStages`, `stageDepth`, `railWidth`, `metroLayout`, `traceDependencies` and `groupTone`, ported from the prototype. Verified by a new `src/workspace/workflows/workflowGraph.test.ts`, run with `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types` and added to `test:workflow-ui`. It covers the spec's example shapes: two reviews, the plain list, the "after UI" partial dependency, nested depth and the 72px cap, and metro columns and lanes. Also cover the 25-roots/25-leaves graph: it falls back to two layers, and its implied link count is 625.
- [ ] 3.3 Add `currentSteps` and `currentStepLabel` to `workflowPanelModel.ts`, and use them in `tabSummary`, `homeOverviewItems.ts`, `workflowsHomeModel.ts` and the compact switcher row. Verified by unit tests ("Server + 2 more", needs input first) and the existing `workflows-home-model` and compact switcher tests passing.

## 4. Settings and pane layout

- [ ] 4.1 Add the device-local layout setting (`terminay.workflowLayout.v1`, default vertical) and the drawer collapse setting (`terminay.workflowDrawer.v1`, default collapsed), each with its hook, in `workflowPanelSetting.ts`. Verified by unit tests: an unreadable value falls back, and the storage event propagates.
- [ ] 4.2 Add `drawerLayout` (drawer height = header + map, at most 240px; expanded when the terminal keeps ≥ 10 rows; else strip, with overlay ≤ 85% of the pane) to `workflowPanelModel.ts`. In `TerminalPanel.tsx`, reserve the bottom height in the horizontal layout and the computed rail width in vertical. Verified by unit tests of `drawerLayout`, and by e2e showing that the terminal never sits under the drawer.

## 5. Run views

- [ ] 5.1 Add `WorkflowOptionsMenu.tsx`: a ⋯ button and a menu with Show as Vertical/Horizontal and Remove workflow… with inline confirm and failure text. Keyboard navigation and Escape return focus, and no key reaches the terminal. Remove the foot `RemoveWorkflow` control. Verified by e2e:
  - switch layout from the expanded panel and from the collapsed rail, with keyboard only;
  - remove, cancel, and a remove failure;
  - Escape closes the menu first and returns focus to ⋯, and a second Escape closes the overlay.
- [ ] 5.2 Make the expanded vertical panel render the stage tree: brackets with group tone, track lines, dashed rules between tracks, "after …" text, several highlighted steps, and the running and needs-you counts in the header. Keep notes density, Skip/Restore, the brief and the width separator. Verified by e2e on the two-reviews and partial-dependency workflows, and by the existing workflow panel e2e suites passing.
- [ ] 5.3 Make the collapsed rail render capsules from the stage tree at the computed width (36 + 8 per nesting level, at most 72). Verified by e2e measuring the rail width for flat and nested workflows.
- [ ] 5.4 Add `WorkflowDrawer.tsx`: the expanded metro map (stations, labels, durations, done and waiting edges, scrolling inside the drawer, and a selected station's detail with Skip/Restore) and the 46px collapsed strip (count, small map, current steps in words). Add the narrow-pane overlay. Verified by e2e:
  - the expanded drawer;
  - strip text with mixed running and needs-input steps;
  - selecting a station with the keyboard (Tab, Arrow, Enter) and no keys reaching the terminal;
  - Skip from a station;
  - a stale Skip refused with `step_changed`;
  - the short-pane overlay and Escape.
- [ ] 5.5 Add hover, focus and tap tracing of upstream and downstream steps in the panel and the drawer. Verified by e2e hovering a step, focusing a step with the keyboard, and tapping a step (touch emulation), each checking the highlighted and dimmed classes and that they clear.
- [ ] 5.6 Make Home's Workflows columns render the same stage tree as the panel (`WorkflowsHome.tsx`). Verified by `scripts/workflows-home-ui.test.mjs`, and an e2e or home-workflows check that shows a bracket.

## 6. Outline template editor

- [ ] 6.1 Add `src/components/workflows/workflowOutlineModel.ts`: build an outline from steps, add then / alongside / track / at end, remove (collapsing empty tracks and one-track brackets), move within a track, and derive steps and `after` from the outline. Verified by unit tests for every operation and the derivation rules in the spec delta, and by derived links being counted so an over-bound shape (the 25/25 case) is reported before save.
- [ ] 6.2 Carry `after` and a `shapeChanged` flag in `workflowLibraryModel.ts` (draft, fingerprint, input). Saving keeps the stored `after` until the shape changes. Verified by unit tests for the "edit prompt keeps partial dependency", "shape change replaces it" and "outline implies too many dependencies" scenarios.
- [ ] 6.3 Replace `StepList` in `WorkflowsCategory.tsx` with the outline editor, with the actions from the spec delta and the notice for dependencies the outline cannot show. Keep the icon picker, prompt editing, the drag and Alt+Arrow handle within a track, and the launch preview. Verified by e2e in `e2e/workflows.spec.ts`: build a two-track template, save, launch, and see the bracket in the panel. Also run Alt+Arrow within a track.

## 7. Verification and docs

- [ ] 7.1 Run `npm run lint`, the server-core, protocol and MCP unit tests (`npx turbo run build --filter=...` first, then `node --test --test-force-exit --test-timeout=120000`), and `npm run test:workflow-ui`, bounded with `timeout`. Verified by all of them passing.
- [ ] 7.2 Run `npm run test:e2e` (Docker) on the workflow suites, and capture screenshots of the vertical expanded panel, the collapsed rail, the expanded drawer, the strip, the options menu and the outline editor. Verified by the suites passing and the screenshots being saved.
- [ ] 7.3 Run `openspec validate --all`, and sync the spec deltas into `openspec/specs/` when archiving. Verified by validation passing.
