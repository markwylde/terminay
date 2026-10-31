# ADR-0088: Terminay's state files are replaced durably and recovered according to their kind

Status: accepted
Date: 2026-10-31

## Context

ADR-0002 chose SQLite for the server state repository. Today, though, Desktop and the server keep their state in many separate JSON files: the workspace, server and device settings, macros, automations, app windows, the vaults, device credentials, push enrolments, session-holder records and the extension registry. Each file is written by its own code. Most of them write a temporary file and rename it over the target, some write the target in place, and only the recording store flushes anything to disk.

On 2026-10-31 a Windows VM lost power three times in a row. Every file Terminay had written in the minutes before came back at its full length but filled with zero bytes. That included the workspace, three settings files, a session-holder record and the whole runtime copy that holders run from (ADR-0035). The renames had reached the disk and the data had not. Terminay then refused to start and offered only a Retry that could never succeed, which was correct under "Corrupt state preservation". NTFS behaves this way after a crash. XFS can too, as can macOS when nothing issues `F_FULLFSYNC`. ext4 hides it only for renames that replace an existing file.

Two problems need durable answers that every future store must follow: how a state file is written, and what a reader does when a file is unreadable anyway.

## Decision

1. **One durable-replace primitive for every Terminay-owned state file.** Write the full content to a new temporary file in the same directory. Flush it to stable storage with `fsync`, or `F_FULLFSYNC` on macOS. Rename it over the target, then flush the directory where the platform supports it (not on Windows). No state file is written in place, and a save does not report success before the rename returns. New stores use the primitive and do not reimplement it. User documents that the file viewer edits are outside this rule.

2. **Recovery depends on the kind of state, and every kind preserves what it found.** A file that cannot be read, parsed or validated is renamed aside with a corrupt marker and never deleted.
   - *Canonical state and settings* keep the previous committed file as `<name>.previous`. Before a replace, the current target is hard-linked or copied to `.previous` and that copy is flushed. A corrupt target falls back to a valid `.previous`, and the user is told. With no valid copy, the host asks the user to start fresh or retry. It never chooses defaults on its own.
   - *Secret, credential, pairing and revocation stores* keep no `.previous` and never roll back. ADR-0003 already notes that an older valid envelope is still cryptographically valid, so restoring one could bring back a revoked device or a rotated secret. A corrupt store fails closed, as empty, and the user is told.
   - *Rebuildable state* (holder records, the holder runtime copy, caches) is set aside and rebuilt silently.

3. **A copied runtime proves itself before it runs.** A directory that Terminay copies and later executes, such as the Windows holder runtime, carries a manifest of each file's size and SHA-256. It is flushed before its completion marker is written and is verified before each use. A mismatch means the copy is made again.

## Consequences

- Each save costs one more flush, and two for canonical files with a `.previous`. Most disks take a few milliseconds; a slow disk may take tens. The workspace repository already coalesces commits. Writers that save on every keystroke or every output event have to batch.
- The `.previous` copy doubles the on-disk size of canonical files, which are kilobytes.
- A corrupt credential store means re-pairing devices. That is the price of never resurrecting a revocation.
- Verifying the holder runtime reads every copied file at launch. Hashing is bounded by the copy's size, about 200 MB, and runs once per server start, before the first holder spawns.
- This does not replace ADR-0002. If the server moves to SQLite, that repository's own WAL and `synchronous=FULL` take over the durability of the state it holds. Every file left outside it still follows this ADR.
