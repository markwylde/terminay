## Why

After a project tab has been torn off into its own window once, the window it
came from can never tear off a tab again: any project tab still drags along the
strip to reorder, but pulling it out of the bar no longer shows a drag preview
or opens a window. Dragging the project back in does not help, so an
out → back in → out round trip dead-ends, and only reloading the window
recovers.

The cause is one flag that is set and never cleared. When a drag crosses the
tear-off distance, the Desktop host tells the source window the tab is torn off.
When the drag is released, the host clears its own state without telling the
window, so the window believes a tab is torn off forever. On the next drag the
dragged tab is immediately collapsed to zero width, the drag preview is measured
at 0px, the host rejects that preview as invalid (it accepts 80–2000px), the
window discards the rejection, and the release falls back to a reorder.

Dropping a project onto another window's bar is also not what a person
expects from a tabbed application. The tab does not land where it was dropped —
it reappears wherever that window last remembered it, or at the end — the
window does not switch to it, and nothing in the destination shows where it
will go while it is being dragged.

## What Changes

- While a torn-off tab is held over another window's project bar, that window
  shows the tab in its strip at the pointer and the other tabs make room; the
  floating drag preview is hidden for as long as the strip is showing it.
- Releasing there puts the project at that position, makes it the window's
  active project, and brings that window to the front with keyboard focus.
- `workspace.drag.start` names the project being dragged, and the host gains a
  `workspace.drop-target` event that tells a destination window about a hover,
  a leave, and a drop.
- The Desktop host announces the end of the torn-off state to the source window
  whenever a project drag ends, however it ends — released, or abandoned because
  the source window went away.
- A window treats "torn off" as a property of one drag: it starts every drag
  not torn off and ends every drag not torn off, whether or not the host's
  announcement arrives.
- The drag preview width a window sends is taken from the tab's laid-out width
  and kept inside the range the host accepts, so a narrow or collapsed tab can
  still be torn off.
- A drag start the host refuses is reported as a diagnostic instead of being
  discarded.
- End-to-end coverage for tearing off repeatedly from one window, including the
  out → back in → out round trip, with the cursor position stated by the test
  rather than left to wherever the OS cursor happens to rest.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: adds the requirement that tearing a project off
  leaves its source window able to tear off again, and that a tab of any width
  can be torn off; and changes "Workspace views as native windows" so a project
  dropped on another window lands at the pointer, becomes active, and focuses
  that window, with a live preview while it is held there.

## Impact

- `electron/main.ts` — project drag session end (`endCanonicalProjectDrag`,
  `stopProjectDragTracking`).
- `src/workspace/useProjectTabTransfer.ts` — torn-off state lifetime, preview
  width, drag-start failure handling.
- `e2e/project-tabs.spec.ts` — repeated tear-off scenarios and a cursor seam.
- `packages/protocol/src/host.ts` — `workspace.drag.start` gains a required
  `projectId`; new host event `workspace.drop-target`. Both ends ship in the
  same Desktop build, so there is no version skew to bridge.
- `src/App.tsx`, `src/host/nativeEvents.ts`, `src/shared/connections/composition.ts`
  — destination-side preview, placement, and activation.
- No persistence or server change: placement uses the existing client-owned
  tab order and the existing `project.move` index.
