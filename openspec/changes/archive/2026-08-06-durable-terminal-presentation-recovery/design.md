## Context

See proposal.md. This change followed the multi-client terminal presentation
work and fixes both halves of the same failure: a renderer that discarded
healthy emulators, and a server whose only fresh-display path was a
whole-transcript replay that did not fit in a command header.

## Goals / Non-Goals

Goals:
- Unrelated workspace updates never clear, replace, detach, or rehydrate a live
  display.
- A genuinely fresh display can be reconstructed after an arbitrarily long,
  high-output PTY lifetime.
- Terminal history never travels inside the command header.

Non-Goals:
- Persisting terminal presentation as workspace metadata.
- Changing presentation ownership, dimension ownership, or takeover behaviour.

## Decisions

**Stable renderer lifecycle.** Terminal-client resolution depends only on
stable panel client, server id, project id, client id, and session id
primitives. Xterm construction and disposal are separated from attachment
reconnect and from browser file-drop and project-root context. Terminal
settings and dimensions update the existing emulator through their dedicated
effects, and browser drop-upload capabilities may change independently without
rebuilding the emulator or attachment.

**One canonical checkpoint authority on the server.** The server runs one
bounded headless terminal state machine per live PTY, with the pinned headless
and serialize versions and the same canonical dimensions and emulator options
as clients. Accepted PTY output enters the headless emulator exactly once in raw
byte order, and resize transitions are ordered with output and checkpoint
positions. Emulator-generated replies are never forwarded to the PTY:
presentation input remains solely under the existing controller lease. This is
the security-relevant part — a headless emulator that answered device, status,
colour, cursor, focus, mouse, or window queries into terminal input would be an
input-injection path, so it is proved absent by test.

**Parser-safe checkpoint positions.** A snapshot is never taken in the middle of
UTF-8 or an ANSI control sequence. A checkpoint holds bounded scrollback but
always preserves the complete active screen, alternate screen, cursor, styles,
and terminal modes represented at `C`.

**Race-free binary hydration.** The attach command returns only bounded
checkpoint metadata; snapshot bytes travel through the existing binary
query-result body rather than base64-encoded JSON. The client establishes its
exact attachment subscription *before* fetching the pinned checkpoint and
buffers subsequent output under a hard byte limit. It restores the checkpoint
into the empty xterm at geometry `C`, applies the ordered `C`→`H` tail, then
enters live delivery. Positions must be contiguous — overlap, gap, token
mismatch, expiry, or queue overflow fails closed.

**A pinned checkpoint is single-attachment and disposable.** It is pinned to the
exact `{serverId, projectId, sessionId, clientId, attachmentId}` boundary,
immutable, bounded, and released after successful fetch, detach, client close,
timeout, or session exit. It contains terminal presentation only, is never
persisted as workspace metadata, and is never exposed across a project or
session boundary.

**Every resource has a named hard limit.** Snapshot bytes, parser work, retained
tail, checkpoint frequency, per-session state, pinned-checkpoint count and
lifetime, and per-attachment hydration queues are all bounded. Crossing a limit
fails that one fresh hydration explicitly, without terminating the PTY and
without affecting an already attached display.

## Risks / Trade-offs

- A server-side headless emulator per live PTY costs CPU and heap. Mitigated by
  named ceilings and by measuring and asserting checkpoint CPU, heap, serialized
  size, pinned-state, and hydration-queue ceilings under hostile output at
  maximum supported terminal geometry.
- Checkpointing adds a second consumer of PTY bytes. Mitigated by feeding one
  ordered checkpoint state queue that does not delay ordinary terminal
  subscribers.
- A pinned checkpoint that is never fetched would leak state. Mitigated by
  expiry of abandoned attachment pins, which never affects the PTY.

## Migration Plan

The byte-zero fresh-attach surrogate was replaced by checkpoint metadata and
checkpoint-position attachment, and the `presentation_unavailable` decisions
based purely on transcript size or the 32-KiB command-header allowance were
removed. The existing lightweight resume path for a surviving emulator was kept
unchanged, as were presentation ownership, dimensions, and takeover behaviour.
