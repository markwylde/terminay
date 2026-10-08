# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-08
- Reviewer: Mark Wylde
- Change: explain-locked-data-root

## In-Force ADR Context Reviewed

- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  one server is the authority for a data root; the lock that enforces it is
  unchanged.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change rewords a startup failure. Lock acquisition, release, and the
decision never to clear a lock automatically are as they were.
