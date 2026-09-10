# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: multi-server-workspace

## In-Force ADR Context Reviewed

- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - its launch rule binds a window to its server's bundle; superseded by ADR-0018, which keeps server-bundled UI, protocol-blind hosts, and host-supplied transports
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - the premise of this change: every remote is a Terminay Server
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - unchanged; each window still runs one bundle in one sandboxed partition
- openspec/adr/0012-pwa-framed-session-host.md - unchanged; the manager frames the primary server's session origin and gains only the job of opening attached transports
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - unchanged; attached-server credentials stay in the host and cross only transport-authenticated channels; first pairing with a new server still happens at that server
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - a direct-exposure server can be an attached connection on Desktop exactly as it can be a primary one today
- openspec/adr/0011-security-trust-boundary-model.md - the "server UI bundle → client host" row's "protocol compatibility" now means the bundle-to-host boundaries only; server compatibility is a protocol boundary evaluated by the bundle's client

ADR-0001, 0002, 0003, 0004, 0006, 0010, 0014, and 0016 are in force and do not
constrain this change.

## Repository-Level ADRs Created

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - one bundle per window drives many connections; compatibility is negotiated per connection by the protocol; the client owns composition and each server owns its workspace

## Notes

ADR-0018 restates the parts of ADR-0008 it keeps, so a reader walking the
supersession chain finds the full in-force rule in one file.
