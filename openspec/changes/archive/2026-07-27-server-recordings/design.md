## Context

See proposal.md. Recording previously ran as privileged Electron state hooked
into the renderer's terminal lifecycle. The server now owns terminal-session
lifecycle, so recording had to move with it: capture must sit at the PTY
boundary the server already owns, and the client must become a management and
replay surface that works identically over a local or WebRTC transport.

## Goals / Non-Goals

Goals:
- One cast event per PTY event regardless of how many clients are subscribed.
- Capture that survives every client-side lifecycle event.
- Remote replay that is bounded, cancellable, and needs no filesystem access.
- Accurate finalization across every stop path, including unclean restart.

Non-Goals:
- Changing the asciicast v3 file format or the adjacent metadata layout.
- Migrating user recordings between roots.
- Full `TerminayClient` end-to-end acceptance, host reveal integration, and
  legacy-root migration, which were kept as separate acceptance work and were
  explicitly not claimed by this slice.

## Decisions

- **Capture at the server PTY boundary, before fan-out.** Recording subscribes
  once at the boundary the server already owns rather than per observer, which
  is what makes "one PTY event, one cast event" true by construction rather than
  by de-duplication.
- **Observers are replaceable subscriptions.** Adapter disposal or client
  disconnect has no effect on an active `RecordingService` session; removing an
  observer removes only that observer. Capture ownership stays with the session.
- **A transport-neutral `ServerRecordingAdapter`.** The same adapter serves
  local and remote transports, and every command handler enforces
  server/project/scope authorization against the authenticated identity. This
  keeps the project/window and terminal-session security boundaries intact for
  remote replay.
- **Opaque recording ids, validated at the final filesystem boundary.** Clients
  address recordings by opaque id; configured roots and ids are validated where
  the path is actually constructed, so traversal cannot be introduced by an
  earlier layer.
- **Path-free DTOs.** Persisted cast paths are removed from the server
  `RecordingListItem` DTO before local or remote transport, and recording data
  is not part of the remote application resume DTOs. Adapter tests assert
  path-free responses.
- **Reveal is a host callback, not a path.** `recordings.reveal` invokes a host
  callback and returns no cast path. Reveal is offered only when a capable host
  represents the server machine; other hosts get path and copy guidance.
- **Legacy roots by reference.** `importLegacyRoot` registers a historical root
  as a metadata-only opaque reference and keeps an unavailable root in the
  library index rather than moving or rewriting user data.
- **One input boundary for the input-capture policy.** Keyboard, paste, macro,
  dictation, MCP, and remote writes all pass through the server
  `TerminalInputSourceAdapter`'s single accepted-input boundary, and the
  `createRecordingInputCapture` callback hangs off that boundary, so the
  input-recording default-off policy cannot be bypassed by a new input source.

## Risks / Trade-offs

- Server-owned capture means a recording can keep growing while nobody is
  watching. This is accepted as the point of the change; finalization on PTY
  exit, stop, shutdown, and restart recovery bounds it.
- Bounded replay ranges add protocol round-trips compared with reading a file
  directly. Accepted in exchange for remote replay without filesystem access.
- Removing cast paths from DTOs makes some host-native affordances impossible
  without a capable host; the path/copy guidance fallback covers that.

## Migration Plan

Existing recording roots are registered as legacy roots by opaque reference.
User data is not moved, and an unavailable legacy root stays visible in the
library index rather than disappearing.
