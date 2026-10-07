## Why

Opening a laptop and immediately creating a project can leave Terminay
unusable: the request hangs for several seconds, a `Project N` tab appears
showing `command outcome is unknown: session-…-cmd-…`, and from then on no
project can be created or selected until that tab is closed or the app is
restarted. It was reported on 2026-10-07 and the diagnostics for launch
`c0f3d2eb` show it is a chain of four separate faults, each of which turns an
ordinary sleep into a visible failure:

1. The server counts the time the machine was asleep as client silence. Its
   60 s inbound-silence deadline was overdue the instant timers ran again, so
   it closed a healthy embedded connection (`application heartbeat timed out`,
   08:59:50Z).
2. The window did not learn of that close. Its transport still read `open`
   until its own heartbeat missed twice, 17 s later (09:00:07Z). Anything sent
   in that window was written into a dead endpoint.
3. Project creation presented the resulting outcome-unknown error as a final
   failure, although the protocol contract says a client never has to guess
   whether a mutation committed.
4. A failed pending project tab holds the whole window: it pins itself as the
   displayed tab, hides the active project, and disables the `+` control.

The same launch shows the window retiring a healthy connection on its own
heartbeat at 08:49:28Z with no server-side close, as the machine was going to
sleep. That is the client-side mirror of fault 1.

`scripts/wake-reaped-renderer-connection.test.mjs` reproduces faults 1–3 with
the real server core, client, and port transport.

## What Changes

- A liveness deadline counts only time during which the side measuring it was
  running. A deadline that elapsed while that side was suspended is not a
  missed heartbeat: the server gives the client one fresh deadline, and the
  client probes again at once instead of counting a miss.
- When the server closes an embedded connection, the Desktop window's transport
  fails promptly, without waiting for a heartbeat to notice.
- A command whose outcome is unknown is resolved by the client after it
  reconnects and resynchronises. For project creation that means: if the
  project exists it carries on, and if it does not the creation is sent again.
  The raw outcome-unknown message is never the final thing a person sees while
  recovery is still possible.
- A failed pending project tab no longer blocks the window. Other project tabs
  stay selectable, the `+` control stays usable, and the failed tab offers
  retry and dismiss.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-stream-congestion-and-recovery`: the heartbeat liveness requirement
  gains the server's inbound-silence deadline and the rule that time spent
  suspended is not silence, on either side.
- `server-runtime-and-protocol`: transport adapter lifecycle fidelity covers a
  close made by the far end of the Desktop byte endpoint; the outcome-unknown
  rule states who resolves it and that it is not presented as final.
- `workspace-and-project-tabs`: the pending project tab requirement covers a
  creation interrupted by transport loss, and a failed pending tab that leaves
  the rest of the window usable.

## Impact

- `packages/server-core/src/connection.ts` — inbound-silence deadline.
- `src/web/sessionConnectAttempt.ts`, `src/shared/connections/connectionRegistry.ts`
  — client heartbeat and recovery.
- `src/shared/serverPortTransport.ts`, `src/shared/rendererServerClient.ts`,
  `electron/serverTerminalAuthority.ts`, and the Desktop preload port hand-off
  — close observation across the Desktop byte endpoint.
- `src/App.tsx`, `src/shared/WorkspaceSnapshotStore.ts`,
  `src/workspace/projectTabModel.ts` — project creation recovery and the failed
  pending tab.
- Tests: `scripts/wake-reaped-renderer-connection.test.mjs` (inverted to assert
  the fixed behaviour), `packages/server-core/test/connection-scoped-lifecycle.test.mjs`,
  `scripts/web-session-heartbeat-reconnect.test.mjs`, one Desktop E2E spec.
- No protocol version change, no new capability string, no new timer, no new
  dependency. Remote and browser clients get the same suspend tolerance; their
  transports and recovery are otherwise untouched.
