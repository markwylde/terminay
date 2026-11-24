# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude (with Mark Wylde)
- Change: server-check-for-updates-on-request

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - no new poll; every added check is one a person asked for, and a ten-second floor stops repeated clicks from repeating it
- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - the server still resolves the release itself; the request carries nothing
- openspec/adr/0117-installing-a-channels-latest-build-may-move-backwards-only-on-explicit-request.md - unchanged; a check refreshes `latest` that Install latest reads

## Repository-Level ADRs Created

None. The change adds one request inside the decisions above.
