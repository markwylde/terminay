## Why

On a phone the rail drawer still feels unfinished. Seen on an iPhone:

- An empty folder shows a large dashed "New terminal" box, so four controls on one screen create a terminal.
- A terminal title truncates early because an empty column is kept for a workflow dial that is not there, and terminal rows do not line up with the folder headers above them.
- General has no glyph, so its name sits left of every worktree name.
- Home looks selected while a project is selected.
- The bottom bar's padding adds the home indicator inset to its own.
- There is no visible way to close the drawer. A tap on the strip of terminal beside it closes the whole drawer even when only a menu or the filter should close, which breaks the layered-dismissal requirement.
- A swipe that starts on a rail project may not scroll the rail.
- Many controls are 20–36px, under a finger's 44px.
- Terminal actions exist only behind a long press.
- The split control does not say where it will create.
- Rail projects are initials only, and their badges are hidden from screen readers.

## What Changes

- **Folder tree on one grid.** Chevron, glyph, then name. Every folder gets a glyph: a folder for a plain folder, a branch for a worktree. Terminal rows put their status and title under the folder's glyph and name, and the current-row highlight spans the same width as a folder header.
- **Whole folder header toggles collapse**, so the target is the full line. Showing a folder moves to a **Show folder** entry in its ⋯ menu.
- **Empty folders.** An empty folder shows one quiet New terminal entry aligned with the rows, in place of the header's + control. A zero count is not shown.
- **Terminal rows.** Each row has a trailing ⋯ control that opens its menu (long press still works). The workflow dial sits in the column just before it, and only when a workflow is attached, so the title takes the space otherwise.
- **Drawer header and dismissal.** The header gets a labelled close control. A press on the strip beside the drawer closes the topmost layer first, as the dismiss key does.
- **Split create control.** It shows the target folder under the launcher name, and its disclosure chevron points up.
- **Rail.**
  - Each project and Home shows a short visible label under its tile.
  - A project's accessible name includes its activity summary.
  - Home is unfilled until selected.
  - Badges sit clear of the selection ring.
  - The rail scrolls from any touch outside edit mode.
- **Touch and feedback.**
  - Every tappable control has at least a 44px tall target.
  - Controls show a pressed state.
  - Muted text has more contrast.
  - Bottom padding is the larger of 8px and the safe-area inset, not their sum.
- **More terminal, less strip.** The drawer leaves a narrower, darker strip of workspace, so titles get more width.

## Capabilities

### New Capabilities

### Modified Capabilities
- `workspace-and-project-tabs`: These requirements change:
  - Folder tree: the header toggles collapse; the panel header has a close control.
  - Folder header: every folder has a glyph, counts show only when non-zero, and an empty folder's entry replaces its + control.
  - Folder menu: adds Show folder.
  - Terminal row menu: adds a ⋯ control.
  - Panel rows: the dial column shows only when needed.
  - Create bar: the label names the folder.
  - Rail: adds labels and accessible status.
  - Layered dismissal: the strip press closes the topmost layer.

## Impact

- `src/workspace/CompactSwitcher.tsx` and `src/workspace/CompactSwitcher.css`.
- Unit test `scripts/compact-switcher-ui.test.mjs`.
- E2E specs that drive the drawer: `e2e/compact-rail-drawer.spec.ts`, `e2e/compact-chrome-switcher.spec.ts`, `e2e/linked-folders.spec.ts` and `e2e/compact-rail-drawer-visual.spec.ts`.
- This is client UI only, with no server, protocol, or persistence change.
