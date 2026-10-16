## Context

`.project-tab--active::before` extends 2px below the project bar with square bottom corners so it meets the panel tab strip. The start chooser (`ProjectStartChooser`) replaces the whole workspace, including that strip, while a project awaits its start choice.

## Goals / Non-Goals

**Goals:**
- The active tab is a closed shape whenever nothing sits below it to join.

**Non-Goals:**
- Changing the home view or inactive tab styling.

## Decisions

**Key the shape off the DOM with `:has()`.** `.app-shell:has(.project-start.project-workspace--active) .project-tab--active::before` restores the inset, fully rounded geometry. The chooser already marks itself active, so no new state or prop is threaded through `ProjectTabList`. Alternative: pass an "awaiting start" flag into the tab list — more plumbing for a purely presentational difference. Electron's Chromium supports `:has()`, and the stylesheet already uses it.

## Risks / Trade-offs

- [The selector depends on the chooser's class names] → the E2E case asserts both shapes, so a rename fails the test.

## Migration Plan

None.

## Open Questions

None.
