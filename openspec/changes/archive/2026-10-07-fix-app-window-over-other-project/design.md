## Context

App windows are laid out by `AppWindowHost`, one overlay mounted above every
project workspace so that a view's iframe is never moved when a tab or project
changes (moving an iframe reloads it). Each terminal panel registers its element
in `appWindowPanes`; the host follows that element's rectangle and hides a
window when `isPaneVisible(pane)` is false. `isPaneVisible` answers from
`isConnected` and a non-zero bounding rectangle.

That is true of an inactive terminal tab, whose panel Dockview leaves without a
size. It is not true of an inactive project: `.project-workspace` is
`position: absolute; inset: 0; visibility: hidden` and only the active one is
`visibility: visible`, so every pane of every project has a full-size rectangle.
The same function decides whether a newly arrived window is marked unseen, so
the badge does not pulse either.

`e2e/app-windows.spec.ts` › "a window that arrives while another project is in
front stays with its own project" reproduces it and fails on `main`.

## Goals / Non-Goals

**Goals:**

- A pane in a project that is not in front is not on screen, for both hiding
  windows and marking them unseen.
- Views keep running and keep their state while hidden (unchanged).

**Non-Goals:**

- Moving the host inside each project workspace, or one host per project.
- Any change to window ownership, the protocol, the server, or MCP.
- Changing how inactive projects are hidden.

## Decisions

**Ask the browser whether the pane is rendered, not only whether it has a
size.** `isPaneVisible` additionally requires the pane element's computed
`visibility` to be `visible`. `visibility` is inherited, so the pane reports
`hidden` whenever any ancestor — the project workspace today — hides it, without
the pane registry knowing what a project is.

- *Alternative: pass the active project id to the host and filter by
  `window.projectId`.* Rejected: it duplicates in React state a fact the DOM
  already holds, needs a second rule for Home and for popped-out project
  windows, and leaves `isPaneVisible` wrong for its other caller.
- *Alternative: `element.checkVisibility({ visibilityProperty: true })`.*
  Equivalent, but the workspace bundle also runs in browsers and the framed PWA
  host (ADR-0018, ADR-0012) where it is newer; computed style is universal.
- *Alternative: hide inactive projects with `display: none`.* Rejected: it gives
  every hidden terminal a zero size, which resizes PTYs and re-fits xterm on
  each project switch.

**Keep re-measuring on the existing cue.** A project switch changes no pane's
size, so `ResizeObserver` does not fire. `App.tsx` already dispatches
`APP_WINDOW_LAYOUT_EVENT` when `activeProjectId` or `isHomeSelected` changes,
and the host measures on it; `sameFrame` already compares `visible`. No new
subscription is needed. The implementation verifies the measure runs after the
class change has been committed.

No security or architectural boundary is crossed: this is renderer presentation
only. It does tighten a presentation boundary the spec implies — a window is
reachable only through its own terminal — by ending pointer input to a window
whose terminal is not shown.

## Risks / Trade-offs

- [A computed-style read per pane on each measure] → measures are already
  coalesced to one per animation frame and already read layout; the pane count
  is small.
- [A future way of hiding a project that is neither zero-size nor
  `visibility: hidden`, such as opacity or off-screen transforms, would
  reintroduce the defect] → the end-to-end test fails if it does.
- [The measure could run before the active class is applied] → the dispatch is
  in an effect, after commit; covered by the end-to-end test's switch-away case.
