## Context

Each trigger has a source checkpoint (`sourceState.ts`) whose `health.state` starts as `disabled`. Command, HTTP, SSE and file sources overwrite it once `launch()` runs them (`launch()` sets `checking`). Interval, cron and one-shot schedule triggers never launch a source, so their stored state stays `disabled` for as long as they exist. `TriggerService.enable(…, true)` and `retry()` also write `disabled` explicitly. `list()` forces `disabled` when the trigger is inactive (trigger off, bot off, or service stopped) but passes the stored value through when it is active. `availability()` (bot enabled/disabled) leaves the stored health alone.

`statusOf` in `BotTriggersPanel.tsx` returns the grey Disabled pill only when `!t.enabled`; otherwise it labels the health state and gives everything except failed, blocked and retrying the green `done` tone. So an enabled schedule trigger renders a green "Disabled".

## Goals / Non-Goals

**Goals:**
- Health `disabled` means exactly "this trigger cannot fire because it or its bot is off".
- Fix checkpoints already stored as `disabled` without migrating the state file.
- Keep the status pill consistent with the trigger switch and the bot's own enabled state.

**Non-Goals:**
- New health states, or richer status for schedule triggers (for example "Scheduled").
- Changing tones or labels for any other state, or the failure-episode rules.

## Decisions

1. **`waiting` is the neutral active state.** It already exists in `BotSourceHealth` and in the UI labels, and describes a trigger that is armed but has nothing to report. Alternatives: `healthy` claims a check succeeded when none ran; a new `scheduled` state needs a protocol change for no user benefit.
2. **`list()` derives `disabled` from the enabled flags.** Inactive → `disabled` (unchanged). Active with a stored `disabled` → `waiting`. Any other stored state passes through. This fixes checkpoints written by earlier builds and keeps the enabled flags as the single source of truth.
3. **Writers stop storing `disabled` for an active trigger.** `initialCheckpoint`, `enable(true)` and `retry()` write `waiting`. Decision 2 alone would hide the symptom while leaving a misleading stored value.
4. **Re-enabling a bot preserves health.** `availability()` stays as it is: a trigger that was `healthy` or `failed` before the bot was paused reports that again. Resetting it would also interfere with an open failure episode (bot-failure-follow-up), which only a successful check, reset, disable or delete may end.
5. **The renderer decides Disabled from the enabled flags, not from health.** `statusOf(trigger, botEnabled)` returns a neutral Disabled when the trigger or bot is off. Otherwise a `disabled` health (from an older server) is shown as Waiting. The pill then always agrees with the switch and the bot header.

Boundaries: health is computed in Terminay Server and sent over the existing bot protocol; the renderer only formats it. No privileged boundary moves.

## Risks / Trade-offs

- [Another consumer reads a stored `disabled`] → the only other readers of `health.state` (`runtime.ts`, the drain loop, the failure-episode checks) compare against `failed`/`blocked`, so `waiting` and `disabled` are equivalent to them.
- [After `retry()` a source trigger shows Waiting until `launch()` sets Checking; a schedule trigger shows Waiting indefinitely] → both are accurate: the trigger is armed and has nothing newer to report.
