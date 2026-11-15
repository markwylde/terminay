## Context

`ForgeHomeSection` lays the list and the selected item's `ForgeDetailPane` out
in a two-column grid whose detail column is `minmax(300px, 380px)`. Below a
900-pixel viewport the grid stacks the two. The workspace already has two
resize idioms to follow: the device-remembered column widths in
`localViewState.ts` (`useRememberedColumnWidth`) and the workflow panel's
separator (`WorkflowPanelSeparator`), which previews live, commits once on
release, ignores a press that does not move, and takes Arrow keys.

Another change (#540) is adding "Open in tab" to `ForgeDetailPane` and new
row interactions to the list, so this change stays out of `ForgeViews.tsx`.

## Goals / Non-Goals

**Goals:** a draggable, keyboard-operable left edge on the Home detail preview;
one width remembered on the device for both sections; the list never squeezed
below a usable width.

**Non-Goals:** resizing the project Git tab's in-place detail (it lives in the
folders column, which is already resizable); changing what the pane shows;
a server-side or synced width.

## Decisions

1. **The separator lives in `ForgeHome`, not in the pane.** The grid gets
   `position: relative` and an absolutely positioned separator at
   `right: <drawn width>`. `ForgeDetailPane` is untouched, which keeps this
   change clear of #540.
2. **Width store.** Add `forgeDetail` to the device column-width store
   (`terminay.view.column-widths.v1`, default 380). It reuses parsing,
   rounding and cross-window following. The store's generic bounds (30–2000)
   still guard the stored value; the preview's own bounds are applied when
   drawing.
3. **Same-window sync.** Both Home sections can be mounted at once, and the
   `storage` event only reaches other windows. `useRememberedColumnWidth` keeps
   a per-column set of subscribers in the module and tells the others on
   commit. This is harmless for the folders, sidebar and Home columns, which
   have one reader per window.
4. **Bounds as a pure function.** `forgeDetailWidthBounds(gridWidth)` in
   `forgeModel.ts` returns `{ min: 280, max: clamp(gridWidth − 320, 280, 720) }`,
   and `drawnForgeDetailWidth(chosen, gridWidth)` clamps into it. The grid is
   measured with a `ResizeObserver`; until measured the chosen width is drawn
   within the static bounds.
5. **Stacking by container width.** The viewport-only 900-pixel breakpoint
   cannot protect the list when Home tabs sit side by side in a wide window.
   `forgeDetailLayout(gridWidth)` returns `stacked` when the measured grid is
   narrower than 600 pixels (list minimum plus preview minimum), and
   `ForgeHome` adds a stacked class and renders no separator. The viewport
   rule stays as well, so nothing that stacks today stops stacking.
6. **Chosen versus drawn width.** The remembered value is the chosen width;
   every commit (drag or key) is clamped to 280–720 first. Drawing reduces it
   for the list and never writes back, so it returns when room returns. A
   hand-edited or older stored value within the store's generic 30–2000 range
   is drawn within 280–720.
7. **Gesture.** Follow the workflow separator's rules: drag from the drawn
   width, live preview in local state, commit once on `pointerup` only if the
   pointer moved, nothing on `pointercancel`, blur or unmount; keys commit
   immediately by 16 pixels from the drawn width.
8. **Testability.** The separator is its own component
   (`ForgeDetailSeparator.tsx`) so its markup can be rendered statically; the
   layout and bounds are pure functions in `forgeModel.ts`; gestures, keys,
   stacking and sharing are covered end to end in Electron, where pointer
   events and layout are real.

## Alternatives considered

- **Drag handle inside `ForgeDetailPane`.** Rejected: it would touch the file
  #540 is changing and couple the pane to Home's grid.
- **A separate `localStorage` key under the forge view preferences.** Rejected:
  the column-width store already gives rounding, validation and cross-window
  following, and the device-local state contract already lists widths there.
- **CSS-only bounds (`min()` in the grid track).** Rejected: the separator's
  `aria-valuenow` and drag origin need the drawn width in script.

## Boundaries

Renderer-only presentation state. Nothing crosses the renderer/privileged
boundary or the project/window boundary; the width is device-local and never
sent to the server, matching the other column widths.

## Dependencies

- The `pull-requests-and-issues` capability is introduced by the unarchived
  `forge-pull-requests-and-issues` change, whose code is already on `main`.
  This change only ADDs requirements to it, none overlapping that change's
  names, so archiving this one first creates the capability with these
  requirements and the forge change's archive adds its own beside them. Its
  "Item detail pane" requirement says the pane is beside the list; the
  stacking requirement here narrows that for small areas, as the shipped
  900-pixel rule already did.
- `server-owned-workspace-state` "Client-owned device-local state" is
  MODIFIED here; `one-window-one-server` and `linked-folders` also modify it,
  and whichever archives later re-bases on the main text.

## Risks / Trade-offs

- A separator over the grid could take clicks meant for the list's scrollbar;
  it is 6 pixels wide and centred on the pane's border, as the workflow
  separator is.
