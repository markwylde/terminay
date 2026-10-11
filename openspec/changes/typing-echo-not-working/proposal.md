## Why

Typing into a terminal turns its activity indicator yellow, as though the terminal were busy, when all it is doing is echoing the user's own keystrokes. The indicator is meant to say "this terminal is doing work", so a user who is only typing a command sees a false signal on the tab, the sidebar item, the project activity dot, and the dashboard's working count.

The cause is in the raw-output fallback tier. A terminal with no shell integration and no recognised agent is `working` for one second after any PTY output, and the shell's echo of a keystroke is PTY output. The reducer already knows when the user last typed, but uses that only to hold back the finished indicator, never to decide whether output counts as work.

## What Changes

- In the raw-output tier, output that arrives within one second of user input is not activity: it neither begins `working` nor extends it.
- Typing at a prompt therefore leaves the terminal idle, including when the user starts typing straight after a command's output. A terminal that is streaming output while the user types over it reads idle for as long as the typing continues, and working again one second after the last keystroke.
- A command started from the keyboard shows working once its output outlasts the one-second window, so the indicator appears up to one second later than it does today, and a command that finishes inside the window never shows working.
- Output that does not count publishes no activity event, so a keystroke no longer produces a working/idle pair for every client.
- Nothing changes for a session claimed by structured signals (`OSC 133`/`633`, `OSC 9;4`), for foreground-process evidence, or for a session with a provider-backed agent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: adds a requirement that raw output following user input is not activity in the raw-output tier.

## Impact

- `packages/server-core/src/activity/reducer.ts` — `applyRawOutput` and the raw-working derivation.
- `packages/server-core/test/activity-reducer.test.mjs` — new cases; existing raw-output cases reviewed.
- Every consumer of the server's `working` status sees the corrected value without change: tab and sidebar indicators, the project activity dot, `src/workspace/dashboardRows.ts`, `src/workspace/workspaceInventory.ts`, and the automation working-to-idle trigger in `packages/server-core/src/automationService/triggers.ts`, which no longer fires on typing.
- No protocol, settings, or persistence change. The canonical inactivity wait is unaffected: it measures output, not `working`.
