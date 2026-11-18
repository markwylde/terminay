# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-17
- Reviewer: Codex
- Change: keep-upgrade-modal-during-disconnect

## In-Force ADR Context Reviewed

- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md — current server remains the window's identity during failure; UI retains protocol compatibility ownership.
- openspec/adr/0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md — upgrade policy remains unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change repairs component lifetime within the existing renderer boundary.
