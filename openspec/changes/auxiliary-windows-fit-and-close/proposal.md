## Why

On a Mac with a low screen resolution, Settings could not be closed. It opens at a fixed 1180×820, taller than a small display, so its title bar and close button land above the screen. Settings is a child of the project window; when that window is full screen, Window ▸ Zoom and Fill do nothing for it, and leaving full screen leaves it too tall to drag or resize. ⌘W did not help: it is the Close Terminal shortcut, and Settings has no terminal, so the command was sent to it and ignored.

## What Changes

- Desktop auxiliary windows (Settings, Remote Control, Recordings, Performance Log) open no larger than the work area of the display their project window is on, centred there. Displays with room keep the 1180×820 size.
- The close-terminal command (⌘W / Ctrl+W, and Terminal ▸ Close Terminal) closes a focused auxiliary window. Unsaved macro edits still ask first.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: auxiliary windows fit their display and close with the close shortcut.

## Impact

- `electron/auxiliaryWindowPlacement.ts` (new pure helpers), `electron/main.ts` (window creation and command routing).
- No protocol, renderer, or persistence change.
