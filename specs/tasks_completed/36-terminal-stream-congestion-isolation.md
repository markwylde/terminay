# Terminal stream congestion isolation and connection recovery

## Goal

Keep Terminay usable and bounded while a terminal emits hundreds of megabytes
or a renderer stalls, and reliably reconstruct the application after a genuine
shared-transport failure.

## Governing specifications

- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)
- [Terminal workspace](../features/terminal-workspace.md)
- [Server runtime and application protocol](../features/server-runtime-and-protocol.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Durable terminal presentation recovery](../tasks_completed/35-durable-terminal-presentation-recovery.md)
- [Task 42: Unified renderer connection recovery](../tasks_completed/42-unified-renderer-connection-recovery.md)
- [Task 43: WebRTC transport recovery acceptance](../tasks/43-webrtc-transport-recovery-acceptance.md)

## Current gap

Terminal attachments already have bounded replay, acknowledgement, resync, and
checkpoint primitives, but the protocol adapter immediately drains live output
into the global ordered event journal. Journal listeners then enqueue every raw
terminal frame into one connection-wide FIFO without awaiting downstream
capacity.

When that FIFO reaches 16 MiB or 1,024 frames, `OutboundDeliveryPump` treats
temporary terminal congestion as a terminal connection error, rejects every
queued frame, and closes the renderer's only application connection. Existing
terminal clients become inert and a newly created server session cannot publish
its workspace panel. Local client rehydration does not reliably replace the
disposed context, so waiting cannot recover the window.

The original Docker reproduction emitted a large PTY burst and observed missing
forward progress or an inert terminal afterward. The permanent regression uses
a fast test pyramid: the deterministic server test advances the complete 200
MiB byte range, while Docker Electron emits 1 MiB—enough to cross the same
presentation limits—through the real PTY, checkpoint parser, xterm, and Local
MessagePort.

## Architecture decisions

### Terminal-owned delivery

- Raw terminal output leaves the generic global event-journal delivery path.
- The server connection owns a terminal-stream scheduler with one independently
  bounded lane per exact attachment and a separately bounded control lane.
- Command/query results, workspace events, resync notifications, and lifecycle
  traffic retain control capacity. A noisy terminal cannot admit bytes against
  that capacity.
- Only the scheduler calls the transport writer. It preserves order within each
  lane and selects ready terminal lanes fairly.

### Attachment-scoped recovery

- A terminal lane overflow changes that attachment to `resync_pending`; it does
  not fail the connection.
- Pending raw presentation frames for that attachment are released and a single
  control-lane `resync_required` transition records the last confirmed and
  current output positions.
- The client replaces or clears only the affected emulator presentation,
  hydrates from a newly pinned canonical checkpoint, and rejoins live delivery
  contiguously.
- Repeated congestion remains bounded and repeatable. It cannot create an
  unbounded retry, checkpoint-pin, event-journal, or hydration queue.

### Existing connection-recovery baseline

- True transport failure invalidates the old application client and enters an
  observable reconnect state.
- Desktop replacement MessagePorts and remote transports use one generation-
  guarded retry loop with bounded backoff. A replacement context is fully
  authenticated and subscribed before atomically replacing the old context.
- Workspace state reload and terminal hydration complete before mutations are
  re-enabled. Failed attempts remain visible and retryable instead of leaving
  disposed clients mounted.

This completed baseline exposed the remaining overlapping renderer recovery
owners. Task 42 supersedes that lifecycle machinery with the one final
connection controller. This task retains ownership only of terminal congestion,
attachment-scoped resynchronization, and forced MessagePort/WebSocket evidence;
it must not extend the old remote recovery implementation.

## Implementation slices

### 1. Lock the regression and expose evidence

- [x] Add a real Docker Electron test that crosses the presentation limits and
  verifies completion, subsequent input, connection health, and new-terminal
  creation.
- [x] Add a deterministic 200 MiB server characterization proving congestion
  remains attachment-scoped without closing the shared connection.
- [x] Add metadata-only diagnostics for traffic class, opaque attachment id,
  queued bytes/frames, confirmed/head positions, congestion transition, and
  connection rehydration outcome.

### 2. Separate terminal presentation delivery

- [x] Define the connection scheduler and terminal-lane state machine with
  explicit byte, frame, age, and fairness limits.
- [x] Remove raw terminal output from the generic journal FIFO while preserving
  exact attachment authorization and terminal event subscription semantics.
- [x] Reserve bounded control capacity and prove terminal output cannot starve
  command/query results, workspace deltas, or lifecycle events.
- [x] Preserve ordering of dimensions, presentation ownership, output, exit,
  and resync transitions within each exact terminal attachment.

### 3. Recover one congested presentation

- [x] Convert terminal-lane overflow into one attachment-scoped
  `resync_required` transition without closing the transport or PTY.
- [x] Rehydrate the affected xterm through the checkpoint protocol from a
  precise safe position and resume bounded live delivery without gaps or
  duplicates.
- [x] Keep unrelated terminals interactive and allow workspace/terminal
  creation commands throughout another terminal's congestion.
- [x] Bound repeated overflow, pins, retries, parser work, and queued live tail;
  ensure controller input is restored only after valid hydration.

### 4. Repair genuine connection recovery

- [x] Implement and expose `connected → reconnecting → resubscribing →
  hydrating → connected` for Local and remote clients.
- [x] Replace disposed clients atomically with generation guards, bounded
  backoff, and actionable failure state; never reuse a half-closed transport.
- [x] Reload authoritative workspace state and reattach mounted terminal panels
  without creating another PTY or losing presentation identity.
- [x] Prove new commands fail promptly while reconnecting and succeed after
  recovery rather than timing out against an inert client.

### 5. Verify limits and convergence

- [x] Pass the deterministic 200 MiB regression and the real Electron
  presentation-limit reproduction without retry.
- [x] Test sustained output with bounded memory and a deliberately stalled
  renderer while another terminal and workspace commands remain responsive.
- [x] Test multiple noisy terminals for fair progress and reserved control
  capacity.
## Acceptance checks

- A finite or sustained terminal producer cannot close or starve the shared
  application connection.
- Queue memory is bounded per attachment and per traffic class.
- A slow display converges from a checkpoint while its PTY and unrelated
  sessions remain live.
- Workspace state and terminal creation remain usable during congestion.
- A genuine connection failure recovers automatically or presents an active,
  actionable retry state; it never leaves the workspace silently inert.
- Local and remote clients obey identical delivery, resync, authorization, and
  recovery rules.

## Definition of done

Terminal output has a bounded attachment-owned delivery path, terminal
congestion performs safe checkpoint resynchronization instead of connection
failure, control traffic remains available, real transport loss reconverges the
workspace and mounted terminals, all resource and hostile-boundary tests pass,
and the deterministic 200 MiB plus real Docker Electron regressions pass.
