## Why

Opening a new terminal or project sometimes shows the green "finished" indicator a few seconds later, even though the shell is just sitting at an empty prompt. Users learn to distrust the indicator. Technically, the server activity reducer treats any raw output gap or foreground busy-to-idle transition as completed work, so shell start-up noise (rc files, version managers, a late prompt paint) counts as "finished" if the user has clicked away before the shell settled. The client compensates with focused re-acknowledgement and a deactivation settle timer, which only mostly works.

## What Changes

- A terminal session must settle before fallback activity can mark it finished. A session settles when it receives user input or a structured command-executing or progress-busy marker.
- Until settled, raw output, foreground busy-to-idle transitions, and a lone command-finished marker keep the session acknowledged. Working status still shows so the amber "active" indicator remains accurate during start-up.
- Bell and notification attention are unchanged; they are explicit requests from the shell.
- No timers are added and no new setting is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: fallback finished activity requires a settled session.

## Impact

- `packages/server-core/src/activity/reducer.ts` gains a per-session settled flag and guards the acknowledgement-clearing paths.
- `packages/server-core/test/activity-reducer.test.mjs` gains start-up noise cases.
- The client fold-back at `src/App.tsx` remains in place; it becomes a safety net rather than the primary guard.
- No protocol or snapshot shape change.
