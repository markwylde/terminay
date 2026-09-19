## Context

`FileExplorerTree.tsx` handles entry drags with pointer events. `onPointerDown`
records a pending drag and calls `setPointerCapture`; a window `pointermove`
listener promotes the pending drag to an active drag once the pointer has
moved 6 px, and `pointerup` either drops the entry (opening it as a tab when it
lands on the tab area) or lets the click through. Nothing distinguishes touch
from mouse, and `.file-explorer-tree-item` sets no `touch-action`. On touch the
6 px threshold is reached before the browser's own pan slop, so the drag wins
and the Explorer never scrolls.

`src/hooks/useLongPress.ts` already provides `createLongPressSession`, a
timer-and-movement-threshold state machine used by the compact switcher, the
project switcher, and dock tabs, with an injectable timer for tests.

This change stays inside the renderer. It crosses no preload, IPC, protocol or
server boundary, and does not touch the terminal-session or project/window
boundaries.

## Goals / Non-Goals

**Goals:**

- Touch-and-move within one second scrolls the Explorer.
- Touch-and-hold still for one second, then move, drags the entry.
- Entry actions stay reachable by touch.
- Mouse and pen behaviour is byte-for-byte unchanged.

**Non-Goals:**

- Changing drag behaviour anywhere other than Explorer entries (dock tabs,
  macros, sidebar panes).
- A general touch drag-and-drop framework.
- Haptic feedback.

## Decisions

### Branch on `pointerType === 'touch'` at pointer-down

Mouse and pen keep the existing pending-drag path unchanged. A touch press
instead starts a hold, and never calls `setPointerCapture` or enters the
pending-drag path until the hold arms. Without capture, and with the default
`touch-action`, the browser is free to start a pan; when it does, it fires
`pointercancel`, which ends the hold.

*Alternative:* one code path with a larger threshold for touch. Rejected — any
distance threshold still races the browser's pan, and it cannot express "held
still for a second".

### Reuse `createLongPressSession` with a one-second delay

The hold uses `createLongPressSession({ delayMs: 1000, moveThresholdPx:
LONG_PRESS_MOVE_THRESHOLD_PX })`. Its movement threshold cancels the hold when
the finger drifts, its timer fires the arm, and its injectable timer keeps the
logic unit-testable. The one-second value is a named constant in the Explorer
(`FILE_EXPLORER_TOUCH_DRAG_HOLD_MS`), not a change to the shared 500 ms
default that other long-press surfaces rely on.

*Alternative:* a bespoke timer in the component. Rejected — it duplicates a
tested state machine.

### Arm, then block the pan with a non-passive `touchmove` listener

`touch-action` is read when a gesture begins and cannot be changed mid-gesture,
so it cannot turn scrolling off after a hold. When the hold fires, the entry is
armed: it gets `file-explorer-tree-item--drag-armed`, and the pending drag is
recorded from the touch's start position. A `touchmove` listener registered on
the entry with `{ passive: false }` calls `preventDefault()` only while that
entry is armed, which stops the browser from starting a pan after the arm. The
existing window `pointermove`/`pointerup` handlers then drive the drag and the
drop unchanged; the existing 6 px threshold from the touch start separates
"moved, so drag" from "released in place, so open the menu".

*Alternative:* `touch-action: none` on entries. Rejected — it disables
scrolling on the very rows the user touches to scroll.

### Touch release after an arm opens the context menu; native menu suppressed

Chromium fires a `contextmenu` event on a touch long-press at about half a
second, which would open the Explorer menu before the one-second arm and cover
the drag. While a touch press is pending or armed, the entry's `onContextMenu`
is suppressed (the same rule `useLongPress` applies). An armed touch released
without moving opens the Explorer context menu at the release point, and the
following click is swallowed so the entry is not also opened. Chromium on Linux
and Windows follows a long touch release with a synthetic right-button
`mousedown` and `contextmenu`; the entry stops that `mousedown` from reaching
the window so it does not close the menu the release just opened.

*Alternative:* let the native `contextmenu` stand as the touch menu. Rejected —
it fires at the platform's delay, races the arm, and does not fire at all in
some mobile browsers used by remote web clients.

## Risks / Trade-offs

- [iOS Safari may begin a pan in the first `touchmove` before the non-passive
  listener runs] → the listener is attached before any touch starts, and it
  only needs to act after the hold, by which time no pan has begun because the
  finger was still.
- [A one-second hold is slower than a mouse drag] → intended; it is the price of
  scroll working, and matches what the user asked for.
- [A user drifting a few pixels during the hold cancels the arm] → the shared
  8 px threshold is the same tolerance every other long-press surface uses.
- [E2E touch simulation differs from real devices] → the hold/arm/cancel logic
  is unit-tested with an injected timer; E2E covers the wiring with CDP touch
  input.

## Migration Plan

Renderer-only; ships with the next build. Rollback is a revert of the change.

## Open Questions

None. No in-force ADR is affected.
