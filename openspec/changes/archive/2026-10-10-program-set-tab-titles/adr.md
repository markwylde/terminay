# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Mark Wylde
- Change: program-set-tab-titles

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - terminal output is
  untrusted and titles never define authority; the title stays display-only.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  the owning server reads the sequence and owns the resulting state.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - clients
  present the server-resolved title and resolve nothing themselves.
- openspec/adr/0028-no-polling-without-owner-approval.md - the coalescing
  timer is one-shot and armed by an output event, not a poll.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - the PTY outlives
  the server, so the program title is persisted rather than re-derived.
- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md -
  the title is panel metadata and travels with the panel through a move.
- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md -
  per-event title work is constant; commits are coalesced off the path.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md -
  a title is never used to infer agent state.

The remaining in-force ADRs were checked by title and do not bear on this
change. Superseded and therefore not in force: 0001, 0004, 0007, 0008, 0009,
0010, 0014, 0022, 0024, 0030, 0032.

## Repository-Level ADRs Created

- openspec/adr/0056-terminal-output-reaches-workspace-state-only-as-sanitised-display-text.md -
  output-derived values are read by the server, stored in their own field
  beneath a person's, sanitised and display-only, never echoed back, and
  committed at a bounded rate.

## Notes

No in-force ADR is superseded.
