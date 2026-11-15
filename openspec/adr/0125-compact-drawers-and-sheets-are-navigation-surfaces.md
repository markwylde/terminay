# ADR-0125: Compact drawers and sheets are navigation surfaces, not in-page windows

Status: accepted, supersedes ADR-0053 in part
Date: 2026-11-15
Supersedes: ADR-0053 (decision 1: the list of presentations exempt from the shared `InPageWindow` frame, which names the compact switcher but no other compact surface)

## Context

ADR-0053 requires every window or dialog drawn inside the page to use the
shared `InPageWindow` frame. It exempts the Command Bar, confirmation prompts,
agent app windows, and the compact switcher.

The compact switcher is a drawer that slides in from the left edge of a
phone-width workspace. It leaves a strip of the page visible, and that strip,
Escape, or its own close control dismisses it. At compact width an in-page
window fills the viewport, which is the opposite of what a drawer is for.

The phone review adds a second surface of the same kind: the **View options
sheet** of a compact Home section page. It rises from the bottom edge and holds
the section's secondary options, such as sort, grouping, project, repository,
and server, while the top of the list stays visible above it. Read literally,
ADR-0053 would require it to be an `InPageWindow`. That would fill the screen,
hide the list the options act on, and offer move and resize affordances that
mean nothing on a phone.

## Decision

1. A **compact drawer** slides in from one edge of a compact workspace (640px
   and below) and leaves part of the page visible. Pressing that part closes
   it. The edge is left or right for a drawer, and bottom for a **sheet**.
   Compact drawers include the compact switcher, at the left edge, and every
   compact section page's View options sheet, at the bottom edge. They are
   navigation surfaces, not in-page windows, and ADR-0053's frame does not apply
   to them.
2. Compact drawers share one presentation, the `CompactEdgeDrawer` shell. It
   provides:
   - the scrim;
   - the slide-in, which reduced motion turns off;
   - focus containment and focus return;
   - Escape closing the topmost layer first.

   A new compact drawer or sheet uses that shell and does not draw its own.
3. At most one compact drawer is open at a time. Opening one, or the Command
   Bar, closes any other.
4. Everything else in ADR-0053 is unchanged. Windows and dialogs that are not
   compact drawers still use `InPageWindow`.

## Consequences

- The switcher and every section's View options sheet look, move, and dismiss
  alike, and the shared shell keeps them from drifting apart.
- A future compact surface must choose to be a compact drawer or an in-page
  window. It cannot be an ad hoc third kind.
- The exemption is limited to compact width. It gives no licence to bypass
  `InPageWindow` for dialogs on wide windows.
