## Context

See proposal.md. `RendererConnectionController` already existed from the extension API, manifest,
and host work, but was never wired into `src/web/main.tsx`, so the workspace still ran its own
ad-hoc connect and recovery logic.

## Goals / Non-Goals

Goals: the workspace shares the session host's current WebRTC generation, and initial connect,
automatic recovery, and Retry are one in-flight attempt.

Non-Goals: changing how the session host itself creates or retires generations. That authority
stays with the hosted session transport host.

## Decisions

- **Workspace connect acquires, it does not join.** The workspace never starts a second signaling
  join; `connect` returns the current session-host generation.
- **Lifecycle is subscribed after connect returns, and generation-checked.** A `closed` or
  `failed` event belonging to a retired generation is ignored, so a retiring bootstrap generation
  cannot dispose a client that has just hydrated.
- **One in-flight attempt covers all three entry points.** First mount, automatic recovery, and
  Retry are coalesced, so overlapping `connect()` is impossible. Retry during an in-flight attempt
  is coalesced rather than starting a competing join.
- **A hung attempt has a bounded deadline.** It returns to retry-wait instead of latching, which is
  the specific failure the previous `recoveryInFlight` flag produced.
- **Reconnecting UI is driven by the attempt, not by paint state.** A painted workspace whose
  client was disposed cannot remain marked connected.

## Risks / Trade-offs

This change is only correct alongside the hosted-side change that makes `connect` use the current
generation and publish subscribable lifecycle; the two must ship together.
