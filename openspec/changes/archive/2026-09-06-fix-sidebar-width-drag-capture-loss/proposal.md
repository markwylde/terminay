## Why

Dragging the sidebar width boundary and releasing it often leaves the sidebar at
the width the gesture started from. The sidebar follows the pointer for part of
the drag, then jumps back, and the width the user chose is never saved. It is
most reproducible on a quick drag, which is how the boundary is normally moved.

The width separator is a 6px handle whose position follows the live preview, so
a fast pointer outruns it and Chromium drops the implicit pointer capture
mid-gesture. `WorkspaceSplitLayout` treats that capture loss as a cancellation:
it abandons the still-live gesture, restores the pre-drag width, and releases
nothing to the canonical width owner. The vertical pane separators already
handle this correctly; the sidebar width separator does not.

## What Changes

- The sidebar width separator keeps a drag alive when pointer capture is lost
  while the button is still held, and its release commits the width the user
  dragged to.
- Genuine abort signals continue to cancel the width drag and restore the
  pre-drag width, unchanged.
- End-to-end coverage exercises a width drag whose pointer capture is lost
  mid-gesture, through a real pointer release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-sidebar-layout`: Pointer gesture handling states capture-loss
  tolerance for pane separators only. It is extended so the same contract binds
  the sidebar width separator, whose handle also moves with its preview.

## Impact

- `src/shared/WorkspaceSplitLayout.tsx` — the width separator's capture-loss
  handling.
- `e2e/` — end-to-end coverage for a width drag that loses pointer capture.
- No workspace protocol, persistence, or privileged-boundary change: the commit
  path and the single project-scoped sidebar command are untouched.
