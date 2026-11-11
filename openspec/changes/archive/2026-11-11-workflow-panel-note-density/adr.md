# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude (Opus 5.5)
- Change: workflow-panel-note-density

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - workflow state lives on the server and Terminay never runs a step. The note density only presents that state and changes none of it.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - precedent for device-local view state that never reaches the server.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The setting follows the precedent of the panel's device-local collapse and width settings in the terminal-workflows spec.
