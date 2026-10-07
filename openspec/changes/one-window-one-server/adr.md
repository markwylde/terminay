# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Claude (for Mark Wylde)
- Change: one-window-one-server

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the renderer names a profile id only; the host binds the window.
- openspec/adr/0011-security-trust-boundary-model.md - switching a window's server is a privileged host act behind a closed action.
- openspec/adr/0012-pwa-framed-session-host.md - a browser session already frames one server; the manager remains the switcher.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - pairing is unchanged; only its target window moves.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - a project is a folder on its server, which is why the new-project flow needs no placement choice.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - superseded by ADR-0047 below.
- openspec/adr/0028-no-polling-without-owner-approval.md - rules out polling other servers for activity.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - Home tabs lose their server binding and stay device-local.
- Remaining in-force ADRs (0002, 0003, 0006, 0010, 0015, 0016, 0019, 0020, 0021, 0023, 0025, 0026, 0027, 0029, 0031, 0033-0039, 0041-0046) reviewed; not touched by this change.

## Repository-Level ADRs Created

- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - a window is bound to exactly one server and changes server only by an explicit host action; supersedes ADR-0018 while keeping its packaged-bundle and protocol-compatibility decisions.

## Notes

- ADR-0018 is left untouched. The index in `openspec/adr/README.md` marks it superseded.
- The Add connection provider list is static bundle data, not an extension point, and establishes no durable commitment.
