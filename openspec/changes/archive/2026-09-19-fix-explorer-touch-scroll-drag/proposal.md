## Why

On a phone or tablet, touching the Explorer sidebar to scroll it picks up the
file under your finger and starts dragging it toward the tab area. You cannot
scroll a long file tree by touch at all. The cause is that an Explorer entry
treats every pointer the same way: any movement past 6 px after a press starts
an entry drag, and that threshold is smaller than the distance the browser
needs before it commits to a scroll.

## What Changes

- A touch press on an Explorer entry no longer starts a drag when the finger
  moves. Moving within the first second scrolls the Explorer as normal.
- Holding a touch still on an entry for one second arms a drag. The entry shows
  that it is armed, and moving the finger after that drags it exactly as a
  mouse drag does, including dropping it on the tab area to open it.
- Releasing an armed touch without moving opens the entry's context menu at
  the touch point, so rename, delete, copy path and the other entry actions
  stay reachable by touch. The browser's own touch long-press menu is
  suppressed on Explorer entries so it cannot open early and race the drag.
- A quick tap still selects, toggles or opens the entry as it does today.
- Mouse and pen input are unchanged: press and move still drags immediately.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-explorer-and-folder-tabs`: the "Explorer entry actions and project root
  selection" requirement gains the touch rule — a touch scrolls unless it has
  been held still for one second, after which it drags the entry — and the
  touch route to entry actions.

## Impact

- `src/workspace/FileExplorerTree.tsx` — the per-entry pointer handlers and the
  window-level drag listeners.
- `src/hooks/useLongPress.ts` — `createLongPressSession` is reused for the
  one-second hold timer; its API may gain nothing or a small option.
- `src/App.css` — an armed-entry style.
- Unit tests beside the new touch-drag logic, and an Electron E2E spec that
  drives touch pointer input on the Explorer.
- Renderer-only. No preload, IPC, protocol or server change.
