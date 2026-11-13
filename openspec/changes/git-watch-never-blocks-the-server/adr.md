# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (Opus 5.5)
- Change: git-watch-never-blocks-the-server

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - in force (supersedes ADR-0022, read as history for the ramp's origin); the ceiling, inotify and filter failures fall back to on-demand measurement, never polling; `git check-ignore` runs only on change.
- openspec/adr/0069-git-command-reports-reach-the-server-across-restarts.md - in force (supersedes ADR-0052; ADR-0084 supersedes it for Windows); Git command reports stay a separate refresh signal and are unaffected.

## Repository-Level ADRs Created

- openspec/adr/0113-git-watches-never-walk-a-tree-on-the-event-loop-and-skip-what-git-ignores.md - no watch walks a tree synchronously on the server event loop; built-up (Linux) watches skip Git-ignored and inert directories, are bounded by a directory ceiling, and fail into on-demand measurement.

## Notes

- Evidence: openspec/adr/evidence/linux-recursive-watch-stall.md (service-log timeline and inspector stack samples from the affected host).
