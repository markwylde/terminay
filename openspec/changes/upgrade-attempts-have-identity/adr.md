# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (with Mark Wylde)
- Change: upgrade-attempts-have-identity

## In-Force ADR Context Reviewed

- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - unchanged; the server still hands over to its own release's upgrader, and the helper stays content-blind
- openspec/adr/0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md - unchanged; install-latest runs also record a start and an ending
- openspec/adr/0028-no-polling-without-owner-approval.md - in force, superseding ADR-0022 and carrying its watch-first rule; the record is watched, no poll is added, and deadlines are one-shot timers

## Repository-Level ADRs Created

- openspec/adr/0125-a-server-upgrade-attempt-is-owned-by-the-server-and-ended-by-the-upgraders-record.md - attempts have a server-owned identity, every upgrader run records itself, the record ends the attempt, revision identifies a build, clients render rather than infer

## Notes

- ADR-0125 is created by this change and was revised within it after review, before the change merged.
