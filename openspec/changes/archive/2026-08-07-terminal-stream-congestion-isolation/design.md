## Context

See proposal.md for the defect. The original reproduction emitted a large PTY
burst in Docker and observed missing forward progress or an inert terminal
afterwards. The permanent regression uses a fast test pyramid instead: the
deterministic server test advances the complete 200 MiB byte range, while
Docker Electron emits 1 MiB — enough to cross the same presentation limits —
through the real PTY, checkpoint parser, xterm, and Local MessagePort.

An earlier completed baseline had already established transport-failure
invalidation, generation-guarded retry with bounded backoff, and workspace
reload before re-enabling mutations. That baseline exposed the remaining
overlapping renderer recovery owners, which the unified renderer connection
recovery work supersedes with one final controller. This change retains
ownership only of terminal congestion, attachment-scoped resynchronization, and
forced MessagePort and WebSocket evidence; it does not extend the old remote
recovery implementation.

## Goals / Non-Goals

Goals:
- A terminal producing hundreds of megabytes, or a stalled renderer, cannot
  close or starve the shared application connection.
- Queue memory is bounded per attachment and per traffic class.
- A slow display converges from a checkpoint while its PTY and unrelated
  sessions stay live.
- A genuine connection failure reconverges the workspace and mounted terminals.

Non-Goals:
- Maintaining a second renderer recovery lifecycle beside the unified
  controller.
- Making recovery wait for PTY silence.

## Decisions

### Terminal-owned delivery

- Raw terminal output is removed from the generic journal FIFO while exact
  attachment authorization and terminal event subscription semantics are
  preserved. Mixing presentation bytes with control traffic in one queue was the
  root cause; separating the queues is what makes the bound meaningful.
- The scheduler is the only caller of the transport writer. It preserves order
  within each lane and selects ready terminal lanes fairly, so one noisy
  terminal cannot monopolise the writer.
- Control capacity is reserved. Command and query results, workspace deltas,
  resync notifications, and lifecycle events therefore remain deliverable
  during congestion, which is what keeps terminal and workspace creation usable.

### Attachment-scoped recovery

- Lane overflow is a presentation event, not a connection error. The attachment
  moves to `resync_pending`, pending raw frames for it are released, and a
  single control-lane `resync_required` transition records the last confirmed
  and current output positions.
- The client replaces or clears only that emulator's presentation, hydrates
  from a newly pinned canonical checkpoint, and rejoins live delivery
  contiguously — no gaps and no duplicates.
- Repeated congestion stays bounded: it cannot create an unbounded retry,
  checkpoint-pin, event-journal, parser, or hydration queue, and controller
  input is restored only after valid hydration.

### Connection recovery

- True transport failure invalidates the old application client and enters an
  observable reconnect state. Desktop replacement MessagePorts and remote
  transports use one generation-guarded retry loop with bounded backoff, and a
  replacement context is fully authenticated and subscribed before atomically
  replacing the old one. A half-closed transport is never reused.
- Workspace state reload and terminal hydration complete before mutations are
  re-enabled, and reattachment does not create another PTY or lose presentation
  identity. New commands fail promptly while reconnecting rather than timing out
  against an inert client.

## Risks / Trade-offs

- Per-attachment lanes cost more bookkeeping and more total buffer headroom
  than one shared FIFO. That is accepted in exchange for the failure being
  scoped to one display rather than the whole connection.
- Releasing pending frames on overflow discards presentation bytes that the
  client has not seen. The checkpoint hydration path is what makes that safe,
  so the checkpoint pin must be taken before the frames are dropped.
- Failed recovery attempts remain visible and retryable rather than leaving
  disposed clients mounted, which means the user sometimes sees an actionable
  error state instead of an automatic silent repair.

## Migration Plan

The deterministic 200 MiB regression and the real Docker Electron
presentation-limit reproduction must both pass without retry before the old
shared-FIFO path is considered replaced.
