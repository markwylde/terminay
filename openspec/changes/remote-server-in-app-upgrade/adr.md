# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-11
- Reviewer: Claude (for Mark Wylde)
- Change: remote-server-in-app-upgrade

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the upgrade request is a device-to-server administrative action; the system-scope helper is an unprivileged-to-root crossing and is designed as one.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - the archive, its signature, the side-by-side layout, and the channel rules are reused unchanged; the archive gains the CLI.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md - the client-only-asks rule is carried over to the server; the Desktop updater itself is untouched.
- openspec/adr/0028-no-polling-without-owner-approval.md - the hourly release check is a poll; the owner's approval and its lifecycle owner are recorded in design.md.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - what makes an in-place upgrade keep terminals, on systemd and under the supervising container entrypoint.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - hosts stay protocol-blind, so the release check belongs to the server and not to Desktop.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - upgrade status is per server and reaches every window of every device; authority to ask is the device's.
- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - the confirmation uses the shared frame.
- openspec/adr/0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md - the restarted server takes the data-root lock as any start does; the upgrader never opens server state.
- Remaining in-force ADRs checked against the index by title and scope; none constrains this change and none is touched by it.

## Repository-Level ADRs Created

- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - the server chooses the target and a client names only a mode; the upgrader ships in the archive; a root-owned path unit crosses privilege for system scope; a container image is a baseline the data volume may outrank; supersedes nothing.

## Notes

- The index in `openspec/adr/README.md` has a row for ADR-0062.
- Other changes in progress may also claim 0062; whichever merges second renumbers.
- ADR-0028's approval for the hourly check, poll and interval both, is recorded in design.md decision 2.
