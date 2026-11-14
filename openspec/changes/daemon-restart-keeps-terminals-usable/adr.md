# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (with Mark Wylde)
- Change: daemon-restart-keeps-terminals-usable

## In-Force ADR Context Reviewed

- openspec/adr/0035-detached-session-holder-owns-ptys.md - holder ownership, generations, and drain on build mismatch. This change adds a health condition to its §2.
- openspec/adr/0077-linux-artifacts-are-built-and-verified-at-a-declared-glibc-floor.md - the CI gate runs on the linux-x64 archive built in the floor image.
- openspec/adr/0083-windows-x64-desktop-joins-the-matrix-and-holders-prove-themselves-both-ways.md - holder authentication. The health check never touches the holder socket.
- openspec/adr/0095-session-holders-retain-bounded-terminal-presentation-in-memory.md - restart in place starts a fresh session, so no presentation is carried over.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - the new systemd job is a merge-confidence gate on Gitea Actions.

## Repository-Level ADRs Created

- openspec/adr/0116-a-session-holder-takes-new-sessions-only-while-its-environment-is-healthy.md - a holder must pass an environment health check to receive new sessions, the unit must not give the service a filesystem view that systemd tears down on stop, and survival is proven by using the shell.

## Notes

- ADR-0116 extends ADR-0035 rather than superseding it: the drain rule stands and gains one more cause.
