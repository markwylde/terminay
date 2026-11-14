# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude (with Mark Wylde)
- Change: install-latest-on-channel

## In-Force ADR Context Reviewed

- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - signed archives, side-by-side install and rollback; unchanged and reused for older targets
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md - Desktop in-place update and digest/signature checks; unchanged
- openspec/adr/0028-no-polling-without-owner-approval.md - no new poll; install-latest reuses the existing check
- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - decision 1 ("never to an older one") superseded in part; decisions 2–5 kept
- openspec/adr/0110-three-release-tracks-and-a-canary-that-is-signed-but-not-notarized.md - decision 5 (Desktop never downgrades between tracks) superseded in part
- openspec/adr/0115-settings-are-organised-by-the-place-that-stores-them.md - places the action on This Mac → Updates and each server's Updates page

## Repository-Level ADRs Created

- openspec/adr/0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md - only an explicit, confirmed install-latest may move backwards; the target stays updater-resolved, and system scope gets a second fixed root trigger

## Notes

- The index in openspec/adr/README.md marks 0062 and 0110 as superseded in part. The ADR files themselves are untouched.
