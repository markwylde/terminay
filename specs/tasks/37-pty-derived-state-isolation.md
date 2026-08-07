# PTY-derived state isolation

## Goal

Prevent terminal activity and other reconstructible PTY-derived state from
exhausting the shared reliable control queue while preserving current state,
subscription convergence, and command availability.

## Governing specification

- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)

## Confirmed failure

Resuming Codex session `019fd3bb-defc-71e1-a5d6-c2f8171d5663` reliably closes
the Local renderer connection with `connection outbound queue limit reached`.
The raw terminal bytes use an attachment lane, but pre-provider raw activity
updates publish `activity.changed` through the reliable control queue. Once the
1,024-frame connection limit is reached, workspace and terminal creation lose
their shared command channel.

The personal Codex rollout is a manual fixture only and is not committed. The
permanent regression models its production event shape without retaining user
content.

## Post-merge regression: agent projection lockout

The first implementation isolated raw terminal output and activity state, but
left other subscription events on the fatal reliable-control queue. Codex
journal replay publishes full `agent` snapshots, so a stalled renderer could
still fill exactly 1,024 control frames, close the application connection, and
make new projects and terminals inert.

The architectural boundary is traffic ownership, not an event-name allowlist:
all non-terminal subscription events are reconstructible projections and must
use bounded subscription lanes. Only handshake, query, command, cancellation,
and subscription-control results use reliable control capacity.

## Tasks

### 1. Lock the complete regression

- [x] Exercise real `TerminalService`, `TerminalActivityService`, event journal,
  server connection, subscription, and a deliberately stalled renderer.
- [x] Emit more than 1,024 PTY callbacks before provider authority is claimed.
- [x] Prove the pre-fix connection closes for the production queue-limit reason.
- [x] Keep the regression deterministic and below five seconds.

### 2. Publish semantic activity

- [x] Keep raw-output inactivity deadlines current without publishing one
  activity event per PTY callback.
- [x] Publish status, attention, acknowledgement, authority, progress, and exit
  transitions exactly and preserve snapshot/delta convergence.
- [x] Cover raw fallback, structured signals, provider claim, acknowledgement,
  and timeout transitions.

### 3. Isolate reconstructible state delivery

- [x] Add a bounded keyed latest-value traffic class separate from reliable RPC
  control and terminal presentation lanes.
- [x] Supersede pending state for the same feature/entity key without reordering
  unrelated keys or consuming reliable control capacity.
- [x] Convert projection congestion into scoped snapshot resynchronization; it
  must never close the application connection.
- [x] Preserve one ordered transport writer and fair progress across reliable
  control, state projection, and terminal lanes.

### 4. Verify the user-visible invariant

- [x] While one terminal emits the regression workload, create another terminal
  and complete workspace queries/commands on the same connection.
- [x] Prove activity converges to the latest authoritative snapshot.
- [ ] Pass focused server/client tests, lint, build, and Docker Electron coverage.

### 5. Close the agent projection gap

- [x] Reproduce the production failure through real Codex journal ingestion,
  agent status, server composition, subscription delivery, and a stalled
  renderer; prove the old path fails at exactly 1,024 queued frames.
- [x] Route every non-terminal subscription event through bounded projection
  delivery without an event-name fallback to fatal reliable control.
- [x] Coalesce full agent snapshots by subscription and preserve ordered delta
  revisions until bounded resynchronization is required.
- [x] Reload the authoritative agent snapshot when its subscription receives
  `event_resync`.
- [x] Prove the exact regression keeps the connection open and permits a new
  terminal command after the stalled renderer resumes.
- [x] Cover generic subscription pressure so future feature events cannot
  silently re-enter the fatal control queue.

## Definition of done

No volume or timing of PTY-derived reconstructible state can close or starve the
application connection. Activity publishes semantic transitions, pending state
memory is bounded per key, lagging clients converge through scoped snapshots,
and unrelated workspace and terminal commands remain available.
