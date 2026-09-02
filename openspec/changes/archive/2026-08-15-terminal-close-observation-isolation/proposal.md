## Why

Closing one terminal first obtained a global activity refresh, and that
snapshot performed a live foreground-process refresh for every running session.
A continuously emitting terminal could keep its host observation work active,
so closing an unrelated idle terminal waited for the noisy session to fall
quiet. That crosses the session boundary and leaves a destructive control
without a bounded outcome.

## What Changes

- Make activity snapshot and delta reads return committed projection state
  without starting or awaiting host foreground-process inspection, preserving
  exact project filtering, ordered activity events, and resynchronization.
- Extend the activity projection with exact-session foreground observation
  `available` and `limited` state, without deriving idle or busy from raw
  output.
- Give each exact terminal session one running foreground sample and at most
  one replaceable latest pending sample, so continued output supersedes
  obsolete pending work and never requires output silence.
- Apply a named bounded deadline and cancellation path to close-time target
  observation, retaining privileged process inspection in the owning
  environment or host boundary.
- Replace the global activity refresh in terminal-panel close with an exact
  `{serverId, projectId, sessionId}` close preflight, and keep project close
  aggregation limited to the project's canonical sessions.
- Present a clear limited-state close confirmation defaulting to **Keep
  Running** when target observation reaches its deadline or is unavailable.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-activity-signals`: projection reads separate from live observation,
  session-owned bounded foreground sampling, and explicit observation
  availability state.
- `workspace-and-project-tabs`: destructive close protection becomes
  session-scoped with a bounded outcome and a safe limited-state confirmation.
- `terminal-stream-congestion-and-recovery`: a close is never delayed by an
  unrelated terminal's observation work.

## Impact

- Server-core activity projection, foreground observation scheduler, and a new
  close preflight command result.
- Renderer terminal-panel close path and its confirmation surface.
- Docker Electron end-to-end coverage with two terminal tabs.
