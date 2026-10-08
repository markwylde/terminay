## Context

The Folders tree (`src/components/folders/FoldersTree.tsx`) draws each terminal as a `TerminalRow`: a draggable `treeitem` whose click activates the terminal and whose context menu is its tab's menu. Rows are built from the server's workspace snapshot, so a row may belong to a folder whose layout is not the one Dockview is showing.

A terminal is renamed today only in the tab editor. `openTerminalEditWindow` in `src/App.tsx` sends `workspaceSnapshotStore.updatePanel({ panelId, patch: { title } })` and sets the Dockview panel title locally; the snapshot reconcile then carries the canonical title to every other presentation.

## Goals / Non-Goals

**Goals:**
- Rename a terminal from its row with a double-click, Enter, and nothing else.
- One title authority: the server's panel record, written the way the tab editor writes it.

**Non-Goals:**
- Renaming folders in place. Folders keep their menu.
- A touch gesture. Double-click is a pointer shortcut; touch keeps the tab editor.
- Changing what double-clicking a tab does.

## Decisions

**The row owns the editing state; the tree owns nothing new.** `TerminalRow` holds a draft string or `null`. Only one input can have focus, and losing focus ends the edit, so no tree-level "which row is editing" state is needed. Alternative: lift the state to `FoldersTree` — more wiring for no behaviour.

**Write through the workspace snapshot store.** The handler in `App.tsx` calls `updatePanel` with the new title, and sets the Dockview title when the panel is in the layout on screen. This stays inside the boundary the tab editor already uses: the renderer asks, the server owns the panel record, and no new command or preload surface is added. Alternative: `panel.api.setTitle` alone, as the MCP `rename_terminal` handler does — it fails for a row whose panel is not in the shown layout.

**Blank or unchanged text is a cancel, not an error.** The tab editor falls back to the old title for a blank name; the row does the same silently.

**The row is not draggable while editing, and the input stops click, double-click, key, and context-menu events from reaching the row.** Otherwise a text selection drag moves the terminal and Space or Enter re-activates the row.

**Renaming is offered where `onRenameTerminal` is passed**, the same shape as `onTerminalMenu`, so a card that only lists stays inert.

## Risks / Trade-offs

- [The first click of a double-click activates the terminal, which may take focus after the input mounts and end the edit at once] → the end-to-end test double-clicks an inactive terminal's row and types; if focus is taken, defer focusing the input until the activation has settled.
- [A rename racing a title set by an agent or MCP] → last write wins at the server, as with the tab editor.
- [Other active changes also touch `project-folders`] → this delta is ADDED only, so it folds in whatever order they archive.
