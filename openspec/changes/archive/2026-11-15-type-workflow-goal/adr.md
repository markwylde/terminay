# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-15
- Reviewer: Mark Wylde
- Change: type-workflow-goal

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md -
  launch and resume remain the only writes a workflow causes, built
  server-side from fixed words; they are now typed rather than pasted.
- openspec/adr/0011-security-trust-boundary-model.md - the write keeps its
  session authorisation, `write` scope and `workflow` input source; only the
  grouping of the bytes changes.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries. The measurements behind the chunk
size and pause are in `openspec/adr/evidence/workflow-goal-typing/`.
