## Context

`WorkflowPanel` renders an `<aside class="workflow-panel">` at the pane's right
edge. In a narrow pane (`mode === 'forced-collapsed'`), expanding it sets local
`overlay` state and renders `WorkflowOverlay` as a sibling of `WorkflowRail`
inside the same 36px aside. The overlay is absolutely positioned (`right: 0`,
`width: min(264px, 85vw)`) and has no `z-index`. `.workflow-marker` is
`position: relative; z-index: 1` so that markers sit above their joining lines.
Positioned descendants with a positive `z-index` paint above a later
`z-index: auto` positioned sibling, so the rail's markers show through the
overlay. Terminal control state plays no part in this.

## Goals / Non-Goals

**Goals:**
- Show only the overlay while it is open. Restore the rail when it closes.
- Keep the terminal's width, focus handling, and keyboard isolation as they are.

**Non-Goals:**
- Changing the narrow-pane threshold, the overlay's width, or the wide-pane
  expanded layout.
- Changing anything in the terminal-control (holder/takeover) UI.

## Decisions

- **Do not render the rail while the overlay is open.** `WorkflowPanel`
  renders `WorkflowRail` only when `overlay` is false. This removes the rail's
  markers, toggle, and rotated name from the DOM and the accessibility tree, so
  there is no duplicate "Expand workflow" button behind the dialog.
  *Alternative:* raise the overlay's `z-index` only. That fixes the painting,
  but the hidden rail would still be focusable and announced behind the
  dialog.
- **Also give the overlay `z-index: 2`.** This is defence in depth: any future
  positioned rail content cannot paint over the overlay. The overlay stays
  inside the panel's stacking context (`z-index: 3`), so this does not change
  its order against other pane chrome.
- **Keep the aside at its collapsed width.** Its class stays
  `workflow-panel--collapsed` while the overlay is open, so the pane still
  reserves the 36px strip and the terminal does not refit.

No security or architectural boundary is crossed. This is a renderer-only
presentation change inside the terminal pane chrome that the `terminal-workflows` spec lays out. ADR-0097 is not affected.

## Risks / Trade-offs

- [The pane widening while the overlay is open] → The component already clears
  `overlay` when `forced-collapsed` ends, so the rail-or-overlay choice falls
  back to the normal expanded or collapsed layout. The e2e test covers this.
- [Unmounting the rail drops its Expand button, which held focus when the user
  tapped it] → The overlay already moves focus to itself on mount, and closing
  it returns focus to the terminal. Neither path needs the rail button.
