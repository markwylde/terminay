## Context

`WorkspaceSplitLayout` owns the sidebar width separator. On pointer-down it
captures the pointer on the 6px `<hr>` handle and installs window-level
`pointermove` / `pointerup` / `pointercancel` / `blur` listeners. The handle is
positioned at `left: var(--workspace-navigation-width)`, so it travels with the
live preview and a fast pointer leaves its 6px box; Chromium then fires
`lostpointercapture` while the button is still held. The component binds
`onLostPointerCapture` to its cancel path, which drops the drag session, removes
the window listeners, and restores the canonical width — so the remaining
movement is inert and the release commits nothing.

The vertical pane stack (`SidebarPanelStack`) already resolved the same failure:
it deliberately does not cancel on `lostpointercapture` and lets the window
`pointerup` commit the preview. The width separator is the only sidebar
interaction still missing that treatment, and the capability spec's pointer
gesture requirement was written with only the pane separators in view.

No in-force ADR governs renderer pointer interaction; nothing here crosses a
privileged, protocol, or persistence boundary.

## Goals / Non-Goals

**Goals:**

- A width drag that loses pointer capture mid-gesture keeps tracking the pointer
  and commits the released width exactly once.
- Both sidebar resize interactions handle capture loss the same way.
- The failure is covered by an end-to-end test driving a real pointer release.

**Non-Goals:**

- Changing the preview/commit boundary, the optimistic overlay, or the canonical
  reconciliation that follows a committed width.
- Changing which signals abort a gesture.
- Reworking the separator's geometry or hit target.

## Decisions

**Window listeners, not pointer capture, own the gesture.** The drag session is
already keyed by `pointerId` and driven by window listeners, so capture is only
an acquisition convenience. Removing the `onLostPointerCapture` cancel binding
leaves the session live and lets the existing window `pointerup` path commit.
The alternative — re-acquiring capture on loss — was rejected: it fights the
browser every frame the handle moves out from under the cursor, and the pane
stack has already proven the simpler shape in production.

**Abort signals stay exactly as specified.** `pointercancel`, window blur, and
unmount continue to cancel the width drag and restore the pre-drag width. Only
capture loss changes meaning. Treating blur as a commit was considered and
rejected: the capability spec makes blur an abort, and blur was not observed in
the traced failure.

**Coverage is an end-to-end pointer test.** Capture loss is a browser behaviour,
so the regression is only meaningful when a real pointer press, move, and
release drive it. The test releases the capture mid-gesture — the same signal
Chromium delivers — then asserts the released width both renders and reaches the
canonical width owner. A unit test over the handlers would assert the code's own
assumptions rather than the browser's.

## Risks / Trade-offs

- [A gesture could outlive a pointer that never reports `pointerup` — for
  example a device removed mid-drag] → `pointercancel` and unmount still tear the
  session down, and the pane stack has run this shape without a stuck-drag
  report.
- [The real-world trigger is timing-dependent, so an end-to-end test that only
  drags quickly would be flaky] → The regression test injects the capture loss
  directly and is deterministic; the timing-dependent form is not the gate.
