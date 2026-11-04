## Context

Macro execution is server-owned (`MacroRunner` in `packages/server-core/src/macroService/runner.ts`). The protocol handler for `macros.run` (`protocol.ts`) appends a `macros.run.changed` snapshot to the event journal when it starts a run and again when the run's promise settles. Between those two points `run.stepIndex` advances in server memory but nothing is published. The renderer (`useMacroRunController.applyServerSnapshot`) already derives every step's status from a snapshot's `stepIndex` and `status`, so it is correct for whatever it receives — it just receives nothing mid-run.

A second, latent defect: `applyServerSnapshot` drops a snapshot for a run it has not registered yet, and the run is registered only after the `macros.run` response arrives. Once step snapshots exist, one can arrive before that response; registration then applies the older launch snapshot and the queue shows a stale step until the next event.

## Goals / Non-Goals

**Goals:**
- Every step transition of a server-owned run reaches every subscribed client as a `macros.run.changed` snapshot.
- The renderer never regresses a run to an older step than one it has already been told about.

**Non-Goals:**
- Hydrating the queue from `macros.runs` for a window that opens after a run started.
- Changing the snapshot shape or adding per-step timing.
- Automation runs (`automationService/executor.ts`), which start macros through the same runner but report through their own run records.

## Decisions

**The runner reports steps through a callback in `MacroRunOptions`.** Add `onStep?: (snapshot) => void`, invoked after `run.stepIndex` is set and before the step executes. The protocol handler passes a callback that appends the snapshot to the event journal. Alternatives: the protocol polling `handle.snapshot()` on a timer — rejected by ADR-0028 (never poll); making the runner an event emitter — more surface than one optional callback, and the automation executor does not need it. Boundary: the runner stays free of protocol and journal knowledge; publishing stays in the protocol layer, which already owns run visibility and target authorization.

**Publish at the start of every step, including step 0.** Step 0 duplicates the launch snapshot but keeps the rule simple ("a snapshot per step begun") and costs one event. Bounded by `maxSteps` (256) per run.

**The renderer keeps the newest snapshot per run, including ones for runs it has not registered.** `applyServerSnapshot` records snapshots for unknown run ids in a small ref map (cleared on registration or terminal status); `executeMacro` applies whichever of the buffered snapshot and the launch response is further along (terminal status beats running; otherwise higher `stepIndex`). Ordering is decided by content, not arrival, because the command response and journal events travel on different paths. Boundary: this is client presentation state only; the server remains the authority for run state.

## Risks / Trade-offs

- [More journal events for long, fast macros] → bounded at one per step, ≤256 per run; snapshots are small.
- [Buffered snapshots for runs another client launched in the same session never get registered] → buffer only when a launch from this controller is in flight, and drop entries on terminal status.

## Migration Plan

No migration. Older clients already apply `macros.run.changed` snapshots by `stepIndex`, so they gain progress from a newer server unchanged.

## Open Questions

None.
