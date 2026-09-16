## Why

When a browser session loses its transport, the workspace shows the
reconnecting overlay and, underneath it, two red error surfaces: an
"Operation failed: Git is temporarily unavailable" banner at the top of the
project, and a "terminal presentation renewal failed" error with a **Retry
connection** button inside the terminal. Both describe the same outage the
overlay is already explaining. They read as three separate failures during a
routine reconnect, and neither has an action the person can usefully take
while recovery is running on its own.

## What Changes

- While the connection that owns a project is reconnecting, a feature refresh
  that fails because the transport is gone (`disconnected`, `unavailable`, or
  `deadline`) is not reported in the project's error banner. A transport
  outage notice that landed just before the connection reported reconnecting
  is retired the moment it does.
- While the connection that owns a terminal is reconnecting, the terminal's
  per-panel connection error and its **Retry connection** action are not
  shown. The rebind onto the recovered connection clears the error, as it
  already does.
- A failure the server answered with (denied, not found, or a generic feature
  failure) stays visible whatever the connection is doing. Only the
  transport's own failures belong to the reconnect.
- The reconnecting overlay is unchanged and remains the single visible
  statement of the outage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-stream-congestion-and-recovery`: the "Renderer behaviour while the
  client is unusable" requirement now also states that the reconnecting
  presentation is the only failure surface for the outage, so surfaces that
  collected a transport failure from the dying client do not show it
  alongside.

## Impact

- `src/shared/featureQueryAuthority.ts` — `isTransportFeatureFailure` and
  `clearTransportFeatureFailure`; `VisibleFeatureFailure` records whether the
  transport caused it.
- `src/shared/connections/connectionRegistry.ts` — `isConnectionReconnecting`.
- `src/App.tsx` — the project workspace reads the owning connection's phase,
  skips transport failures while reconnecting, and retires a stale one when
  the phase flips.
- `src/components/TerminalPanel.tsx` — the panel reads the owning connection's
  phase and hides its connection error while reconnecting.
- `scripts/git-banner-reconnect-recovery.test.mjs` and
  `src/shared/featureQueryAuthority.test.ts` — cover the new behaviour.
- No protocol, server, or privileged surface is touched.
