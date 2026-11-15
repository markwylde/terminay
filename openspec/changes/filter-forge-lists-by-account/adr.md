# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-15
- Reviewer: Claude (Opus 5.5)
- Change: filter-forge-lists-by-account

## In-Force ADR Context Reviewed

- openspec/adr/0106-forge-pull-requests-and-issues-come-from-pull-based-on-demand-forge-sources.md - lists are asked on demand, merged across accounts by the host service, and narrowed only by host-checked filters; account narrowing is one more such filter.
- openspec/adr/0028-no-polling-without-owner-approval.md (no polling without approval) - the account list is asked on show and on `forge.changed`, never on a timer.

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the remembered account lives in per-device, per-origin client storage.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the UI ships with the server, so the new `accounts` request field never meets an older server.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The account filter is an additional host-checked narrowing within ADR-0106's
model; it adds no source contract, stored server state, or authority.
