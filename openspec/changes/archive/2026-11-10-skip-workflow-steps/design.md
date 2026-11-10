## Context

Workflows are server-owned checklists bound to one terminal session (ADR-0097). An agent reports each step's status through `update_workflow_step`, which the MCP adapter sends as the `workflow.update-step` command. The server validates it in `workflowService/protocol.ts` and applies it in `workflowService/steps.ts`. Clients render the result: the panel, the tab badge and dial, the Home overview and Workflows Home. Each client decides "done" and "finished" itself by checking `status === 'done'`.

There is no way to record that a step was dropped on purpose. In practice the agent marks the step `done` with a "Skipped" note. The step list is fixed once a workflow is attached, and that stays true.

## Goals / Non-Goals

**Goals:**
- Show a dropped step as dropped: a distinct status with a reason that agents and the user can set.
- Count skipped steps toward progress and completion everywhere "done" is counted today.
- Tell the agent, in the fixed launch and resume text, that `skipped` exists and when to use it.

**Non-Goals:**
- Removing, adding, reordering or editing steps of an attached workflow.
- Conditional steps or any rule that makes Terminay decide to skip a step. Terminay still never runs or judges a step (ADR-0097).
- Changing templates. Skipping acts on one workflow only.

## Decisions

1. **A `skipped` status, not a remove-step operation.** A status keeps the step and its reason visible, keeps step ids and positions stable for agents (which address steps by id), and fits the existing "any status may move to any status" rule, so a skip can be undone. Rejected: a `remove_workflow_step` tool. It loses the record of what was dropped and why, and it adds a structural mutation to a list that is otherwise fixed. Rejected: a `skipped` flag alongside the status. That would create two sources of truth for whether a step is settled.

2. **"Settled" = `done` or `skipped`, in one shared helper per layer.** Server-core gets `isSettled(status)`, and `isUnfinished`/`resumeStepId` use it. The client keeps a matching `isSettledStatus` in `workflowPanelModel.ts`, and every client-side `status === 'done'` / `!== 'done'` progress or finished check goes through it: tab badge, dial, Home overview, Workflows Home tone, counts and sort. One predicate stops the next status addition from drifting between surfaces.

3. **Times treat `skipped` like `done` and `failed`.** Moving to `skipped` sets the end time, and the start time too when there is none. The panel hides the duration of a skipped step, because a near-zero or partial duration would mislead.

4. **The panel's Skip/Restore reuse `workflow.update-step`.** That command already exists, is scoped `write`, and resolves its target against the exact terminal and project (the same authorization the remove-workflow action uses). Client-core gains `WorkflowClient.updateStep(target, stepId, status, note?)`. Boundary: this is a client → server privileged write, but it adds no new authority. It is the same operation agents reach through MCP, with the same target check. No new protocol operation is needed. The panel offers Skip only on `not_started` and `failed` steps, and Skip writes the note "Skipped from the panel" so that a failed step's old note isn't read as the skip reason. Hiding the action isn't enough on its own, because an agent can start the step after the panel renders. So `workflow.update-step` gains an optional `expectedStatus`, which the panel always sends. The store compares it with the step's current status inside the same write and refuses a mismatch with `step_changed`, changing nothing. This is optimistic concurrency on one step. It avoids a lock and leaves the agent's MCP path unchanged, because `update_workflow_step` never sends it. The agent can still set any status.

7. **Resume covers every unsettled step, not just later ones.** Restore can reopen a step that comes before the active one. The resume instruction now says "then every other step that is not done or skipped, in step order", and `resumeStepId` keeps its rule (active step first, then the first unsettled step). Rejected: moving the resume point back to the restored step while a later step runs. That would point the agent away from the work it is in the middle of.

5. **The fixed launch and resume instructions mention `skipped`.** The text lives in `packages/protocol/src/workflows.ts` and is still the only text a workflow makes Terminay type (ADR-0097). It gains one sentence about skipping, and the "continue until" clause becomes "done or skipped". Both stay well inside the 16 KiB bound.

6. **Visual treatment.** The marker is dashed grey and dimmed (opacity), with a dash glyph when the step has no icon. In the expanded panel the title is struck through and dimmed, with its note shown. The accessible name reads "<title>: skipped".

## Risks / Trade-offs

- [A client surface misses the new status and treats a skipped step as unfinished] → route every progress/finished check through the settled helper. Grep for `=== 'done'` and `!== 'done'` on step status as a verification task, and add unit tests on the panel and home models.
- [Agents misuse `skipped` to dodge failing work] → the instruction limits it to steps the agent is told to drop or that don't apply. A note is expected, and the panel shows it. The user can Restore.
- [A user skips a step just as an agent starts it] → `expectedStatus` makes the stale Skip fail with `step_changed`, and the panel says so. A Skip that lands first is visible to the agent's next `update_workflow_step` result and `get_workflow`. Each result returns the whole workflow.
- [A persisted workflow holding `skipped` is read by an older server] → that server's validation rejects the file and falls back to the previous committed copy, which may be stale, or shows the could-not-restore state. See Migration Plan.

## Migration Plan

No data migration: existing workflow files hold only the five existing statuses, which stay valid. Ship server and client together, as the server bundles the workspace UI.

Rollback is not a plain revert for a data root that already holds `skipped`. Before downgrading, set every skipped step to `done` or `not_started`, or remove those workflows. Otherwise the older server restores a stale previous copy or marks the workflow unrestorable. The user can then remove it from the panel. Terminal sessions themselves are unaffected.

## Open Questions

None. ADR-0097 stays in force. Skipping is a recorded status that an agent or the user sets, not Terminay running or choosing steps.
