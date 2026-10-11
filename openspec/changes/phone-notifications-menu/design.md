## Context

The wide header draws `TerminalActivityOverview`: a bell with a count and a
popover anchored to it. The compact row replaces the whole header and never
drew it. The list's contents, order, activation, and dismissal already live
in the shell and do not depend on the width.

## Goals / Non-Goals

- Goal: a phone user can see, open, and clear every notification.
- Non-goal: any change to what a notification is, to the server, or to push.

## Decisions

- **A sheet, not the wide popover.** A 300px popover anchored under a 30px
  button leaves little room beside it on a 390px screen and its rows are too
  small to hit. The switcher already established the bottom sheet as how this
  width shows a list, so the notifications use the same scrim and sheet.
- **The rows are the wide list's rows.** One component renders both, so a
  notification reads the same on every device and cannot drift.
- **One open flag for both widths.** The sheet is shown from the same state
  that opens the wide popover, so the existing rule that a header menu closes
  the switcher covers it, and a window resized across the breakpoint keeps
  the list open.
- **The bell sits before the connection control.** The connection control
  stays on the trailing edge, where it is on a wide window.

## Risks / Trade-offs

- [One more control on a narrow row] → It is 30px, and the breadcrumb already
  gives up width last; the project name truncates sooner on the narrowest
  phones.

## Migration Plan

None.

## Open Questions

None.
