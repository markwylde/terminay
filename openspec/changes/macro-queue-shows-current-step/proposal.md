## Why

While a macro runs, its entry in a terminal's macro queue does not move past the first step. A user running a multi-prompt macro (type, Enter, wait for idle, repeated) who opens the queue mid-run cannot tell which prompt it is on, or whether it is stuck. The server publishes a run's snapshot only when the run starts and when it finishes, so the queue has nothing to advance on. A failing test in `packages/server-core/test/macro-protocol.test.mjs` reproduces it: parked on the wait at step 2, the last published snapshot is still at step 0.

## What Changes

- The server publishes a run snapshot (`macros.run.changed`) each time a run begins a step, in addition to the start and finish snapshots it already publishes.
- The macro queue shows the step a running macro is on: steps before it as completed, that step as running, later steps as pending.
- A client that receives a snapshot for a run before its `macros.run` response arrives keeps the newer snapshot, so an early step event is not overwritten by the older launch snapshot.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `macros`: the macro run queue requirement gains live step progress for running macros, backed by a server-published snapshot per step.

## Impact

- `packages/server-core/src/macroService/` — the runner reports step transitions and the protocol appends them to the event journal.
- `src/workspace/useMacroRunController.ts` — server snapshots that arrive before the run is registered are kept and applied on registration.
- No protocol shape change: `macros.run.changed` already carries `stepIndex`; it is simply published more often. Older clients already apply it.
- Event volume rises by at most one journal event per step (bounded by `maxSteps`, 256).
