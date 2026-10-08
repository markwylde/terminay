# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-24
- Reviewer: Claude (at the repository owner's request)
- Change: git-status-watch-and-project-release

## In-Force ADR Context Reviewed

- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - Git and project lifecycle stay on the server that owns the project; release is a server-side command effect.
- openspec/adr/0020-per-operation-canonical-roots.md - watch paths come from the canonical roots Git reports; a root change re-binds rather than reusing a cached path.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - success is measured as zero Git spawns while idle and after close.
- openspec/adr/0022-watch-do-not-poll.md - names the Git status poll a defect and prescribes the watch plus ramp; superseded here by 0028, which carries its rules forward.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - project release must remove the project's agent directory scope.
- openspec/adr/0011-security-trust-boundary-model.md - release is driven by the server command, never by untrusted renderer state.

## Repository-Level ADRs Created

- openspec/adr/0028-no-polling-without-owner-approval.md - no polling; a poll is a last resort that needs the repository owner's explicit, recorded approval; observation is owned by, and torn down with, its lifecycle. Supersedes ADR-0022.

## Notes

- The Git status poll removed by this change is the first open item of ADR-0028.
- This change introduces no new poll, so it needs no owner approval under ADR-0028.
