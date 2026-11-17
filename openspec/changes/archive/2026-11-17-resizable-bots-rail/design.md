## Context

The Bots section (`BotsSection.tsx`) and a bot tab's Chat mode (`BotChat.tsx`
with `BotContextRail.tsx`) both lay out a flex row: a main column and a
`.bots-rail` aside fixed at 300 pixels. At 860 pixels of window width or less,
media queries stack the overview rail under the cards (`bots.css`) and hide the
Chat context rail (`botPanels.css`). Below the compact breakpoint the overview
is `BotsCompactPage`, which has no rail at all. Home tabs can also sit side by
side, so a Bots area can be narrow inside a wide window.

Terminay already has a right-hand pane resizer: the Home Pull Requests and
Issues detail preview uses `ForgeDetailSeparator` for gestures, and
`useRememberedColumnWidth('forgeDetail')` for a device-local width stored under
`terminay.view.column-widths.v1` and followed across windows. Issue #614 asks
for the Bots rail to reuse that logic.

Boundary: everything here is renderer presentation state. It stays in
`localStorage` on the device, following ADR-0040 (Home presentation is
device-local) and the `shared-sidebar-widths` precedent. No server, protocol,
preload, or Electron main-process surface is touched.

## Goals / Non-Goals

**Goals:**
- One resize gesture implementation shared by the Forge preview and the Bots
  rail, with identical drag, keyboard, and cancel rules and identical look.
- One device-remembered Bots rail width shared by the overview and bot tabs.

**Non-Goals:**
- Collapsing the rail, or double-click to reset. The existing pane separator
  has neither, so the reused one does not either.
- Resizing the rail in the compact (phone) layout, which has no rail.

## Decisions

1. **Promote `ForgeDetailSeparator` to `src/components/PaneEdgeSeparator.tsx`.**
   It gains `label`, `step`, and pass-through `className`/data attributes; its
   gesture code is unchanged. Forge keeps `forge-home__separator` and
   `data-forge-detail-separator` so its E2E coverage keeps guarding behaviour.
   The terminal workflow panel's `WorkflowPanelSeparator` was a third copy of
   the same code; it moves onto the shared component too.
   Alternative considered: import the Forge component from Bots. Rejected:
   Bots would depend on Forge internals and its Forge-specific step constant.
2. **Shared separator look.** The `::before` line and hover/focus styling move
   to a shared `.pane-edge-separator` class; each consumer positions it.
   Forge positions it absolutely in its grid; Bots places it as a 6-pixel flex
   item with -3 pixel inline margins between the main column and the rail.
3. **`botsRail` column in `localViewState`.** Default 300. Reusing
   `useRememberedColumnWidth` gives cross-project, cross-window following for
   free.
4. **`botsRailWidth.ts` model** with `BOTS_RAIL_MIN_WIDTH = 240`,
   `BOTS_RAIL_MAX_WIDTH = 560`, `BOTS_MAIN_MIN_WIDTH = 420`, and pure
   `botsRailWidthBounds(rowWidth)` and `drawnBotsRailWidth(chosen, rowWidth)`
   mirroring the Forge functions. A `useBotsRailWidth()` hook measures the
   row with `ResizeObserver`, holds the live preview, and reports `resizable`:
   false when `matchMedia('(max-width: 860px)')` matches (the CSS stacks or
   hides the rail) or when the row is narrower than 660 pixels (420 + 240, so
   the bounds collapse to a single width). The separator is rendered only when
   resizable. In a narrow row the rail is drawn at 240 pixels and the main
   column takes what is left; the existing narrow-window CSS is unchanged.
5. **The width is applied by an inline `--bots-rail-width` custom property** on
   the row; `.bots-rail` uses `width: var(--bots-rail-width, 300px)`, and the
   narrow media query keeps `width: auto`.

6. **Other windows.** `useRememberedColumnWidth` already follows a commit from
   another window through the `storage` event and never writes back. A local
   drag draws its own preview over the followed value; release commits the
   drag's width once, a cancelled drag commits nothing and the rail returns to
   whatever width is chosen by then. Previews never touch storage.

## Risks / Trade-offs

- [Refactoring the Forge separator could regress it] → gesture code moves
  verbatim; `scripts/forge-ui.test.mjs` and the Forge E2E separator step are
  re-run explicitly.
- [Separator overlaps the rail's scrollbar] → it straddles the border with
  -3 pixel margins exactly as the Forge separator does; the rail keeps its
  16-pixel padding.

## Migration Plan

None. A device with no stored `botsRail` width draws 300 pixels, as today.

## Open Questions

None.
