## Why

Mobile users cannot activate TUI controls such as Scroll to bottom although desktop mouse clicks work. xterm consumes touch gestures without producing button presses, and the existing tap bridge handles only links and focus.

## What Changes

- Forward stationary, non-link taps to xterm as one primary mouse press and release when the foreground program enables mouse reporting.
- Preserve touch panning, link menus, hold selection, cancellation, and plain-terminal focus.
- Reproduce and guard the behavior with a mock TUI under real Chromium touch input and focused interaction tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: permit a narrowly scoped touch tap bridge for mouse-reporting TUIs.

## Impact

Shared TerminalPanel touch handling and interaction helpers; no server protocol or privileged host changes, dependencies, or persistence changes.
