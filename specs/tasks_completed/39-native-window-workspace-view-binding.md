# Task 39 — Native-window workspace-view binding

## Goal

Make project-tab tear-off use canonical server-owned workspace views so a new
native window contains the moved project, preserves all project/panel/session
identities, and does not hydrate unrelated projects.

Governing features:

- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Current gap

The Desktop compatibility transfer path copies renderer presentation state into
the destination, assigns the copy a synthetic project id, and then invokes the
ordinary project-close path in the source. Both renderers also flatten every
server workspace view into their tab bars. A torn-off project can therefore
appear beside unrelated projects, lose its canonical scope, or lose its live
terminal presentation after reconciliation.

## Implementation slices

- [x] Add an end-to-end regression that performs the real pointer-driven
  project tear-off and waits for server reconciliation.
- [x] Specify one canonical workspace-view binding per native project-host
  window and identity-preserving cross-view movement.
- [x] Carry the bound canonical view id through Desktop window creation and the
  preload boundary without exposing generic workspace authority.
- [x] Render only the bound view's ordered projects in each native window.
- [x] Create a destination view and commit `project.move` for a tear-off while
  preserving the project, panel, and terminal session ids.
- [x] Remove renderer-local project copying, synthetic project ids, and the
  post-transfer `project.close` call from the canonical path.
- [x] Preserve rollback/failure behaviour: a failed destination creation or
  move leaves the source project usable and does not strand an empty view.
- [x] Activate the ready destination window so its first terminal-control click
  is not consumed by macOS window activation.
- [x] Verify tear-off, cross-window merge, terminal continuity, refresh
  convergence, and existing project-tab workflows through Docker E2E.

## Acceptance checks

- [x] The source native window contains only the source view's remaining
  projects after tear-off.
- [x] The destination native window contains only the moved project's view and
  never momentarily commits an unrelated project as destination state.
- [x] The moved project retains its canonical project id, panel ids, terminal
  session ids, and active panel.
- [x] Moving is not reported or executed as project closure and never prompts a
  foreground-process close warning.
- [x] Refreshing either renderer reproduces the same project/view split from the
  server snapshot.
- [x] The first terminal-tab `+` click in the destination creates the next
  terminal without requiring a second click.
- [x] A failed move leaves the project in its original view and closes or cleans
  up any unusable destination window/view.

## Definition of done

All implementation and acceptance items are checked, focused and full relevant
Docker E2E suites pass, and this task is moved to `tasks_completed/`.
