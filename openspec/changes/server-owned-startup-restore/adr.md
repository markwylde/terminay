# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: server-owned-startup-restore

## In-Force ADR Context Reviewed

- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the decision this change restores compliance with: hosts own transport, credentials, bundle installation and presentation, and do not persist or decide server workspace state.
- openspec/adr/0011-security-trust-boundary-model.md - the project and terminal-session boundaries the restore operates within; it moves no authority across them, it moves an implementation to the side that already holds the authority.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - the standalone server whose bootstrap gains the behaviour Desktop already had.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. ADR-0008 already places workspace state ownership with the server; this change removes a host-side implementation that contradicted it rather than deciding anything new.

## Notes

The remaining contradiction with ADR-0008 — the file-catalog, documentation, MDX and file-content project contexts held by `ServerTerminalAuthority` — is named in this change's design as out of scope. Should that move be taken on, it is worth reviewing whether it warrants an ADR of its own for the host/server split it would finish.
