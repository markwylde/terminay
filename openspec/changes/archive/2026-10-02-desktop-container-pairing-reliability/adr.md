# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-01
- Reviewer: Codex
- Change: desktop-container-pairing-reliability

## In-Force ADR Context Reviewed

- `openspec/adr/0005-sandboxed-origin-bound-client-hosts.md` - pairing action and profile persistence stay in the privileged Desktop host.
- `openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md` - diagnostics use the pinned WebRTC runtime.
- `openspec/adr/0011-security-trust-boundary-model.md` - connection diagnostics exclude credentials and application data.
- `openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md` - host approval and data-channel credential flow remain unchanged.
- `openspec/adr/0015-self-hosted-direct-signaling-exposure.md` - direct signaling remains data-blind and uses transport transcript authentication.
- `openspec/adr/0018-one-workspace-bundle-many-server-connections.md` - host profile and per-connection transport ownership remain intact.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. Room invalidation closes an implementation gap within the existing one-time approval contract.

## Notes

The remaining in-force ADRs were checked for supersession in `openspec/adr/README.md`; this change does not alter their decisions.
