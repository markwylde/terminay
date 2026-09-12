## Context

xterm 6.1 registers a VS Code-derived gesture manager on its screen element.
The manager listens on `document` and, for every touch it dispatches to a
registered target, calls `preventDefault()` on the touchstart. `MouseService`
then turns each gesture change into one of three things, which is the behaviour
in place today and the behaviour to preserve:

1. the program requested wheel reporting → synthesised SGR wheel reports;
2. otherwise the buffer has scrollback → a viewport scroll;
3. otherwise → `ESC[A` / `ESC[B` cursor keys, one per cell travelled.

The prevented touchstart is also why nothing else on a touch device works.
Compatibility mouse events are never produced, so `SelectionService` (bound to
`mousedown` on the `.xterm` element) never starts a selection and `Linkifier`
(bound to `mousemove`/`mouseup` on the screen element) never resolves or
activates a link.

## Goals / Non-Goals

- Goal: add both gestures strictly to touches that do nothing today — a
  stationary hold past one second, and a tap that lands on a link.
- Goal: leave the pan path byte-identical, including in a program in mouse
  tracking mode.
- Non-Goal: native browser text selection. The WebGL renderer draws the buffer
  to a canvas, so there is no DOM text for the platform to select; the
  selection must be xterm's own.
- Non-Goal: any change to Desktop, where a mouse already provides both.

## Decisions

### Drive xterm's own selection with synthesised mouse events

The hold dispatches `mousedown` (with `detail: 2`) on the screen element, then
`mousemove` on its document as the finger travels, then `mouseup` on release —
exactly the sequence `SelectionService` already understands. Reusing it rather
than computing a selection alongside it keeps one notion of what is selected,
so `getSelection`, the selection overlay, the existing copy paths, and drag
autoscroll all work unchanged.

`detail: 2` selects the word under the finger. That makes the hold confirm
itself at the instant it is recognised, which matters because the gesture is
otherwise invisible until the user drags.

A program in mouse tracking mode has `SelectionService` disabled so its own
drags reach the program. The hold is an explicit request for the selection, so
the driver enables the service for the length of the gesture and disables it
again on release. This reaches `_core._selectionService`, the same kind of
narrow internal shim `terminalMouseReportCoords.ts` already uses, and degrades
to "the hold does nothing" if that internal ever moves.

### Suppress panning by swallowing touchmove in the capture phase

While the hold owns the gesture, a `touchmove` listener on the panel root in
the capture phase calls `preventDefault` and `stopPropagation`. Capture always
traverses ancestors, so this stops the event before it reaches the screen
element and before it can bubble back to the gesture manager's document-level
listener. `touchstart` and `touchend` are deliberately left alone so the
manager's own bookkeeping stays consistent; with no moves recorded it computes
no inertia and scrolls nothing.

### Replay the link pair, one frame apart

`Linkifier` activates on `mouseup`, but only for a link a prior `mousemove`
resolved, and resolution is asynchronous. A tap therefore dispatches
`mousemove` immediately and `mouseup` on the next frame. When the tap was not
on a link both events are inert. A tap inside a program in mouse tracking mode
is skipped entirely: a synthesised release would reach the program as a button
report it never saw pressed.

### The toggle is per-device, not a workspace setting

Whether a hold selects text is a property of the device being touched. A phone
and a desktop attached to the same workspace disagree about it by nature, so it
lives in this origin's `localStorage` alongside the other per-device view
state, never travels, and never reaches host settings. It is presented in the
browser menu bar's Edit menu, which is where the touch clients that need it
have a menu at all.

### Browser clients act inside the user activation

`openExternalUrl` and `writeClipboardText` awaited a Desktop bridge before
falling back to the browser. Safari treats a `window.open` or a clipboard write
issued after that await as unrequested and refuses it silently. Both now check
for the bridge first and, finding none, go straight to the browser API with the
activation still live.

## Risks / Trade-offs

- The synthesised-event approach depends on xterm continuing to listen for
  ordinary mouse events, which is how every non-touch platform drives it. A
  version that changed this would silently disable both gestures rather than
  break the pan.
- Lending the selection service back inside a mouse-tracking program is the one
  place this reaches xterm internals. It is guarded so a missing internal is a
  no-op.
- One second is long enough not to fire during a hesitant pan and short enough
  not to feel broken; it is a named constant rather than a literal.
