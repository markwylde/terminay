# Terminal close observation isolation

## Goal

Keep terminal close protection safe, session-scoped, and bounded when another
terminal continuously emits output or has slow foreground-process observation.

## Governing specifications

- [Terminal activity signals](../features/terminal-activity-signals.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)
- [Terminal workspace](../features/terminal-workspace.md)

## Current gap

The renderer obtains a global activity refresh before closing one terminal.
That snapshot performs live foreground-process refreshes for every running
session. A continuously emitting terminal can keep its host observation work
active, so an unrelated idle terminal's close waits for the noisy session to
become quiet. This violates session boundaries and leaves the close control
without a bounded outcome.

## Implementation slices

### 1. Separate projection reads from live observation

- [x] Make `activity.snapshot` and `activity.delta` return committed activity
      projection state without starting or awaiting host foreground-process
      inspection.
- [x] Preserve exact project filtering, ordered activity events, and snapshot
      resynchronization semantics.
- [x] Extend the canonical activity projection with exact-session foreground
      observation `available`/`limited` state without deriving idle or busy
      from raw output.

### 2. Bound and coalesce foreground-process observation

- [x] Give each exact terminal session one running foreground sample and at
      most one replaceable latest pending sample.
- [x] Ensure continued PTY output supersedes obsolete pending sampling work and
      cannot require complete output silence before the current sample settles.
- [x] Apply a named bounded deadline and cancellation path to close-time target
      observation; retain privileged process inspection in the owning
      environment/host boundary.
- [x] Contain a slow, failed, or unsupported observation to its own session and
      publish only safe metadata/state.

### 3. Scope destructive close protection

- [x] Replace global activity refresh in terminal-panel close with an
      exact `{serverId, projectId, sessionId}` close-preflight or equivalent
      server-owned command result.
- [x] Keep project close aggregation limited to the project's canonical
      sessions; do not widen terminal close checks to siblings, views, or the
      full server.
- [x] When target observation reaches its deadline or is unavailable, present a
      clear limited-state close confirmation that defaults to **Keep Running**;
      never wait indefinitely or assume idle from stale/missing data.
- [x] Preserve canonical workspace panel removal, PTY termination, and
      confirmation behaviour after the target decision completes.

### 4. Lock the regressions

- [x] Add a deterministic server-core test with a deliberately slow
      foreground-process resolver and continuing output. Prove that observation
      work is bounded/latest-wins and settles without stopping the producer.
- [x] Prove an activity snapshot and an unrelated terminal close do not await
      that session's slow observation.
- [x] Add Docker Electron coverage with two terminal tabs: one continuously
      emits output while the other closes through its tab X. Prove the close
      completes within the bounded control deadline and the noisy terminal
      remains live.
- [x] Cover target busy, target idle, target observation timeout, project-close
      aggregation, and provider capability-limited cases.

## Acceptance checks

- Closing an idle terminal is unaffected by output, agent work, or process-tree
  depth in any other terminal.
- A non-shell foreground process protects only its exact terminal; project and
  application close retain their documented scoped aggregation.
- Continuous output keeps foreground-process sampling, memory, and pending work
  bounded per session.
- Activity projection reads remain responsive during slow host observation.
- A target observation failure is visible and safe, never an invisible or
  unbounded close delay.

## Definition of done

Foreground-process observation, activity projection, and close protection obey
the exact-session and bounded-work contracts; focused server/client tests and
the required Docker Electron suite pass through `npm run test:e2e`.
