## Context

`TerminalActivityReducer` in `packages/server-core/src/activity/reducer.ts` is the server-owned authority for fallback terminal activity. A session starts acknowledged. Raw output more than one second after the last input, a foreground busy-to-idle transition, or a command-finished marker clears acknowledgement, which the client renders as the green finished indicator. The reducer has no notion of whether the user ever asked the shell to do anything, so shell start-up is indistinguishable from completed work. The client patches over this by re-acknowledging the focused terminal on each snapshot and by a settle timer on project deactivation.

iTerm2 never shows new-output on the foreground tab, clears its flag on tab selection, and ignores output immediately after a resize. The net effect is that a tab only lights up after the user has interacted with it and then looked away.

The change stays inside the server activity boundary. It changes how the server derives acknowledgement from PTY evidence; it does not change who is allowed to acknowledge, the protocol surface, or any renderer authority.

## Goals / Non-Goals

**Goals:**
- Shell start-up can never produce a finished indicator.
- The rule is deterministic and timer-free.
- Existing behaviour after the first interaction is unchanged.

**Non-Goals:**
- Removing the client fold-back or deactivation settle timer. They stay as a safety net and can be revisited later.
- Changing bell, notification, or provider agent behaviour.
- Adding a setting.

## Decisions

### A per-session settled flag, set by intent evidence

Add `settled: boolean` to the reducer's mutable session, initially false. It becomes true on a `userInput` signal, a `command` signal with phase `executing`, or a `progress` signal with a non-zero state. It never resets while the session lives.

Alternative considered: a fixed start-up grace window. Rejected because slow rc files exceed any fixed window, and a window that is long enough delays legitimate indicators.

### Guard only the acknowledgement-clearing paths

Raw output, foreground busy-to-idle, the lone finished marker, and the progress-zero path require `settled` before setting `acknowledged = false`. Status derivation is untouched, so `working` still appears during start-up. Bell and notification set attention regardless of settlement, matching their explicit nature.

Alternative considered: suppressing all evidence until settled. Rejected because the amber active indicator is useful and accurate during start-up.

### Keep the snapshot shape unchanged

`settled` is internal. Exposing it would widen the protocol for no client need.

## Risks / Trade-offs

- [A terminal driven entirely by an external process that never writes PTY input will never settle] → Terminay's own automation (macros, MCP, agents) writes through the terminal input path, which emits `userInput`; shells that emit OSC 133 or 9;4 settle through those markers.
- [Existing reducer tests may assume finished from raw or foreground evidence with no prior input] → update those tests to include an input or executing marker first, keeping their original intent.

## Migration Plan

No migration. Server behaviour change shipped with the next server build.

## Open Questions

None. No in-force ADR is affected.
