# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: fix-reconnect-presentation-fallback

## In-Force ADR Context Reviewed

- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the
  server is the sole terminal authority; the client asks only for a rendered
  position or a fresh presentation and never substitutes a cursor of its own.
  The change routes a refused resume into the existing fresh-presentation
  request and adds no client-side reasoning about server retention.
- openspec/adr/0012-pwa-framed-session-host.md - the framed session host stays
  protocol-blind. The steady recovery surface is workspace-client state; nothing
  new crosses the session-origin boundary.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - recovery reuses
  the same origin and partition; the fresh presentation is the same authorised
  attach the panel performs on first mount.
- openspec/adr/0011-security-trust-boundary-model.md - the E2E-only replay
  window override is inert unless the existing E2E marker is set and changes no
  authority; renderer code remains untrusted at every privileged boundary.
- The remaining in-force ADRs (0001-0004, 0006, 0009-0010, 0013-0016) were
  reviewed and place no constraint on this change. ADR-0007 is superseded by
  ADR-0008 and was treated as history.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change corrects two client behaviours inside boundaries ADR-0008 and
ADR-0012 already fix: a refused resume becomes a fresh-presentation request
through the recovery controller the client already has, and the recovery loop
reports whether it is recovering from durable state. Both are contracts on
existing surfaces and belong in the `terminal-stream-congestion-and-recovery`
and `connections-and-client-hosts` capability specs, not in a durable ADR.
