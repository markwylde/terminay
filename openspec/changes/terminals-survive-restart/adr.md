# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude (for Mark Wylde)
- Change: terminals-survive-restart

## In-Force ADR Context Reviewed

These ADRs are in force; the supersession graph retires 0001, 0007, 0008, 0009,
0010, 0014, 0022, 0024 and 0030, and this change retires 0004. The ones that
bind this change:

- openspec/adr/0002-sqlite-state-repository.md - session records and panels
  stay in the server state repository; the holder holds no workspace state.
- openspec/adr/0011-security-trust-boundary-model.md - the holder is a
  privileged process at the server's trust level; clients, extensions, and MCP
  reach terminals only through the server.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md -
  side-by-side versions with one retained; a holder must not depend on its
  version directory after start-up.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  one mechanism for embedded and standalone servers.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the
  holder protocol is internal to the server and outside the application
  protocol; hosts stay protocol-blind.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md -
  agent binding by process ancestry now passes through the holder; verified by
  test.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md -
  the update restart this change makes lossless; its install path is unchanged.
- openspec/adr/0028-no-polling-without-owner-approval.md - the unattached limit
  is one timer; the holder adds no poll.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md -
  session-scoped MCP authority must hold for a reattached session.
- openspec/adr/0033-pinned-node-runtime-baseline-on-npm-12-2.md - the holder
  runs on the pinned runtimes already shipped.

## Repository-Level ADRs Created

- openspec/adr/0035-detached-session-holder-owns-ptys.md - a detached,
  generation-frozen session holder owns PTYs so shells outlive the server;
  supersedes ADR-0004 and restates its distribution matrix unchanged.

## Notes

- ADR-0004 is superseded for its process topology only; the matrix carries over
  word for word in intent. `openspec/adr/README.md` index is updated.
- ADR-0035 is accepted with an open spike on installer and mount behaviour;
  task group 1 produces that evidence before any other work.
