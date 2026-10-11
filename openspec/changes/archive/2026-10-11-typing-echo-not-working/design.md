## Context

`TerminalActivityReducer` (`packages/server-core/src/activity/reducer.ts`) is the server's single authority for terminal activity. For a session with no provider and no structured claim, `applyRawOutput` stamps `rawActivityAt` on every PTY chunk and `derive` reports `working` for `rawActivityMs` (one second) afterwards.

User input reaches the same reducer as a `userInput` signal, bound in `bindTerminalActivity` (`packages/server-core/src/composition.ts`), which already drops terminal focus reports. The reducer records `lastUserInputAt` and exposes `recentInput(session, at)`, true for one second after input. Today that predicate only guards `acknowledged`, so it stops echo from raising the finished indicator but not from raising `working`.

The client's own `TerminalActivityStore` already ignores raw output after recent input for its local amber timer, but for an unclaimed session it promotes the tab to amber whenever the server snapshot says `working`. The server's `working` is therefore what the user sees, and it is also what the dashboard, the workspace inventory, the project activity dot, and the automation working-to-idle trigger read.

iTerm2 was checked as a reference. It counts echo as activity too and avoids the symptom by never drawing the indicator on the foreground tab. Terminay's spec keeps the working indicator on the focused tab, so that approach is not available.

In-force ADRs reviewed: ADR-0044 (work on the output path is proportional to the output event) and ADR-0028 (no polling without owner approval) are the two this design touches. Neither is revisited.

## Goals / Non-Goals

**Goals:**

- Echo of the user's own typing never produces `working` in the raw-output tier.
- A terminal that is still producing output after the user stops typing reads working again within a second.
- One rule, in the server reducer, so every client and every consumer of `working` agrees.

**Non-Goals:**

- Distinguishing echo from program output by content, size, or cursor position.
- Changing structured-signal, foreground-process, or provider-backed activity.
- Changing the finished or attention indicators, the two-second input-quiet completion, or the canonical inactivity wait.
- A setting for the window length.

## Decisions

### 1. Raw output within the recent-input window is not recorded

In `applyRawOutput`, after `expire`: when `recentInput(session, at)` is true, the chunk does not stamp `rawActivityAt`, set `authority` or `source`, or touch `acknowledged`. The reducer still derives and commits, so a raw working period that `expire` has just ended is published as idle on the same call.

The proposal first carried a narrower rule: output after input could not *begin* working but could *extend* it, so that a streaming build stayed yellow while the user typed. Writing the tests showed that rule fails its own purpose. A prompt painted after a command leaves the session working for a second; a user who starts the next command inside that second would have every echo extend the period, and the terminal would stay yellow for as long as they typed. Timing alone cannot tell that echo from a build's output, so the rule cannot keep both behaviours. Typing never reading as busy is the point of the change, so it wins.

Alternatives considered:

- *Begin-but-extend, as above.* Rejected for the reason given.
- *Suppress the indicator on the focused terminal, as iTerm2 does.* Contradicts the existing requirement that working indicators remain on the focused tab, and leaves the server's `working` wrong for the dashboard and automation triggers.
- *Classify echo by size, by matching the bytes written, or by a much shorter window.* Fragile against line editors, completion menus, and slow remote links, and it puts content inspection on the output path.

### 2. A chunk that does not count leaves the session snapshot untouched

Because `authority` and `source` are not set, a keystroke publishes at most the `userInput` transition and nothing for its echo, where today it publishes a working event and, a second later, an idle one. This keeps the output path's work constant per event (ADR-0044) and reduces fan-out while typing.

Alternative considered: still set `source` to `raw:output`. Rejected because it would alternate with `structured:user-input` and publish two events per keystroke for no observable benefit.

### 3. Reuse the existing one-second recent-input window

`recentInput` and its `DEFAULT_RAW_ACTIVITY_MS` window already define "the user just typed" for acknowledgement. Using the same predicate keeps one definition, and each keystroke renews it, so ordinary typing gaps never let echo through. A second constant or a setting was rejected as unneeded.

### 4. No new timer

The rule is evaluated only when output arrives. No deadline is added to `nextDeadline`, so the reducer wakes no more often than it does now (ADR-0028).

### Boundary

The change stays inside the server reducer. It crosses no security boundary: the project and session fencing in `applyRawOutput` runs before the new check, and the renderer remains a projection, not an authority.

## Risks / Trade-offs

- [A command started from the keyboard shows yellow up to one second late] → Accepted and specified. Only the raw-output tier is affected; shells with integration go yellow on the executing marker.
- [A command that finishes within one second never shows working] → Accepted and specified; a flash that short carried little information.
- [A terminal streaming output reads idle while the user types over it continuously, and working again one second after the last keystroke] → Accepted and specified; typing over a running raw-tier program is brief, and the alternative leaves typing after a prompt yellow.
- [A full-screen program in the raw-output tier that repaints on every key, such as an editor over SSH without integration, no longer shows yellow while the user is driving it] → Intended: the repaint is a response to input, not work.
- [Existing reducer tests assert working directly after input] → Review `activity-reducer.test.mjs` and adjust only cases whose intent the new requirement changes.

## Open Questions

None.
