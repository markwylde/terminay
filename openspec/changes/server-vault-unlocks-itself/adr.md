# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude
- Change: server-vault-unlocks-itself

## In-Force ADR Context Reviewed

- openspec/adr/0003-vault-interface-and-key-protectors.md - defines the headless unlock channels this change widens; superseded in part.
- openspec/adr/0011-security-trust-boundary-model.md - vault secret bytes stay inside `withSecret`; the change keeps that, and only moves where the unlock secret comes from.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - the key file is a secret store: durable write, no `.previous`.

## Repository-Level ADRs Created

- openspec/adr/0118-a-standalone-server-vault-unlocks-from-a-key-file-in-its-data-root.md - the standalone server generates and reads its own vault key from the data root; a passphrase vault converts once.

## Notes

The data root was already the trust boundary for device keys and pairing material.
