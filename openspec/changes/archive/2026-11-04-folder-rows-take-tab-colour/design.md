## Context

The Folders tree builds its rows from the workspace projection plus facts read from the project's inventory, the same inventory the dashboard reads. Each inventory entry already carries the tab's effective colour (`getEffectiveTerminalTabColor`), which is what the tab strip draws.

## Goals / Non-Goals

**Goals:** the active row matches the active tab; a terminal coloured apart from its project is visible in the tree.

**Non-Goals:** colouring file and folder tab rows, whose tabs resolve colour differently.

## Decisions

### 1. Read the colour from the inventory

The row's colour is a fact added beside its status and title in `panelFactsFromInventory`, so the tree and the tab strip cannot disagree. The alternative, reading panel params in the tree component, would duplicate the resolution rule.

### 2. Compare against the projection's project colour

`buildFolderTree` marks a row `hasOwnColor` when its colour differs, case-insensitively, from the projected project's colour. With no project colour known, no row is marked.

### 3. Same mix as the tab

The active row uses `color-mix(in srgb, <tab colour> 36%, rgba(255,255,255,0.1))`, the active tab's fill. The edge is an inset box-shadow so the row's layout does not shift.

## Risks / Trade-offs

- A row whose inventory entry has not arrived falls back to the project colour, as before.
