# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Mark Wylde
- Change: kernel-held-data-root-lock

## In-Force ADR Context Reviewed

- openspec/adr/0002-sqlite-state-repository.md - `node:sqlite` is already a
  server dependency; the lock uses it and adds none.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  one server is the authority for a data root; this is what the lock enforces.
- openspec/adr/0028-no-polling-without-owner-approval.md - rules out a
  heartbeat timer where an event source exists; the kernel is that source.
- openspec/adr/0033-pinned-node-runtime-baseline-on-npm-12-2.md - the pinned
  Node provides `node:sqlite` without a flag.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - the holder outlives
  the server and must not keep the data root held; POSIX locks are not
  inherited.
- openspec/adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md -
  a staleness deadline on a lock would count a holder's suspension as its
  death.

## Repository-Level ADRs Created

- openspec/adr/0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md -
  a process's exclusive claim on disk is a kernel-held lock, taken through
  `node:sqlite`, never a file's existence, a recorded pid, or a heartbeat.

## Notes

Evidence is in `openspec/adr/evidence/kernel-held-data-root-lock-spike.md`.
No in-force ADR is superseded.
