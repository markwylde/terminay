## Why

The expanded workflow panel at the right of a terminal pane is fixed at 264px. Long step titles, notes and opening prompts wrap into narrow columns, and on a wide screen there is no way to give the workflow more room. On a smaller screen there is no way to give the terminal more room without collapsing the panel completely. The project sidebar and Folders column beside it can already be dragged to any width, so the workflow panel is the odd one out (issue #538).

## What Changes

- The expanded workflow panel gets a resize separator on its left edge. Dragging it resizes the panel live, with the terminal refitting so the panel never covers it; focusing it and pressing Arrow Left or Arrow Right steps the width by 16px.
- The width is bounded: at least 200px, at most 640px. The default stays 264px.
- The chosen width is one device-local choice, kept and shared exactly as the collapse setting is. Resizing the panel in one pane resizes every workflow panel that reads the same setting. It is never stored on the server or in a template.
- A pane that cannot fit the chosen width beside a 60-column terminal draws the panel narrower, down to the minimum width, before it falls back to the collapsed rail. The narrow-pane overlay opens at the chosen width or 85% of the pane, whichever is less.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: a new requirement for the panel's resizable, device-local width; "Narrow panes keep the terminal usable" now measures fit against the chosen width and lets the panel shrink to its minimum before forcing the rail.

## Impact

- Renderer only: `src/workspace/workflows/workflowPanelSetting.ts` (remembered width store), `src/workspace/workflows/workflowPanelModel.ts` (width bounds; the mode and reserved width take the width), `src/workspace/workflows/WorkflowPanel.tsx` and `WorkflowPanel.css` (separator, width from a CSS variable), `src/components/TerminalPanel.tsx` (reserved padding and geometry use the effective width).
- Tests: unit cases for the model and the width store, and an E2E case for the panel.
- No server, protocol, MCP or settings-schema change.
