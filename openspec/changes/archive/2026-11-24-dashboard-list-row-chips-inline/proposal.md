## Why

In the dashboard's List view on a wide window, a tab whose folder has a pull request shows a stray, clipped box under its row. It reads "Pl" and sits under the status dot. It is the pull request chip, drawn in the wrong place and cut off. So the List view hides the very fact the chip exists to show, and leaves debris in the list.

The panel row's grid defines five columns: status, colour, kind, title and detail. The pull request and checks chips, and the server label, are extra cells. The browser places them on an implicit second grid row inside the 14px status column, and that row overflows the row's fixed 28px height.

## What Changes

- A List view panel row keeps its pull request and checks chips, and its server label, on the row's single line, after the detail. They are never wrapped beneath it.
- The chips are never clipped. When space is short, the agent detail gives way first and the title next, both with an ellipsis.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workspace-dashboard`: the pull request and checks requirement states that on a List row the chips sit on the row's line, and adds a scenario for it.

## Impact

- `src/workspace/workspaceDashboard.css`: `.workspace-dashboard__row--panel` gains two trailing columns; the detail, chips and server label are placed in fixed columns.
- No component, protocol or data change.
