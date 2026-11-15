# ADR-0125: Compact edge drawers are navigation surfaces, not in-page windows

Status: accepted, supersedes ADR-0053 in part
Date: 2026-11-15
Supersedes: ADR-0053 (decision 1: the list of presentations exempt from the shared `InPageWindow` frame, which names the compact switcher but no other compact drawer)

## Context

ADR-0053 requires every window or dialog drawn inside the page to use the
shared `InPageWindow` frame. It exempts the Command Bar, confirmation prompts,
agent app windows, and the compact switcher. The compact switcher is a drawer
that slides in from the left edge of a phone-width workspace. It leaves a strip
of the page visible and is dismissed by that strip, by Escape, or by its own
close control. At compact width an in-page window fills the viewport, which is
the opposite of what a drawer is for.

The phone review adds a second drawer of the same kind: the Home options panel.
It slides in from the right edge and holds the front Home section's filters and
view controls. Read literally, ADR-0053 would require it to be an `InPageWindow`.
That would make it fill the screen, hide the list the filters act on, and offer
move and resize affordances that mean nothing on a phone.

## Decision

1. A **compact edge drawer** is a navigation surface that slides in from one
   edge of a compact workspace (640px and below) and leaves part of the page
   visible. Pressing that part closes the drawer. Edge drawers include the
   compact switcher, at the left edge, and the Home options panel, at the right.
   They are not in-page windows, and ADR-0053's frame does not apply to them.
2. Compact edge drawers share one drawer presentation:
   - the switcher's drawer shell, mirrored for the right edge;
   - the scrim;
   - the slide-in, which reduced motion turns off;
   - focus containment and focus return;
   - Escape closing the topmost layer first.

   A new compact edge drawer uses that shell and does not draw its own.
3. At most one compact edge drawer is open at a time. Opening one, or the
   Command Bar, closes any other.
4. Everything else in ADR-0053 is unchanged. Windows and dialogs that are not
   edge drawers still use `InPageWindow`.

## Consequences

- The Home options panel and the switcher look, move, and dismiss alike, and
  the shared shell keeps them from drifting apart.
- A future compact surface must choose to be an edge drawer or an in-page
  window. It cannot be an ad-hoc third kind.
- The exemption is limited to compact width and edge drawers. It gives no
  licence to bypass `InPageWindow` for dialogs on wide windows.
