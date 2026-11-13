# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (Opus 5.5)
- Change: daemon-onboarding-just-works

## In-Force ADR Context Reviewed

- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - archives ship their own runtime (`bin/node`), which decision 2 of the design relies on; signature verification unchanged.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - the terminal probe deliberately does not go through the session holder and starts no session.
- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - in-app upgrades run the new release's CLI through the root upgrade helper, so the account-shell fix and launcher reach existing installs on upgrade.
- openspec/adr/0110-three-release-tracks-and-a-canary-that-is-signed-but-not-notarized.md - prerelease version form `<next>-main.<count>.<track>`, which Nightly and Canary server archives must now carry.

## Repository-Level ADRs Created

- openspec/adr/0111-service-account-work-runs-on-the-release-runtime-and-ready-means-usable.md - the service account only ever executes the release's runtime; launch failures are classified from the child's output; "ready" means health, socket, and terminal all work; `doctor` exposes the same checks.

## Notes

Elevation through `sudo`, the dedicated account's login shell, the launcher, and the archive-version fix are tactical and live in design.md.
