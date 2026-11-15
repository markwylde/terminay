## Why

On Home, Pull Requests and Issues show the selected item's detail in a side
preview beside the list. The preview is fixed between 300 and 380 pixels. A long
pull request body, a check list with long names, or an issue's comments wrap
into a narrow column the user cannot widen, and on a wide window most of the
space goes to the list. The preview has no edge to drag (issue #541).

## What Changes

- The Home detail preview gets a resize separator on its left edge. Dragging it
  resizes the preview live; releasing sets the chosen width; a cancelled drag
  or a press that does not move changes nothing.
- With the separator focused, Arrow Left widens and Arrow Right narrows the
  preview by 16 pixels.
- The chosen width stays between 280 and 720 pixels, starts at 380, and is drawn
  narrower when the list would otherwise get less than 320 pixels.
- One chosen width is shared by the Pull Requests and Issues sections and is
  remembered on the device, beside the other column widths. It never travels
  through the server.
- When the Home area is narrower than 600 pixels, or the window is 900 pixels
  wide or narrower, the preview stacks under the list and there is no
  separator.

The detail pane's contents and the project Git tab's in-place detail, which
sits in the already resizable folders column, are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pull-requests-and-issues`: new requirements that the Home detail preview is
  resizable by pointer and keyboard, bounded, stacked in a narrow area, and
  remembered on the device. The capability is introduced by the unarchived
  `forge-pull-requests-and-issues` change.
- `server-owned-workspace-state`: the device-local state list names the
  preview width.

## Impact

- Renderer: `src/forge/ForgeHome.tsx` (measured grid width, layout),
  `src/forge/ForgeDetailSeparator.tsx` (new),
  `src/forge/forge.css`, `src/forge/forgeModel.ts` (width bounds),
  `src/workspace/localViewState.ts` (a remembered `forgeDetail` width),
  `src/workspace/useRememberedColumnWidth.ts` (keeps two sections in one window
  in step).
- Tests: `src/forge/forgeModel.test.ts`, `scripts/forge-ui.test.mjs`,
  `scripts/local-view-state.test.mjs`, `e2e/forge-pull-requests-and-issues.spec.ts`.
- No protocol, server, or Electron changes.
