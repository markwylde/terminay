## Context

Automation runs live in `AutomationRunLog` (`packages/server-core/src/automationService/runLog.ts`).
It is a server-owned store kept apart from the definitions, so a busy
automation never rewrites them. Each automation has an array of entries
(oldest first) that is trimmed to 100 on every `record`. Every mutation runs
through one serialized `mutate` queue, which commits the whole snapshot to the
file backend and then notifies subscribers. `protocol.ts` turns those changes
into journal events that carry only non-sensitive metadata. Clients react to an
event by refetching `automations.runs`.

The only existing way to remove runs is `forget(automationId)`, which drops a
whole automation's history. Nothing lets a user remove individual runs, and no
setting controls how long runs are kept.

In-force ADRs that constrain this change:

- ADR-0028: no polling. Retention cannot be a periodic sweep.
- ADR-0031: MCP authority is capability scope times the permission policy.
  This change adds no MCP surface, so the policy needs no new operation.
- The boundary from ADR-0030, carried forward by ADR-0031: automations are
  server-owned and managed only by clients with terminal-create authority.

## Goals / Non-Goals

**Goals:**

- Delete one finished run. Prune finished runs older than N days.
- Store each automation's last prune choice on the server, so every client
  pre-fills the same value.
- Add a per-automation keep-history setting that the server enforces without a
  timer.

**Non-Goals:**

- An MCP tool for deleting or pruning runs (the user declined one).
- Changing the 100-run bound.
- A server-wide retention default.
- Removing recordings linked from deleted runs. Recordings follow the recording
  feature's own storage rules. A deleted run only drops its link.

## Decisions

### Deletion and pruning are run-log commands, not definition edits

`automations.runs.remove { runId }` and
`automations.runs.prune { automationId, olderThanDays }` are new commands in
the automation registry. They carry the same `write` scope policy and the same
`assertAutomationAuthority` check as every other automation operation. They
change only the run log, so the definition revision and `expectedRevision` are
not involved. A run-log change never conflicts with an edit made at the same
time.

The prune cutoff is computed on the server:
`now - olderThanDays * 86_400_000`. A run is removed when
`status === 'finished'` and `startedAt < cutoff`. The server never trusts a
client clock. `olderThanDays` is an integer from 0 to 3650.

*Alternative:* the client sends explicit run ids to prune. Rejected: the client
would need a fresh list, and runs that finish between the list and the prune
would be skipped.

### The remembered prune choice lives in the run-log file

The run-log state gains an optional
`pruneChoices: Record<automationId, { olderThanDays }>`. It is written in the
same `mutate` as the prune that sets it, and it is returned by the
`automations.runs` query when that query names an automation.

*Alternative:* store it in the definition's settings. Rejected: every prune
would then bump the definition revision. That would conflict with an editor
open on another client, and it would send an `automations.changed` event for
something that is not an edit. The user asked for the choice to be server-side
and per automation, and the run-log file is both.

No schema-version bump is needed. The field is optional. An older file loads
with no choices, and an unknown or malformed entry is dropped during
normalization, as other fields already are.

### Retention is a definition setting, enforced lazily at every run-log touch

`settings.keepHistoryDays?: number` (1 to 3650, absent means off) is validated
in `normalize.ts` alongside the cooldown. The run log is given a
`retentionFor(automationId) => number | undefined` resolver that reads the
repository's current definitions. It applies the retention cutoff:

1. on `load()`, so a restart purges expired runs,
2. inside every `mutate` (record, remove, prune, missed, and so on), for all
   automations, before commit,
3. in `list`/`get`/`latest`, which filter out expired runs, so a run is never
   shown once it passes the threshold, even if nothing has written since,
4. when the repository commits a definition change, by queuing a purge
   `mutate`, so a shortened period takes effect when the automation is saved.

When a list finds expired runs, it queues a purge `mutate`. That stores the
removal and publishes `automations.runs.removed`. The stored log therefore
matches what is shown by the next write, read, or restart. No timer exists.
This is ADR-0028 decision 4: fresh when asked, never sampled.

*Alternative:* a one-shot timer armed for the next run to expire. That would be
allowed as a deadline under ADR-0028, but it is more machinery than lazy
enforcement. Filtering on read already makes the log correct whenever anyone
looks.

### One metadata-only removal event

`automations.runs.removed { automationId, runIds }` is a new journal event. It
carries ids only, which follows the existing rule that journal events never
carry names, output, or subjects. `useServerAutomations` treats it like
`run.changed` and refetches. Retention purges publish it too.

The internal `AutomationRunLogChange` union gains
`{ type: 'removed'; automationId; runIds }`.

### Audit

`AutomationAuditRecord` gains
`{ type: 'runs'; operation; automationId; removed: number; actor }` for remove
and prune. Retention purges are not client actions, so they are not audited
as a client action.

### UI

- The run row gains a trailing Delete icon button. It is not nested in the
  row's toggle button, so it can still be focused. It is hidden for running
  runs. There is no confirmation.
- A Prune button in the Runs group header opens an inline banner, matching
  the delete-automation banner. It has a number input "Remove runs older than
  [N] days" pre-filled from the remembered choice (default 30), a live count
  of matching finished runs computed from the client's copy of the history, a
  danger Prune button that is disabled when the count is 0, and Cancel. The
  server count is authoritative, and the client count is a preview.
- The editor gains a "Keep history" row: a number input with the suffix
  "days", where empty means off.

## Risks / Trade-offs

- [The client's preview count differs from what the server removes, for
  example when a run finishes between opening the form and confirming] → The
  server reports `removed`, and the refetch shows the truth. The difference is
  at most the runs that finished in that window.
- [The retention resolver couples the run log to the repository] → It is
  injected as a function, not the repository. Tests pass a stub, and the log
  still works with no resolver (retention off).
- [Lazy purge on read adds a write during a read] → It only happens when
  something has expired. It goes through the same serialized queue, and the read
  itself returns the filtered view immediately.

## Migration Plan

Additive. An older run-log file loads with no prune choices, and an older
definition has no keep-history setting. Rolling back leaves an unknown
`pruneChoices` field and an unknown setting. The older normalizers drop both.
Deleted runs stay deleted.

## Open Questions

None.
