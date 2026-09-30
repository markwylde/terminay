## Why

Desktop Zoom In, Zoom Out, and Reset Zoom (cmd +, cmd −, cmd 0) resize terminal text, but a Documentation tab ignores them. Someone who zooms to read more comfortably gets bigger terminals and unchanged documents.

## What Changes

- The Documentation editor follows the desktop zoom level: rich text, source mode, and diff mode text scale with it, and the reading column widens in proportion.
- Terminal zoom scope is restated so zoom changes terminal and Documentation text, and still never zooms the surrounding chrome.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `documentation-sidebar-and-editor`: the reading canvas follows desktop zoom.
- `terminal-workspace`: desktop zoom reaches Documentation text as well as terminals.

## Impact

- `src/components/file-viewer/DocumentationEditor.tsx` and `fileViewer.css`: subscribe to `terminal.zoom` and scale the canvas.
- `src/components/terminalZoomInteraction.ts`: a zoom-scale helper beside the terminal font-size policy.
- No protocol, host-event, security-boundary or packaging changes; the existing replayed `terminal.zoom` event is reused.
