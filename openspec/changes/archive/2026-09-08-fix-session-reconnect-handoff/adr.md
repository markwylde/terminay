# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-08
- Reviewer: Mark Wylde
- Change: fix-session-reconnect-handoff

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the session origin
  is the isolation boundary for server-bundled UI; recovery reuses that same
  origin and partition rather than opening a second one.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the
  host stays protocol-blind, so the reconnect hand-off keeps the workspace
  client on `connect()` and a coarse transport state and exposes no peer, lane,
  or generation detail across the boundary.
- openspec/adr/0012-pwa-framed-session-host.md - WebRTC and reconnect live in
  the framed session origin, whose implementation is owned by `terminay.com`
  while this repository keeps the product contract; the change follows that
  split for its two halves.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md -
  recovery re-authenticates with the vaulted device key on transport-
  authenticated channels; no new credential path is introduced.
- The remaining in-force ADRs (0001-0004, 0006, 0009-0011, 0014-0016) were
  reviewed and place no constraint on this change. ADR-0007 is superseded by
  ADR-0008 and was treated as history.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change corrects behaviour inside boundaries ADR-0008 and ADR-0012 already
establish. The rule it adds — a reconnect operation never yields a transport
that is already closed — is a contract on the existing session host surface, not
a new pattern, technology, or boundary, so it belongs in the
`connections-and-client-hosts` capability spec rather than in a durable ADR.
