## Why

On a phone, or any pane too narrow for the expanded workflow panel, tapping the
rail opens the workflow as an overlay, but the collapsed rail's step markers
stay painted on top of it. They cover each step's time and part of its text,
so the overlay reads as two panels stacked on each other. This happens whether
or not the device has control of the terminal.

The cause is technical: the overlay renders inside the rail's panel, next to
the rail, and the rail's markers sit on their own stacking layer
(`z-index: 1`), so they paint over the overlay.

## What Changes

- While the narrow-pane overlay is open, the collapsed rail is hidden. Only the
  overlay shows. The rail comes back when the overlay closes.
- The overlay is stacked above anything else in the panel, so no rail content
  can paint over it again.
- The pane keeps reserving the rail's strip while the overlay is open, so the
  terminal does not resize.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: the "Narrow panes keep the terminal usable"
  requirement now says the rail is hidden while the overlay is open.

## Impact

- `src/workspace/workflows/WorkflowPanel.tsx`: do not render the rail while the
  overlay is open.
- `src/workspace/workflows/WorkflowPanel.css`: give the overlay a stacking
  order above the panel's contents.
- `e2e/workflows-narrow.spec.ts`: assert that the rail is gone while the
  overlay is open and comes back when it closes.
- No API, protocol, server, or setting changes. The same renderer serves the
  desktop app and remote/mobile clients, so the fix covers both.
