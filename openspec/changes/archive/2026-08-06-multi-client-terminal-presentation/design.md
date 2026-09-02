## Context

See proposal.md. This change follows reliable ordered connection delivery and workspace delta
reconciliation, which supply the ordering and reconciliation the lease revision depends on.

Filtering observed OSC 10/11 strings was rejected as a fix: it would leave the same flaw for
device attributes, status, cursor, focus, mouse, window state, and any future query. The
problem is ownership of the response channel, not the content of one sequence.

## Goals / Non-Goals

Goals: exactly one interactive emulator controls input, resize, and terminal-protocol replies;
every new or reconnecting client starts from a valid screen state.

Non-Goals: changing how macros, dictation, or MCP write to a terminal. Those keep their own
authorized ordered input paths and never take presentation ownership.

## Decisions

- **One lease over the whole `onData` stream, not a filter.** The lease is keyed on the exact
  `{serverId, projectId, sessionId, clientId, attachmentId}` identity, with bounded expiry,
  renewal, release, disconnect cleanup, revocation, and an observable revision. Non-holders
  render live output read-only and cannot send automatic terminal responses.
- **Control is never taken silently.** Attachment, focus, output receipt, reconnect, and
  background rendering do not acquire or steal the lease; only explicit user intent does.
  Simultaneous takeover requests resolve deterministically, and takeover is audited as metadata
  without recording terminal content.
- **Enforcement is server-authoritative.** Client-provided focus, title, project, or session
  metadata cannot widen lease or checkpoint enforcement.
- **Hydration uses a bounded canonical checkpoint tied to an exact raw-output position.** Replay
  never starts at an arbitrary byte suffix. If no valid checkpoint is retained, the server
  returns an explicit resync/unavailable presentation state rather than a plausible-looking
  wrong screen. Checkpoint memory, serialization size, generation work, frequency, and
  per-client hydration queues are all bounded, and PTY output is treated as untrusted throughout.
- **The stale 64-KiB migration assertion is removed, not updated.** Reconciling it with the
  chosen presentation contract matters more than making the number current.

## Risks / Trade-offs

The recovery items were first backed by a whole-transcript replay surrogate, which failed once
output exceeded the 32-KiB command-header budget. They were subsequently implemented and
verified through the binary checkpoint design delivered by the durable terminal presentation
recovery task, which is why that work is recorded as a separate change.

Checkpoint correctness is byte-boundary sensitive, so verification covers checkpoints at every
byte boundary around CSI, OSC, DCS, UTF-8, alternate-screen, bracketed-paste, cursor/style, and
synchronized-output sequences.
