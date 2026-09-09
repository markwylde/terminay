# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-07
- Reviewer: Mark Wylde
- Change: headless-server-release-and-pairing

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - platform artifacts carry the pinned Node runtime; archives satisfy this, the npm pack tgz never did
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - Linux x64/arm64, Debian 12 userspace; fixes the archive matrix
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - the archive bundles the selected WebRTC runtime
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the archive bundles the UI; Desktop stays protocol-blind when pairing direct (supersedes ADR-0007)
- openspec/adr/0011-security-trust-boundary-model.md - signaling is untrusted; direct exposure must fit the existing "Server ↔ hosted signaling" row
- openspec/adr/0012-pwa-framed-session-host.md - browsers keep the manager/session split; direct mode does not extend to browsers
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - credentials only on transport-authenticated channels; direct mode adds no HTTPS credential path

ADR-0002, 0003, 0005, 0009, 0010, and 0014 are in force but do not constrain this change.

## Repository-Level ADRs Created

- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - a server may host its own data-blind signaling endpoint; the transport transcript, not TLS, authenticates it; one host key and device registry across hosted and direct
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - signed per-arch self-contained archives on tag and rolling `main` channels, with a versioned side-by-side install layout

## Notes

Neither new ADR supersedes an existing one. ADR-0015 specialises ADR-0011's
signaling row and ADR-0013's channel-only rule to a self-hosted endpoint;
ADR-0016 realises ADR-0001's artifact rule for the standalone server.
