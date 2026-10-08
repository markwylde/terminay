# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-21
- Reviewer: Claude (for Mark Wylde)
- Change: help-check-for-updates

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md — the renderer is
  untrusted. The pacing bypass is reachable only from the native menu in the
  main process; the renderer's `updater.check` action stays throttled.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md —
  a manual check uses the same feed, verification, and install path as a
  scheduled one.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md — the
  updater is a host capability; the new host event is payload-free and optional
  for a bundle that does not know it.
- openspec/adr/0022-watch-do-not-poll.md — the event replaces waiting on the
  renderer's status poll; no polling is added.

Reviewed and not relevant to this change: ADR-0001 through ADR-0006, ADR-0010,
ADR-0012, ADR-0013, ADR-0015 through ADR-0017, ADR-0019 through ADR-0021,
ADR-0023, ADR-0025, ADR-0026.

Superseded and therefore historical only: ADR-0007 (by ADR-0008), ADR-0008 (by
ADR-0018), ADR-0009 (by ADR-0017), ADR-0014 and ADR-0024 (by ADR-0025).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.
