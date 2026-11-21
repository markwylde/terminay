# ADR Review Manifest

## ADR Review Completed

- Date 2026-11-21
- Reviewer Codex
- Change `desktop-remote-recovery`

## In-Force ADR Context Reviewed

- [ADR-0005](../../adr/0005-sandboxed-origin-bound-client-hosts.md) keeps the recovery capability scoped to the bound sandboxed document.
- [ADR-0013](../../adr/0013-device-bound-host-approval-and-channel-only-credentials.md) and [ADR-0048](../../adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md) govern device authentication, window identity, and replacement peer admission.
- [ADR-0028](../../adr/0028-no-polling-without-owner-approval.md) keeps wake recovery event-driven and reuses the existing heartbeat.
- [ADR-0034](../../adr/0034-no-media-relay-reachability-from-candidates-and-routing-hints.md) keeps recovery on the established authenticated WebRTC path.
- [ADR-0041](../../adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md) governs liveness deadline measurement. The wake hint requests a fresh probe, whose deadline and outcome are still local to the workspace client.
- [ADR-0047](../../adr/0047-a-window-is-one-server-running-the-host-bundle.md) keeps Desktop main protocol-blind and the recovery scoped to the window's binding.
- [ADR-0136](../../adr/0136-hosted-manager-and-session-hosts-are-explicit-configuration.md) keeps the remembered profile's signaling configuration on the reconnect path.

## Repository-Level ADRs Created

None. Existing ADRs already assign transport ownership to Desktop main and application liveness to the measuring client. The change restores those responsibilities at the existing document boundary.

The signed refusal follows ADR-0013’s device-proof and pinned host-key boundaries. It uses the existing data-blind signaling route.
