## 1. Server: types and settings

- [x] 1.1 Add `keepHistoryDays?` to `AutomationSettings`, `pruneChoices` to `AutomationRunLogState`, the `removed` run-log change, and the `runs` audit record in `types.ts`/`protocol.ts`. Verify: `npm run typecheck` in server-core passes.
- [x] 1.2 Validate `settings.keepHistoryDays` (integer 1–3650, absent = off) in `normalize.ts`. Verify: automation-service unit tests cover accepting 7, dropping absent, and refusing 0 and 3651.

## 2. Server: run log

- [x] 2.1 Add `remove(runId)` to `AutomationRunLog`: it refuses a running run with `invalid_automation` and a missing run with `run_not_found`, and it commits and emits `removed`. Verify: a unit test deletes one run, refuses a running one, and reloads from the backend to show the run is still gone.
- [x] 2.2 Add `prune(automationId, olderThanDays, now)`: it removes finished runs with `startedAt` before the cutoff, keeps running runs, records the prune choice, and returns the count. Verify: a unit test with runs at 2, 10, and 40 days and a prune at 7 leaves only the 2-day run, and a prune at 0 keeps a running run.
- [x] 2.3 Load, normalize, and persist `pruneChoices`, and drop malformed entries. Verify: a unit test round-trips the choice through the backend and loads an older file without the field.
- [x] 2.4 Add the `retentionFor` resolver: purge on load and inside every mutate, filter in list, get, and latest, and queue a purge when a read finds expired runs. Verify: a unit test with keepHistoryDays 7 hides an 8-day-old run on list and removes it from the backend after the queued purge, without any timer (fake clock, no `setTimeout` or `setInterval`).
- [x] 2.5 Wire the resolver and a purge on definition change in `composition.ts`/`index.ts`. Verify: a unit test shortens the setting through `repository.upsert` and sees old runs removed.

## 3. Server: protocol

- [x] 3.1 Add the commands `automations.runs.remove` and `automations.runs.prune` with authority guards and audit, and return `pruneChoice` from `automations.runs` when it is scoped to one automation. Verify: automation-protocol tests cover success, a refusal for a read-scoped or session-bound caller, and the returned choice.
- [x] 3.2 Publish the `automations.runs.removed` journal event with ids only. Verify: a protocol test asserts the event payload has exactly `automationId` and `runIds`.

## 4. Client core

- [x] 4.1 Add `removeRun`, `pruneRuns`, the `pruneChoice` on the runs snapshot, `keepHistoryDays` on settings, and the `runsRemoved` subscription with validation to `packages/client-core/src/automations.ts`. Verify: client-core typecheck and its existing tests pass.

## 5. Desktop UI

- [x] 5.1 Refetch on `automations.runs.removed` in `useServerAutomations`. Verify: typecheck, and the e2e test in 5.4 sees the list update.
- [x] 5.2 Add a per-run Delete button, hidden while a run is running, with no confirmation. Verify: e2e.
- [x] 5.3 Add a Prune button and inline form: days input pre-filled from `pruneChoice` (or 30), a live count of matching runs, a confirm that is disabled at 0, and Cancel. Verify: e2e.
- [x] 5.4 Add a "Keep history for N days" row to the editor, round-tripped through `automationsModel` form conversion. Verify: an `automationsModel` unit test round-trips the setting, and e2e saves it.
- [x] 5.5 Extend `e2e/automations-ui.spec.ts`: delete one run, prune with a remembered choice (reopen the form and see the value), and set keep-history. Verify: `npm run test:e2e -- automations-ui` passes.

## 6. Finish

- [x] 6.1 Run `npm run lint`, `npm run typecheck`, server-core and client-core unit tests, and `openspec validate --all`. Verify: all pass.
