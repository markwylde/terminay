## Why

At phone width the workspace has no Notifications control. The header that
carries the bell on a wide window is replaced by a single compact row, and
that row was built before notifications had a list. A phone user can see a
red or green indicator beside a terminal in the switcher and nothing else:
no count, no list, no way to clear, and no sign at all of a notification a
process sent, which has no terminal indicator.

## What Changes

- The compact chrome row gains a Notifications control with the same count
  as the wide header's.
- Pressing it opens a sheet from the bottom edge, presented as the terminal
  switcher is, listing the same notifications as the wide list.
- Each row goes to its terminal or is dismissed, and the sheet offers Clear
  all.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: the compact row holds a Notifications
  control.
- `terminal-activity-signals`: how notifications are listed and cleared on a
  compact workspace.

## Impact

- `src/workspace/CompactChromeRow.tsx` — the control.
- `src/workspace/TerminalActivityOverview.tsx` — the sheet, sharing the wide
  list's rows.
- `src/App.tsx`, `src/App.css` — wiring and styles.
- `e2e/compact-notifications.spec.ts`; the helper that sends a notification
  moves to `e2e/support/notifications.ts`.
