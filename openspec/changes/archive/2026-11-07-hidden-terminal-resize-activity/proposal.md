## Why

On a phone, a terminal sitting idle at a shell prompt in another project flashes working, then finished, and raises a finished notification, though nobody touched it. Every time the viewport changes size, every mounted terminal in the window refits and resizes its PTY, including ones in background projects. The shell redraws its prompt for the new size, and the server reads that redraw as raw-output work.

## What Changes

- A terminal that is not on screen (its project or folder workspace is in the background) does not fit itself or submit a PTY resize. It does that once, when it comes on screen.
- PTY output that arrives within one second of a resize the server applied is not raw-output activity: it neither begins nor extends `working` and clears no acknowledgement, just as output following user input does. Structured, foreground-process, and provider evidence is unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: adds the rule that output following a PTY resize is not raw-output activity.
- `terminal-workspace`: adds the rule that a terminal off screen does not resize its PTY until it is shown.

## Impact

- `packages/server-core/src/activity/` (reducer, types): a `resize` signal and a resize window in the raw-output tier.
- `packages/server-core/src/terminalService/service.ts` and `composition.ts`: the terminal service reports each applied resize, and composition binds it to activity.
- `src/components/TerminalPanel.tsx` and `src/App.tsx`: workspace visibility reaches the terminal panel; a hidden panel defers fit and resize.
- Tests: reducer unit tests and `e2e/compact-switcher-idle-activity.spec.ts`.
