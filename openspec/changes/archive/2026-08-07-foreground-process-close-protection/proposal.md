## Why

Closing a terminal, a project, or the application could terminate a running
command without warning. The server already observed foreground-process
transitions, but its canonical activity snapshot did not preserve that fact
independently of presentation-oriented activity, so close paths could not tell
an idle shell prompt apart from a running foreground process.

## What Changes

- Publish a validated `foregroundBusy` state in activity snapshots and events,
  independent of provider authority, completion signals, acknowledgement, output
  timers, and activity-indicator settings.
- Add a bounded Desktop close-confirmation capability with context-specific
  destructive button labels and **Keep Running** as both default and cancel.
- Guard a direct terminal close only when that terminal is busy.
- Guard a project close when any contained terminal is busy, without treating a
  cross-view move as a closure.
- Publish each Desktop window's bounded busy-session set to Electron so a native
  application or window close can guard work across projects and windows.
- Scope native-window close confirmation and confirmed closure to the target
  project window; reserve application quit for the final project window or an
  explicit Quit command.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `terminal-activity-signals`: the canonical snapshot exposes `foregroundBusy`
  as a distinct, unsuppressible signal.
- `workspace-and-project-tabs`: terminal, project, and window close paths guard
  busy work.

## Impact

The server activity projection and its protocol events, the Desktop host bridge
and native window close path, and the renderer's terminal, project, and window
close actions. Idle closes are unchanged.
