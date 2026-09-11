# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: remove-project-environments

## In-Force ADR Context Reviewed

- openspec/adr/0009-server-owned-project-environments.md - the decision this change reverses; superseded by ADR-0017
- openspec/adr/0011-security-trust-boundary-model.md - two boundary rows describe environment adapters and SSH/Puzed endpoints; ADR-0017 states they are retired, and the file is not edited
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - hosts stay protocol-blind and hold connection credentials; unchanged by this change
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - agent providers keep declaring observable capabilities; the environment subsetting of those capabilities goes away, the declaration and proof do not
- openspec/adr/0003-vault-interface-and-key-protectors.md - SSH keys were the main vault consumer beyond settings; the vault stays for settings, secrets, and future use
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - native PTY is now the only PTY

ADR-0001, 0002, 0005, 0006, 0010, 0012, 0013, 0015, and 0016 are in force and
do not constrain this change.

## Repository-Level ADRs Created

- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - there is one kind of remote, a Terminay Server; every project executes on the server that owns it; the extension platform keeps its host and loses its provider kind

## Notes

ADR-0009's rejected alternative "one Terminay Server per SSH/Puzed VM" is now
the decision. The reasons it was rejected, install friction and migration,
are addressed by the absence of installed users and by naming a macOS
artifact and an SSH bootstrap as follow-ups rather than pretending they are
free.
