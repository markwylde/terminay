## Why

An automation's run history only grows. Failed and timed-out runs from while it
was being set up stay in the list next to the runs that matter, up to the
100-run bound, and nothing lets a user remove them. A user who wants a short
history has no way to ask for one: they cannot delete one run, clear old runs,
or tell an automation to keep only recent history.

## What Changes

- A user can delete a single finished run from an automation's run history,
  without a confirmation.
- A user can prune an automation's history: a Prune form asks how far back to
  remove ("runs older than N days", where 0 means every finished run), shows
  how many runs will go, and asks for confirmation. The form always opens, and
  it is pre-filled with the value the user last submitted for that automation.
  That value is stored on the server with the automation's run history, so
  every client sees the same one.
- Each automation gains a "Keep history for N days" setting, off by default.
  When it is set, the server removes finished runs older than N days. The runs
  are gone from every list as soon as they pass the threshold, and from storage
  by the next write, list, or restart, without any timer.
- A run still in progress is never deleted or pruned.
- New client operations `automations.runs.remove` and `automations.runs.prune`,
  and a metadata-only journal event `automations.runs.removed`. The
  `automations.runs` query also returns the automation's remembered prune
  choice.
- No new MCP tool. Agents cannot delete or prune runs. Runs removed by the
  retention setting also disappear from `list_automation_runs`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `automations`: the definition gains the keep-history setting; the run log
  gains deletion, pruning, retention, and the remembered prune choice; the
  Automations section gains Delete and Prune controls on the run history.

## Impact

- `packages/server-core/src/automationService/`: `types.ts`, `normalize.ts`
  (settings), `runLog.ts` (remove, prune, retention, prune choices),
  `protocol.ts` (two commands, one event, extended runs query), and `audit.ts`.
- `packages/client-core/src/automations.ts`: new operations, event, and types.
- `src/workspace/automations/`: run-history Delete and Prune controls, the
  editor's keep-history field, and the model and hook that refetch on the new
  event.
- Run-log file: gains an optional `pruneChoices` record. Older files load
  unchanged, and the schema version is unchanged.
- Tests: server-core unit tests, and `e2e/automations-ui.spec.ts`.
