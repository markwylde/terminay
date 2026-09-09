# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: advertise-address-reachability

## In-Force ADR Context Reviewed

- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - the runtime that gathers and offers the advertised candidate; this change constrains which address may be offered, not how it is offered.
- openspec/adr/0015-self-hosted-direct-signaling-exposure.md - exposure routes for a self-hosted server; the advertised address is an addition to hosted signalling, unchanged here.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - the install the CLI drives, whose service restart behaviour this change corrects.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. Refusing a loopback advertised address is input validation on an existing flag, and restarting a running service on re-install is a correction to install behaviour already specified as leaving the service on the written configuration.

## Notes

The finding behind the change — that a remote loopback ICE candidate is not probed by every browser — is evidence about peers rather than a decision about this architecture, and is recorded in the change's design.
