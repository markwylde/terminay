# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-07
- Reviewer: Mark Wylde
- Change: terminay-daemon-cli

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - the server runs on its bundled Node; the CLI's Node version is irrelevant to it
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - the CLI's platform scope is the server's Linux matrix
- openspec/adr/0011-security-trust-boundary-model.md - the data root and its owner-only socket are the operator's authority; the CLI adds no new listener
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - the QR command surfaces the match-code approval; it does not bypass it
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - the CLI enables direct exposure by default and derives the direct origin
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - archives, sidecars, signatures, channels, and the side-by-side layout the CLI implements

ADR-0002, 0003, 0005, 0006, 0008, 0009, 0010, 0012, and 0014 are in force but do not constrain this change.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. The install layout, channel semantics, and verification rules are those recorded in ADR-0016; the CLI is their first implementation.

## Notes

The embedded release public key (design D3) makes the CLI a compatibility
surface for key rotation, which ADR-0016 already records as a consequence.
