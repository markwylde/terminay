## Context

`CompactChromeRow` replaces the whole header at 640px and below. It was built
before the switcher grew a rail with Home and a server menu, so it still
carries its own Home toggle, a connection glyph that opens the switcher, and
the host's application menu as a burger.

## Goals / Non-Goals

- Goal: one control per destination on the phone row, and a sidebar toggle
  that looks like the column it opens.
- Goal: every application-menu command stays reachable at phone width.
- Non-goal: any change to the wide bar, the server, or what a command does.

## Decisions

- **Home and the server menu live in the switcher only.** Its rail already
  lists Home first and the server control above it. Going Home is two presses
  instead of one; the title block is the most-pressed control and gains the
  width.
- **Server warnings always ride on the title block.** With no connection glyph
  on the row, the title block's warning — previously drawn only while Pixel
  held the trailing place — is drawn whenever the server is unreachable or has
  an upgrade.
- **The sidebar toggle is trailing, with a right-panel glyph.** It toggles the
  same column it always did: the project sidebar, or Home's sidebar while Home
  is shown. Pixel sits just before it so the toggle keeps a fixed position.
- **The application menu is a menu bar at the top of the switcher.** It reuses
  the wide menu bar's menus and items, so the two cannot drift. Its row
  scrolls sideways; each menu's list is portalled to the document body and
  positioned under its button, because a list inside the scrolling row would
  be clipped by it. Choosing a command closes the switcher before the command
  runs on the workspace. The host renders the bar; the shared switcher only
  places it, so the renderer/host boundary is unchanged.
- **A Windows Desktop window keeps its native menu button** and shows it in the
  same place; main still opens its own menu, so no native command crosses the
  renderer.

## Risks / Trade-offs

- [Home is one press further away] → The switcher's Home item carries the same
  attention badge the row's Home toggle did.
- [A menu list outside the drawer's DOM] → It closes on any outside press, on
  Escape, and when the row scrolls, so it never floats detached from its
  button.

## Migration Plan

None.

## Open Questions

None.
