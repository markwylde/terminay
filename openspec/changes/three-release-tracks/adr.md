# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude
- Change: three-release-tracks

## In-Force ADR Context Reviewed

- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - server archives on `tag` and rolling `main` channels; decision 3's per-merge rebuild is superseded in part by ADR-0109, the rest stands.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md - the update trust check (digest plus designated requirement) stands; decision 3 (the beta channel) is superseded by ADR-0109.
- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - stands; canary is one more channel under it.
- openspec/adr/0079-desktop-macos-floor-follows-electron-to-macos-13.md - stands; nightly and canary metadata declare the same floor.
- openspec/adr/0083-windows-x64-desktop-joins-the-matrix-and-holders-prove-themselves-both-ways.md - stands; the Windows probe runs on every track.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - stands; pull-request CI is not changed.

## Repository-Level ADRs Created

- openspec/adr/0109-three-release-tracks-and-a-canary-that-is-signed-but-not-notarized.md - three tracks from `main`; canary signed but not notarized and never offered for download; one rolling release per prerelease track; versions ordered by commit across tracks.

## Notes

ADR-0109 supersedes ADR-0016 and ADR-0027 in part only. Neither file was edited. The 90-day legacy beta feed is transitional and is recorded as an open item on ADR-0109, not as a decision.
