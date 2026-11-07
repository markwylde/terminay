## Context

The rail drawer (archived change `2026-11-07-compact-rail-drawer-switcher`) shipped with layout and interaction rough edges. They were found on a real iPhone and in a second review: misaligned tree columns, a reserved but empty dial column, duplicated create controls, small targets, no visible close, and a strip press that skipped the layer order.

## Goals / Non-Goals

**Goals:**
- One alignment grid shared by folder headers and terminal rows.
- Every interactive target at least 44px tall; a visible way to close; actions on a row discoverable without a long press.
- Layered dismissal holds for the strip press as it does for the dismiss key.

**Non-Goals:**
- No change to what the drawer reaches, to server commands, or to persistence.
- No swipe-to-dismiss gesture.

## Decisions

- **Tree grid.** A folder header is `[chevron 28][glyph 22][name][+ 36][⋯ 36]`. A terminal row is `[28 indent][status 22][title + second line][dial?][⋯ 36]`, so status sits under the glyph, the title under the name, and the row's ⋯ under the folder's ⋯. The current-row highlight runs from the chevron's left edge to the ⋯ column's right edge, the same span as the header line.
- **Dial column.** The dial is its own 28px column just before ⋯, rendered only when the terminal has an attached workflow. Dials still align because ⋯ is fixed-width at the trailing edge. An empty slot collapses through `:empty`, because `TerminalWorkflowBadge` renders nothing without a workflow.
- **Folder header as the collapse target.** On a phone, a tree header that expands and collapses is the expected gesture, and it makes the whole line a large target. Showing a folder is rarer and moves to Show folder in the ⋯ menu. Filter results keep a folder result as a show action, because there a folder is a destination and not a group.
- **Close control.** It is a trailing X in the panel header, after search and Edit, named "Close switcher". The header otherwise keeps its controls.
- **Strip press.** The drawer scrim's press runs the same chain as Escape: a layer, then the filter, then the drawer.
- **Rail labels.** A 10px label, truncated, under each tile. It is the project's title (Home for Home), so a phone user can tell two projects with the same initials apart. The rail stays 64px.
- **Touch action.** Outside edit mode a rail tile is `touch-action: manipulation`; only in edit mode does it take `none`, so the grip reorder can follow the pointer.
- **Drawer width.** The drawer is `min(420px, 100% - 52px)`, which leaves a 52px strip (a comfortable dismiss target) under a darker scrim.

No decision crosses a security or architectural boundary. All of it is renderer presentation inside `src/workspace/`, using the existing callbacks into the workspace.

## Risks / Trade-offs

- Pressing a folder header no longer shows the folder. Anyone used to that now reaches it through ⋯ → Show folder or by pressing a terminal row. → It is spec'd and covered by an e2e test.
- Rail labels add height per project, so fewer fit before the rail scrolls. → The rail already scrolls, and the labels pay for themselves once there are two projects.
