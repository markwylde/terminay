## Why

A workflow's opening prompt can tell the agent to drop a step that doesn't apply, for example "if this isn't a visual change, delete the E2E test and screenshots step". The agent has no way to do that. The step statuses are `not_started`, `running`, `done`, `failed` and `needs_input`, and the launch text says "continue until every step is done". So the agent marks the dropped step `done` with a "Skipped" note. The panel then claims work happened that never did, and a reader can only tell from the note. The user has no way to drop a step from the panel either.

## What Changes

- Add a sixth step status, `skipped`: a settled state like `done` that records a step was deliberately not carried out. `update_workflow_step` and the `workflow.update-step` operation accept it, and the step's note says why.
- A step is *settled* when it is `done` or `skipped`. A workflow is finished when every step is settled. The resume point skips settled steps, and progress counts settled steps everywhere it counts done ones.
- The workflow panel shows a skipped step as distinct from both done and not started. Its marker is grey with a dash, and in the expanded panel its title is struck through and shows its note. It has no duration.
- The expanded panel lets the user skip a step that is `not_started` or `failed`, and restore a skipped step to `not_started`.
- The launch and resume instructions tell the agent to set a step it has been told to drop, or that does not apply, to `skipped` with a one-line reason, and to continue until every step is done or skipped.
- Out of scope: removing steps, and adding or editing steps on a running workflow. A workflow's step list stays fixed once it is attached.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: the step status set, the unfinished/finished rule, step times, the resume point, the collapsed rail and expanded panel, the launch and resume text, and the `update_workflow_step` contract all gain `skipped`. A new requirement covers skipping and restoring a step from the panel.

## Impact

- `packages/server-core/src/workflowService` (`types.ts`, `steps.ts`, `protocol.ts`, `normalize.ts`): status set, finished/resume rules, times, error text. Persisted workflow files gain a value they may hold. A server that predates this change would reject a file holding `skipped`, but nothing downgrades a data root.
- `packages/protocol/src/workflows.ts`: launch and resume instruction text.
- `packages/client-core/src/workflows.ts`: status list and a new `updateStep` client method.
- `apps/terminay-server/src/mcp` (`stdio.ts`, `workflowTools.ts`): status enum and tool description.
- `src/workspace/workflows/*` and `src/workspace/homeOverview*`: marker, label, progress, dial, Home and Workflows Home counts, and the panel's Skip and Restore actions.
- Tests: server-core step rules, MCP workflow tools, panel model unit tests, and the workflow e2e suite.
