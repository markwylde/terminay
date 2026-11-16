# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (Opus 5.5)
- Change: terminal-overlays-clear-workflow-panel

## In-Force ADR Context Reviewed

- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - workflow ownership and execution; unaffected. Pane geometry comes from the terminal-workflows layout requirements, not this ADR.
- openspec/adr/0128-workflow-steps-form-a-dependency-graph-and-the-plans-shape-is-derived.md - step dependencies and derived shape; unaffected.
- openspec/adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md - app-window records; unaffected. The rail's existing `--app-window-rail` variable is reused, not changed.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The insets are renderer layout, published as CSS custom properties from values `TerminalPanel` already computes. The E2E seam crosses preload/main for tests only (gated by `TERMINAY_TEST`, bound-window checked, argument validated, one session), follows the existing `terminayLocalConnectionFaultTest` pattern, and is inert in production.
