## 1. Server status rules

- [x] 1.1 Add `skipped` to `WORKFLOW_STEP_STATUSES` in `packages/server-core/src/workflowService/types.ts`, and update the `status must be …` error text in `protocol.ts`. Verify: `workflow-service.test.mjs` accepts `skipped` and still rejects an unknown status.
- [x] 1.2 Add `isSettled` in `steps.ts` and use it in `isUnfinished` and `resumeStepId`. Make `applyStepUpdate` treat `skipped` like `done`/`failed` for times. Verify: new server-core tests for an all-skipped workflow, a mixed done/skipped workflow finishing, the resume point passing over a skipped step, a restored earlier step while a later one runs (resume point stays on the active step), not_started→skipped (equal times), running→skipped (end set, start kept), skipped→running (start now, no end), repeated skipped with a new note (times unchanged), and skipped→not_started (times and note cleared).
- [x] 1.3 Confirm that persisted workflow normalisation accepts `skipped`, and that a stored workflow holding it survives a store reload. Verify: a store round-trip test in `workflow-service.test.mjs`.
- [x] 1.4 Add optional `expectedStatus` to `workflow.update-step`. The store checks it inside the same update and throws `step_changed` (naming the current status) on a mismatch, writing nothing. Verify: server-core tests show a matching expected status applies, a stale one fails with `step_changed` and leaves the step and file unchanged, and an invalid value is `invalid_workflow`.
- [x] 1.5 Verify authorization for client step updates: a server-core composition test where an update naming a terminal outside the caller's project is refused, and no step changes.

## 2. Launch and resume text

- [x] 2.1 Update `WORKFLOW_LAUNCH_INSTRUCTION` and `WORKFLOW_RESUME_INSTRUCTION` in `packages/protocol/src/workflows.ts`. Launch: set a step that's dropped or doesn't apply to skipped with a reason, and continue until every step is done or skipped. Resume: after the resume point, every other step that is not done or skipped, in step order, plus the same skip sentence. Verify: the existing launch/resume text tests assert the new sentences and pass.

## 3. MCP surface

- [x] 3.1 Add `skipped` to `WORKFLOW_STEP_STATUSES` in `apps/terminay-server/src/mcp/workflowTools.ts` and to the `update_workflow_step` enum and description in `stdio.ts`. The tool sends no `expectedStatus`. Verify: `workflow-tools.test.mjs` gains a case where `update_workflow_step` with `skipped` and a note succeeds and `get_workflow` reports it. The stdio tool-list test still passes.

## 4. Client core

- [x] 4.1 Add `skipped` to `WORKFLOW_STEP_STATUSES`, and add `WorkflowClient.updateStep(target, stepId, status, { note, expectedStatus })` in `packages/client-core/src/workflows.ts`, sending `workflow.update-step` with the target payload. Verify: `npx turbo run build --filter=@terminay/client-core...` succeeds, and a server-core composition test drives the operation through a client.

## 5. Workspace UI

- [x] 5.1 In `workflowPanelModel.ts`, add the `skipped` marker (dashed, dimmed, dash glyph), the `skipped` label, `isSettledStatus`/`isFinished`, `finishedLabel`, and step-action eligibility (`canSkip`/`canRestore`). Use them for `doneCount`, the dial, `finished`, and the current/next step. Verify: `scripts/workflow-ui.test.mjs` (already in `npm run test:workflow-ui`, part of `smoke`) covers the marker and label, all-skipped and mixed done/skipped counts, finished state and label, dial tone, elapsed time, the Restore reopening, and the action eligibility per status.
- [x] 5.2 Route `WorkflowTabBadge.tsx`, `workflowsHomeModel.ts`, and `homeOverviewItems.ts` through the settled helpers wherever they count done steps or decide finished. (`WorkflowsHome.tsx` and `homeOverviewWidgets.tsx` only read tones and counts computed by those models.) Verify: `scripts/workflows-home-model.test.mjs` covers counts, done tone, hiding finished workflows, and progress sort with skipped steps. Grep finds no remaining step-status `=== 'done'` / `!== 'done'` checks in `src/workspace`, and the root `tsc --noEmit` reports no errors.
- [x] 5.3 Make the existing workflow UI test actually run its whole file. Every top-level `await bundle(...)` now sits before the first test, because tests declared after a later await never ran under `--test-force-exit` (9 of 41 ran on `main`). Verify: `node --test --test-force-exit --test-timeout=120000 scripts/workflow-ui.test.mjs` reports 41 tests, 41 passing.
- [x] 5.4 In `WorkflowPanel.tsx`/`.css`, style skipped markers and rows (title struck through and dimmed, note shown, no duration). Add Skip on `not_started`/`failed` steps, sending note "Skipped from the panel", and Restore on `skipped` steps, both with `expectedStatus` set to the status shown. Show an inline failure message when the update fails. Verify: e2e in 6.1.

## 6. End-to-end and checks

- [ ] 6.1 Extend `e2e/workflows.spec.ts`: an agent-set `skipped` step shows struck through with its note and counts toward progress; the user skips a not-started step and restores it from the panel, and the change shows in `get_workflow`; no Skip appears on the running step. Capture screenshots of the rail and expanded panel with a skipped step. Verify: `npm run test:e2e -- e2e/workflows.spec.ts` passes in Docker.
- [ ] 6.2 Run `npm run lint`, `npm run typecheck`, the server-core and terminay-server node tests (bounded), the model tests, and `openspec validate --all`. Verify: all exit 0, or any pre-existing unrelated failures are recorded.
