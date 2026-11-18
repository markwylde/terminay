# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-18
- Reviewer: Claude (with Mark Wylde)
- Change: configurable-hosted-endpoints

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - manager and per-session origin isolation; remains in force, its hosts become defaults
- openspec/adr/0012-pwa-framed-session-host.md - PWA frames the session origin from the manager; remains in force
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - session origin serves the bundle; unaffected (supersedes ADR-0008)
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - unaffected
- openspec/adr/0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md - push attribution by origin; unaffected

## Repository-Level ADRs Created

- openspec/adr/0136-hosted-manager-and-session-hosts-are-explicit-configuration.md - App Server and Session Server replace the derived hosted domain, with isolation enforced by shared validation

## Notes

- No ADR is superseded: the isolation decisions of ADR-0005 and ADR-0012 stand unchanged.
