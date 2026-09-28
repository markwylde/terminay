# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-28
- Reviewer: Mark Wylde
- Change: fix-run-command-bracketed-paste

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the emulator keeps no
  PTY input path; reading its mode grants no new capability.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md -
  `run_command` keeps its existing write scope and authorization.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries: the mode comes from the existing
server-owned presentation emulator, and both hosts keep their existing write
paths.
