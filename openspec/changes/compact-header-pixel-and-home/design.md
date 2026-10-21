## Context

The compact row is one 30px-high band of icon buttons around a breadcrumb.
Pixel already docks into whatever element it is given: a slot in the status
bar, or a fixed corner button when the bar is hidden.

## Goals / Non-Goals

- Goal: the phone header carries only what a user reaches for, and Pixel stops
  covering the terminal.
- Non-goal: any change to the wide layout or to the switcher's lists.

## Decisions

- **Home lives in the switcher's toolbar, not its list.** The toolbar row is
  always drawn whatever the filter, so Home stays one tap behind the breadcrumb
  even while a search narrows the list. A row inside the list would vanish
  under a filter that does not match "Home".
- **The row exposes a slot; Pixel portals into it.** The row draws an empty
  element where the glyph was and Pixel renders its dock there, the same way it
  already renders into the status bar's slot. The pet keeps one owner and the
  row learns nothing about Pixel.
- **The header dock wins over the status bar at phone width.** A compact
  window with the status bar shown would otherwise dock Pixel at the bottom
  while the header slot stands empty.
- **Pixel off keeps the glyph.** Removing it would leave the trailing edge
  empty and drop the server status for users who never enabled Pixel.
- **Lost signals move to the breadcrumb.** An unreachable server or pending
  upgrade marks the breadcrumb's chevron and is appended to its accessible
  name, since the breadcrumb opens the same switcher the glyph did.

## Risks / Trade-offs

- [Home is one tap further away on a phone] → The breadcrumb is the largest
  target on the row and Home is the first control in the sheet it opens.

## Migration Plan

None.

## Open Questions

None.
