## Why

Terminal attachments already had bounded replay, acknowledgement, resync, and
checkpoint primitives, but the protocol adapter drained live output straight
into the global ordered event journal, and journal listeners enqueued every raw
terminal frame into one connection-wide FIFO without awaiting downstream
capacity. At 16 MiB or 1,024 frames the outbound pump treated temporary
terminal congestion as a terminal connection error, rejected every queued
frame, and closed the renderer's only application connection. Terminal clients
became inert, a newly created session could not publish its panel, and
rehydration did not reliably replace the disposed context, so waiting did not
recover the window.

## What Changes

- **BREAKING** Raw terminal output leaves the generic global event-journal
  delivery path.
- The server connection owns a terminal-stream scheduler with one independently
  bounded lane per exact attachment and a separately bounded control lane; only
  the scheduler calls the transport writer.
- Command and query results, workspace events, resync notifications, and
  lifecycle traffic retain reserved control capacity that a noisy terminal
  cannot consume.
- A terminal lane overflow changes that attachment to `resync_pending` and
  emits one control-lane `resync_required` transition recording the last
  confirmed and current output positions, instead of failing the connection.
- The client replaces or clears only the affected emulator presentation,
  hydrates from a newly pinned canonical checkpoint, and rejoins live delivery
  contiguously.
- `connected → reconnecting → resubscribing → hydrating → connected` is
  implemented and exposed for Local and remote clients, with generation-guarded
  atomic replacement and bounded backoff.
- Metadata-only diagnostics record traffic class, opaque attachment id, queued
  bytes and frames, confirmed and head positions, congestion transitions, and
  rehydration outcome.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-stream-congestion-and-recovery`: terminal presentation delivery
  becomes attachment-scoped and independently bounded, congestion resynchronizes
  one attachment instead of closing the connection, and genuine transport loss
  reconverges the workspace.

## Impact

The server connection outbound path and its delivery pump, the protocol
adapter's terminal output route, the checkpoint and replay protocol, the
renderer connection recovery controller, terminal panel hydration, and the
diagnostics surface. Regression coverage adds a deterministic 200 MiB server
characterization and a real Docker Electron presentation-limit reproduction.
