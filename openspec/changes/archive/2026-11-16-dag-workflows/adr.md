# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: dag-workflows

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - decisions 1–3 (server-owned record, agent reports by id, Terminay never runs a step) carry forward; decision 4 (flat lists) is superseded.
- openspec/adr/0098-project-reach-may-curate-workflow-templates-behind-an-asking-group.md - template tools gain `after`; reach and approval rules unchanged.
- openspec/adr/0126-status-colours-have-one-source.md - bracket, capsule and metro edge colours use the shared status palette.
- openspec/adr/0125-compact-drawers-and-sheets-are-navigation-surfaces.md - the workflow drawer is a pane region, not a compact navigation drawer; not affected.

## Repository-Level ADRs Created

- openspec/adr/0127-workflow-steps-form-a-dependency-graph-and-the-plans-shape-is-derived.md - steps declare `after`, several may be active, and brackets/lanes are derived from dependencies; supersedes ADR-0097 decision 4.

## Notes

The layout and per-layout collapse settings are device-local, following the existing panel collapse/width/notes precedent; no ADR needed.
