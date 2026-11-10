# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-10
- Reviewer: Mark Wylde
- Change: agent-safe-terminal-submit

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - named keys are a fixed
  set of ordinary key presses written through the existing write path; no new
  capability.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md -
  `write_terminal` and `run_command` keep their reach rules and permission
  groups; only the grouping of the bytes they write changes.
- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md -
  launch and resume still type one paste and submit it once; Terminay still
  runs no step.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

A defect fix inside existing boundaries: every host keeps its write path and
only the order and grouping of writes changes.
