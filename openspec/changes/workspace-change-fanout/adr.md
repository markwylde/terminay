# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-10
- Reviewer: Claude, for Mark Wylde
- Change: workspace-change-fanout

## In-Force ADR Context Reviewed

- openspec/adr/0002-sqlite-state-repository.md - the repository boundary the commit writes through; unchanged.
- openspec/adr/0011-security-trust-boundary-model.md - terminal output is untrusted; the title rules that follow from it are kept.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - Git measurements are counted as spawns in the evidence.
- openspec/adr/0028-no-polling-without-owner-approval.md - the title coalescing timer is armed by an output event only.
- openspec/adr/0044-output-path-work-is-proportional-to-the-output-event.md - per-title-sequence work stays constant; ADR-0059 states the same principle for the workspace path.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md and 0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - compatibility is per connection, so both new wire shapes are negotiated capabilities.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - change records and identity preservation treat folders as ordinary objects.
- openspec/adr/0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md - the commit write and the data-root lock are unchanged.
- openspec/adr/0056-terminal-output-reaches-workspace-state-only-as-sanitised-display-text.md - in force before this change; superseded by ADR-0058, and left unedited.

## Repository-Level ADRs Created

- openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md - supersedes ADR-0056: keeps its trust rules, and makes an output-driven fact in-memory live state published per terminal instead of a persisted workspace field.
- openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md - a commit yields a change record that travels to clients; unchanged objects keep identity; committed state is read without copying; durable-before-published stays.

## Notes

- Evidence for both: openspec/adr/evidence/workspace-change-fanout-cost.md.
- The index in openspec/adr/README.md lists both and marks 0056 as superseded by 0058.
