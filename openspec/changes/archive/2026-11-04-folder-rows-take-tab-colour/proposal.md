## Why

The active terminal's row in the Folders tree is filled with a weak tint of the project colour, while that terminal's tab in the strip is filled with the tab's own colour. When a terminal is coloured apart from its project, the two highlights for the same terminal disagree, and the tree gives no sign of which of its terminals carry their own colour.

## What Changes

- The active terminal's row is filled as its tab is filled when active: the terminal's tab colour mixed at the same strength over the same base.
- A terminal row whose tab colour differs from the project's carries that colour as a 3px edge on its leading side while it is not the active row. A row in the project's colour carries no edge.
- File and folder tab rows are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: a new requirement says a terminal row takes its tab's colour.

## Impact

- `src/workspace/folderTreeModel.ts`, `src/workspace/folderTreeSources.ts` — a terminal row carries the tab colour the inventory already resolves, and whether it differs from the project's.
- `src/components/folders/FoldersTree.tsx`, `foldersTree.css` — the row's fill and edge.
- No server, protocol, or persistence change.
