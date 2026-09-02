## Context

See proposal.md for the missing coverage. The investigation extended the real
Chromium plus plain-Node `node-datachannel` path to: pair and authenticate all
native WebRTC lanes; send a sustained human-paced per-character sequence in
exact order; reload through the saved-session bootstrap; close only the
application lane while the peer stays connected; type the next character and
observe `client is not connected`; click **Retry connection**; and send a
post-Retry sequence.

The original production build failed the last step. Retry started and its
initial error presentation cleared, but the post-Retry sequence never reached
the PTY.

A later production reproduction exposed a distinct split-brain case the
required-lane matrix did not cover: the server-side application-protocol reader
ended while the native peer and application data channel remained open. The
server discarded the application client, but the host continued presenting the
transport as connected. Terminal renewal then surfaced `terminal presentation
renewal failed: client is not connected`, and Retry reused or waited behind the
stale generation instead of creating a usable one. That protocol-only failure is
now part of the permanent reproduction and is fixed at the generation ownership
boundary rather than suppressed in terminal UI.

## Goals / Non-Goals

Goals:
- Real transport failure and recovery are a release-blocking native WebRTC
  contract.
- Automatic recovery and Retry restore the mounted workspace and exact ordered
  terminal input without page reload, duplicate effects, or silent inert state.

Non-Goals:
- Replaying a terminal mutation whose outcome is unknown.
- Requiring browser refresh as part of recovery, though refresh remains
  independently supported.

## Decisions

- **Generation ownership is the fix boundary.** Application-protocol reader
  termination fails the whole host-owned generation, is delivered once with the
  exact generation identity, and retires the stale client, peer, lanes,
  subscriptions, and attachments before replacement begins. Suppressing the
  symptom in terminal UI would have left the split-brain state intact.
- **Retry never consults stale state.** Both automatic recovery and manual Retry
  create a fresh generation rather than awaiting or reusing the retired peer or
  channels. Repeated Retry during backoff coalesces into one successful
  replacement generation.
- **The whole generation is bounded**, including terminal hydration and
  verification, so a transport that acquires an endpoint but never becomes
  usable retires and returns to retry-wait. The timed-out candidate must retire
  before one manual Retry activates a fresh generation.
- **Bootstrap lanes are not mounted lanes.** `api` and `asset` are faulted
  independently before handoff and asserted closed and unreachable after every
  successful mounted handoff and replacement.
- **Uncertain terminal input is discarded, never replayed.** When a terminal
  input outcome is unknown the active queue closes and discards both queued and
  later input, and attaching a replacement cannot replay any of it. The terminal
  input contract does not expose its generated command id to the panel and the
  server command ledger is connection-scoped, so a reconnect-safe idempotent
  result query is not available; inferring or blindly replaying the mutation is
  therefore prohibited.
- **The clean Linux native proof is self-contained**: it builds workspace
  packages and the production application, installs the selected prebuilt
  runtime, runs without DISPLAY, Wayland, or a compiler toolchain, and retains
  traces and screenshots on failure. The earlier wrapper's omission of the
  application build is what made its result unfalsifiable.
- **Diagnostics are metadata-only and typed**: opaque profile, transport
  generation, lane label, peer and ICE state, lifecycle phase, attempt, close
  reason, and outcome — never terminal bytes, paths, credentials, SDP, ICE
  candidates, or signaling secrets.
- **Misleading evidence is removed rather than reinterpreted.** Tests that
  claimed WebRTC recovery while selecting WebSocket, or that only reconnected
  after page close, are renamed to describe their actual transport or page
  lifecycle. The completed transient ICE-grace work is preserved as history and
  is not reinterpreted as proof of required-lane replacement.

## Risks / Trade-offs

- Discarding uncertain terminal input can lose keystrokes the user typed. That
  is preferred to duplicating a mutation whose effect on the PTY is unknown.
- Treating reader termination as whole-generation failure retires a peer that is
  technically still open, costing a full replacement handshake. The alternative
  is the split-brain state that produced the original defect.

## Open Questions

The evidence boundary was recorded explicitly: repository implementation can
complete deterministic fault injection, the native Linux scenarios available to
the configured runners, Docker Electron and browser coverage, diagnostics, and
release-workflow gates. Linux arm64 native evidence, physical iOS Safari
evidence, branch-protection activation, coordinated artifact publication, and
deployed-origin verification remain unchecked until those external systems
produce revision-bound evidence. A local substitute, an emulated browser, or a
workflow source assertion cannot mark those outcomes complete.
