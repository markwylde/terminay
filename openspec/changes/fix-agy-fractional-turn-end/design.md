## Context

The built-in agents extension maps all-your-agents sessions to `AgentSessionSnapshot`s and publishes them across the extension boundary to the host's `SessionSourceBridge`. The host validates every snapshot (`packages/extension-api/src/validation.ts`) and refuses a whole publication if any snapshot is invalid. `lastTurnEndedAt` must be an integer in `[0, MAX_SAFE_INTEGER]`.

The Antigravity provider in all-your-agents 1.7.0 derives turn end times from agy's SQLite records with sub-millisecond precision. Observed live: `lastTurnEndedAt: 1795772970190.7083`. The publication is refused with `session source reset is invalid`, no root entry exists for the agy terminal, and the renderer falls back to terminal activity, where a non-shell foreground process (`agy`, which emits no `OSC 9;4` or `OSC 133` markers) reads as working. Claude Code and Codex end times are whole milliseconds, so they are unaffected.

## Goals / Non-Goals

**Goals:**
- Every live agy session crosses validation and binds to its terminal, so its canonical state drives the indicators.

**Non-Goals:**
- Relaxing host validation or changing the Extension API contract.
- Changing all-your-agents itself.
- Changing how terminal fallback treats foreground processes.

## Decisions

**Normalise in the extension adapter, keep the host strict.** `toSnapshot` floors `activity.lastTurnEndedAt` with `Math.floor` before publishing. The boundary crossed is the extension → host publication boundary (ADR-0025); the host remains the validator of untrusted extension data, and an integer timestamp is the published contract. Alternatives: relaxing host validation to accept finite numbers would widen the Extension API for every extension and push rounding into every consumer; fixing only the library would leave Terminay exposed to the next provider that does the same.

**Floor, not round.** Flooring never moves an end time later than the event, so a turn that ended just before acknowledgement is never treated as ending after it.

**Omit unusable values.** If the library's end time is not finite, or floors to a value outside `[0, Number.MAX_SAFE_INTEGER]`, the field is omitted rather than published, matching how other optional fields are omitted when unusable, so one bad value cannot refuse a batch. Without an end time, the host's existing rule treats a running-to-idle transition as ending now and a first-seen idle session as idle.

## Risks / Trade-offs

- [Another numeric field from a provider is fractional] → Only `lastTurnEndedAt` is published as a library number besides `pid`, which the adapter already checks is a safe integer.
- [A batch is still refused whole on any invalid snapshot] → Unchanged host behaviour, out of scope; this change removes the known trigger.

## Migration Plan

Ships with the built-in extension. Rollback restores the old behaviour (agy terminals show working). No stored data changes.

## Open Questions

None.

## Sequencing

The spec delta modifies the same requirement as the unarchived `add-antigravity-agent-support` change and is written against that change's version (background `task`/`subagent` waits and the Antigravity scenarios). Archive `add-antigravity-agent-support` before this change so the full requirement folds in correctly.
