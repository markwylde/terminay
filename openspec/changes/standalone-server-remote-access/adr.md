# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude
- Change: standalone-server-remote-access

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md: device trust, host-key custody and exposure stay in the server process. Clients only send commands.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md: approval stays a match-code decision on one shared queue. No credential gains a new path.
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md: direct and hosted share one host key, device registry and approval queue. Runtime control keeps that.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md: no host or renderer change. The operations already exist in the bundled client.

## Repository-Level ADRs Created

- openspec/adr/0120-every-server-host-serves-runtime-exposure-control-over-the-application-protocol.md: both host kinds serve `remote-access.*`. Runtime start or stop is not the standing decision. A standalone server always has its stable session origin.

## Notes

None.
