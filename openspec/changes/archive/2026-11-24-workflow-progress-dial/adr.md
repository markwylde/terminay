# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-06
- Reviewer: Claude (Opus 5.5)
- Change: workflow-progress-dial

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - workflow state lives on the server and is pushed to clients; the dial only presents it.
- openspec/adr/0098-project-reach-may-curate-workflow-templates-behind-an-asking-group.md - templates only; unaffected.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The device-local "seen" record follows the precedent of the device-local panel-collapse setting in the terminal-workflows spec.
