## Context

A project tab drag is run by two parties. The renderer
(`useProjectTabTransfer`) owns the in-strip drag; once the pointer is 40px off
the strip it asks the Desktop host to start a native drag session
(`workspace.drag.start`) and, on release, asks how it ended
(`workspace.drag.end` → reorder / merge / popout). The host
(`electron/main.ts`) polls the OS cursor during the session, shows a ghost
window once the cursor is 100px from the source bar, and pushes
`workspace.drag-state { active }` to the source window so it can collapse the
dragged tab (`.project-tab--torn-off`: zero width, transparent).

Measured with an end-to-end reproduction and logging in both processes:

| Drag | Tab class at drag start | Preview width sent | Host result |
| --- | --- | --- | --- |
| 1st, out of window A | `project-tab--dragging` | 121 | popout |
| 2nd, back into A from the new window | `project-tab--dragging` | 120 | merge |
| 3rd, out of A again | `project-tab--dragging project-tab--torn-off` | 0 | `workspace drag preview is invalid`, then reorder |

`setProjectTabTornOff(true)` sends `active: true`. `endCanonicalProjectDrag`
then assigns `projectDragTornOff = false` directly, so `active: false` is never
sent on release; it is sent only if the cursor re-enters the source bar
mid-drag. Window A's `isDraggingTabTornOff` therefore stays `true`. On its next
drag the tab is collapsed the moment it becomes the dragged tab, its
`getBoundingClientRect().width` is 0, the host action validator rejects widths
outside 80–2000, and the rejection is lost because the call is `void`ed. With
no session, `workspace.drag.end` answers `reorder`.

The drag back in is not needed to trigger it: a second tear-off from the same
window fails the same way. The existing tear-off test never noticed because it
tears off once.

Calling `setProjectTabTornOff(false)` at the top of `endCanonicalProjectDrag`
was tried as an experiment: the third drag then measured 121px and both
reproduction tests, plus the existing tear-off test, passed.

## Goals / Non-Goals

**Goals:**

- A window that has been the source of a tear-off can tear off again,
  indefinitely.
- The failure cannot recur from one lost message: neither party depends on the
  other to clear its state.
- A refused drag start is visible in diagnostics.
- The scenario is covered by a test that controls the cursor position.
- A project dropped on another window's bar lands where it was dropped, is
  active there, and that window has focus; the destination previews the
  landing position while the tab is held over it.

**Non-Goals:**

- Changing how the tear-off decision is made (cursor polling, distances, hit
  testing), or the action/event shapes.
- Dragging a window's only tab moves the whole window, as Chrome does. The
  source window stays put with its tab collapsed.
- Cross-window drag for web clients.

## Decisions

**1. The host announces the end of every drag session.** Session teardown is
funnelled through one routine used by both `endCanonicalProjectDrag` and
`stopProjectDragTracking`; it calls `setProjectTabTornOff(false)` while the
source id is still known, then clears the timer, ghost, source, and preview.
The host is the party that declared the tab torn off, so it is the party that
must retract it. *Alternative:* fix only the renderer. Rejected — the host would
still hold a contract it does not keep, and any other consumer of
`workspace.drag-state` would inherit the bug.

**2. The renderer scopes torn-off state to one drag.** It clears
`isDraggingTabTornOff` at drag start and at drag end, independent of host
events. A window whose host announcement is lost (the source window is busy,
the event races the release) still recovers on its own. *Alternative:* rely on
decision 1 alone. Rejected — that is exactly the single point of failure that
produced this bug; the two fixes are cheap and independent.

**3. The preview width is clamped into the host's accepted range.** The
renderer sends the tab's laid-out width clamped to 80–2000. A bar that lays a
tab out narrower than 80px fails the same validator for a reason unrelated to
the stale flag. *Alternative:* relax the host validator. Rejected — the
validator sits on the renderer→host privilege boundary and sizes a
`BrowserWindow`; it stays strict and the caller conforms.

**4. A refused drag start is logged and leaves an in-strip drag.** The
`void beginWorkspaceDrag(...)` gains a rejection handler that records the
failure and resets `nativeDragStartedRef`, so the release takes the plain
reorder path without a `workspace.drag.end` round trip.

**5. The test states the cursor position.** The tear-off decision reads
`screen.getCursorScreenPoint()` in the main process; Playwright's page mouse
does not move the OS cursor. The spec replaces that function through
`electronApp.evaluate` for the duration of the test, and waits on the ghost
window (a main-process fact) rather than on the renderer's torn-off class,
which is the very state under test. *Alternative:* a `TERMINAY_TEST` IPC seam
in product code. Rejected — the Electron module is already reachable from the
test; no product code is needed.

**6. The destination window takes part in the drag through one host event.**
Today the destination is never told anything: the source asks the server to
move the project with no index, the destination's client-owned tab order puts
it wherever it last remembered it, and tab selection — which is local to each
window — does not change. The host already knows which bar the cursor is over
on every poll tick, so it publishes `workspace.drop-target` to that window with
a `phase` of `hover`, `leave`, or `drop`, the cursor's x within the window, the
dragged project's `(serverId, projectId)`, and its title, emoji, and colour.
`workspace.drag.start` gains the `projectId`; the server id comes from the
source window's host context, not from the renderer. *Alternative:* have the
host compute the index. Rejected — only the destination renderer knows its tab
geometry, overflow, and cross-server composition. *Alternative:* return the x
in the merge decision and let the source send an index to the server. Rejected
— the server index orders one server's projects, while the strip order is the
destination window's own composition across servers.

**7. The destination places the tab when it arrives, by the path a manual
reorder uses.** On `hover` the destination turns the x into an insertion point
(`computeDropIndex` over its visible tabs' centres) and renders the existing
`ProjectTabPreview` placeholder there. On `drop` it remembers "this project,
before that tab" and keeps the placeholder up; when the project appears in its
composed tabs it writes the composition order, commits the same-server order
through `project.move` exactly as a strip reorder does, activates the tab, and
clears the placeholder. A drop whose project has not arrived within ten seconds
is forgotten. The move itself stays where it is: issued by the source window.
*Alternative:* have the destination issue the move. Rejected — the source owns
the rollback and the "last tab closes the window" sequence already.

**8. The host hides the ghost over a destination bar and focuses the
destination on drop.** A tab shown in a strip and also floating under the
cursor reads as two tabs. On drop the host calls `show()` and `focus()` on the
destination before answering `workspace.drag.end`.

**Boundary crossed:** renderer → privileged Desktop host, over the existing
host action bridge, and host → another renderer over the existing host event
bridge. The new event carries presentation only (a position and a tab's
title, emoji, and colour) to a window of the same application; it grants no
authority, and the project still moves only through the authenticated
`project.move` the source issues. The `workspace.drag.start` width validator is
unchanged, and the renderer remains unable to position or size native windows
beyond what that action already permits.

## Risks / Trade-offs

- [An extra `active: false` reaches a window that was never torn off] →
  `setProjectTabTornOff` already no-ops when the state is unchanged, so the
  event is sent only to retract an earlier `active: true`.
- [Renderer clears torn-off at drag end while the host's ghost is still
  visible for a frame] → the host destroys the ghost in the same teardown that
  answers `workspace.drag.end`; the renderer clears only after that answer.
- [Stubbing `screen.getCursorScreenPoint` in tests diverges from real cursor
  behaviour] → the stub replaces only the input to the decision, not the
  decision; hit-testing and thresholds run unmodified.

## Open Questions

- Whether any real bar layout produces a project tab narrower than 80px has not
  been measured. Decision 3 is correct either way; task 4.2 establishes whether
  it is reachable and is dropped in favour of a unit test alone if it is not.
