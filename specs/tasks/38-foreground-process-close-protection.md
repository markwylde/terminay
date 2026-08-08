# Foreground-process close protection

## Goal

Protect live terminal work without interrupting closure of idle shells.

Governing specifications:

- [Terminal activity signals](../features/terminal-activity-signals.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Settings, shortcuts, and desktop integration](../features/settings-shortcuts-and-desktop-integration.md)

## Current gap

The server observes foreground-process transitions, but its canonical activity
snapshot does not preserve that fact independently from presentation activity.
Terminal, project, and application close paths therefore cannot consistently
distinguish an idle shell prompt from a running foreground process.

## Implementation slices

- [x] Publish validated `foregroundBusy` state in activity snapshots and events.
- [x] Add a bounded Desktop close-confirmation capability with context-specific
      destructive button labels and **Keep Running** as default/cancel.
- [x] Guard direct terminal close actions only when that terminal is busy.
- [x] Guard project close actions when any contained terminal is busy, without
      treating cross-view moves as closure.
- [x] Publish each Desktop window's bounded busy-session set to Electron so a
      native app/window close can guard work across projects and windows.
- [x] Scope native-window close confirmation and confirmed closure to the
      target project window; reserve application quit for the final project
      window or an explicit Quit command.
- [x] Regress a busy torn-off project window closing while its sibling remains
      alive and usable.
- [ ] Cover idle, busy, cancel, confirm, aggregation, and explicit-quit bypass
      behaviour with focused and Docker-isolated Electron tests.

## Acceptance checks

- An idle terminal, idle project, and fully idle app close immediately.
- Busy close dialogs use **Close Terminal**, **Close Project**, or
  **Quit Terminay** and always default/cancel to **Keep Running**.
- One busy terminal is sufficient to protect its project and the application;
  counts cover multiple terminals without double-counting a session.
- Provider state, recent output, and activity indicator settings cannot create
  or suppress a close warning.
- Moving tabs/projects does not display a close warning or terminate a PTY.
- Confirming closure of a non-final project window closes only that window;
  sibling windows remain alive, and only the last project window quits Terminay.
- Confirmed operations retain existing server-owned termination and graceful
  shutdown semantics.

## Definition of done

The specifications, protocol projections, Desktop bridge, renderer close paths,
and regression tests all implement the acceptance checks, and the required
Electron suite passes through `npm run test:e2e`.
