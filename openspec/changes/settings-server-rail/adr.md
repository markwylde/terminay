# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (Opus 5.5)
- Change: settings-server-rail

## In-Force ADR Context Reviewed

- openspec/adr/0075-management-lives-in-one-settings-surface.md - one Settings surface; rule 4's server selector is replaced by the place rail (partly superseded by ADR-0111 for Import & Export, and now by ADR-0115)
- openspec/adr/0111-cross-server-copy-is-client-mediated-through-each-servers-own-client.md - Import & Export spans every attached server through each one's own client, so it is placed under this device
- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - a client request carries only the upgrade mode, so the server Updates page shows track commands rather than switching tracks
- openspec/adr/0110-three-release-tracks-and-a-canary-that-is-signed-but-not-notarized.md - track names Stable, Nightly, Canary used on both Updates pages
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - the rail lists the window's own attached connections
- openspec/adr/0101-the-home-overview-layout-is-a-server-setting.md - Home layout stays a server setting and is not shown in Settings

## Repository-Level ADRs Created

- openspec/adr/0115-settings-are-organised-by-the-place-that-stores-them.md - Settings is navigated by place (this device, each server); a setting's place is its authority; edits and resets are place-scoped; saved servers and Import & Export belong to this device; partly supersedes ADR-0075 rule 4

## Notes

- Switching a server's track from the app is deferred; it needs an ADR amending ADR-0062.
