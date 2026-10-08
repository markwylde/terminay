# ADR-0053: Every in-page window is presented through one modal frame, with geometry kept on the device

Status: accepted
Date: 2026-10-08

## Context

Where a host supplies no native windows, the workspace bundle presents its
secondary surfaces inside the page. Each of those surfaces, and each smaller
dialog the workspace raises on any host, had grown its own backdrop, frame,
close control, Escape handler, and focus handling. They looked different, one
Escape reached all of them, none could be moved or resized, and every new
dialog added another copy.

A browser has no window manager to give to the page. Something in the bundle
has to do that job, and the question is how much of one to build.

## Decision

1. **One frame.** A window or dialog presented inside the page renders through
   the shared `InPageWindow` component, which alone owns the backdrop, title
   bar, close and maximise controls, movement, resizing, focus trap, Escape,
   and focus return. A new in-page window or dialog uses it and does not draw
   its own. Confirmation prompts, the Command Bar, the compact switcher, and
   agent app windows are separate presentations and are not covered.
2. **Modal, one at a time, stacked only by nesting.** An in-page window is
   modal. A dialog opened from inside a window stacks above it and only the
   topmost takes input. There are no sibling windows, no z-order between
   siblings, and no minimise.
3. **Two kinds.** A management window is resizable, maximisable, and has a
   stable id. A content-sized window takes the size of its content and can
   only be moved.
4. **Geometry is a pure model.** Placement rules — reachability of the title
   bar, minimum and maximum size, fitting a remembered rectangle to a
   viewport — are pure functions with no DOM access, shared with agent app
   windows where the arithmetic is the same.
5. **Geometry is device-local view state.** A management window's rectangle
   and maximised flag are kept in browser storage, keyed by window id alone,
   best-effort, validated on read. They are never a server setting and are
   never keyed by server, project, or session.
6. **The frame is host-neutral.** It uses no host capability. Desktop's native
   auxiliary windows are unaffected; dialogs that Desktop renders inside its
   main window use the same frame as a browser does.

## Rejected alternatives

- **Non-modal, freely overlapping windows.** It is what a desktop window
  manager does, but it needs z-order, focus arbitration with terminals, and
  rules for a window left open over a project that changes underneath it. The
  owner chose modal.
- **A windowing dependency.** The required behaviour is small and the
  repository already had the resize arithmetic.
- **The native `<dialog>` top layer.** It would put windows above the
  workspace's own portalled popups, which must appear over an open window.
- **Server-stored geometry.** A rectangle only means something in the viewport
  it was made in, and window geometry is already classified as connection-host
  state.

## Consequences

- Adding a dialog is a title, a close handler, and content.
- A dialog cannot opt out of the frame's Escape, backdrop, or focus behaviour;
  one that needs to refuse dismissal must be given an explicit way to say so in
  the frame.
- Popups that must appear over a window have to sit above the frame's stacking
  level.
- Moving to non-modal windows later means superseding this ADR, not extending
  it.

## Open items

- Whether the remaining in-page dialogs (shell-profile editor, macro parameter
  prompt, confirmation prompts) should join the frame.
