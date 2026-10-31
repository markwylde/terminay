# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-31
- Reviewer: Claude (with Mark Wylde's recovery decisions)
- Change: durable-state-files

## In-Force ADR Context Reviewed

- openspec/adr/0002-sqlite-state-repository.md - in force but not what Desktop runs today. This change hardens the file backends in use and does not adopt or reject SQLite.
- openspec/adr/0003-vault-interface-and-key-protectors.md - envelopes are not rollback-resistant, which is why secret stores keep no `.previous`.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - the holder and its records, which this change classes as rebuildable.
- openspec/adr/0083-windows-x64-desktop-joins-the-matrix-and-holders-prove-themselves-both-ways.md - the Windows holder runtime copy that gains a manifest.
- openspec/adr/0085-the-server-reaches-win32-apis-through-koffi.md - not extended; no native binding is needed for flushing.
- openspec/adr/0086-a-windows-pipe-admits-only-the-users-principals-and-a-peer-that-proves-the-credential.md - the holder credential is a credential store and fails closed.

## Repository-Level ADRs Created

- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - one durable-replace primitive for all state files; corrupt files are preserved and recovered by kind (canonical: `.previous` then the user's choice; credentials: fail closed, no rollback; rebuildable: rebuild); copied runtimes carry a verified manifest.

## Notes

No in-force ADR is superseded.
