## Why

Renaming a terminal means opening the tab editor, a window with colour, emoji, theme, and note controls, when all the person wants is to change a name. The Folders tree already lists every terminal by title, so the name can be changed where it is read.

## What Changes

- Double-clicking a terminal's row in the Folders tree turns its title into a text input holding the current title, selected.
- Enter, or moving focus away, saves the name. Escape leaves the name as it was.
- A blank name, or one that is unchanged, changes nothing.
- The saved name is the terminal's title everywhere: its tab, its row, and every other client of the same server.
- The tab editor is unchanged and stays the way to change colour, emoji, theme, and note.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: a terminal's row in the Folders tree gains renaming in place.

## Impact

- `src/components/folders/FoldersTree.tsx`, `FoldersColumn.tsx`, and `foldersTree.css`: the row's editing state and input.
- `src/App.tsx`: a rename handler that writes the title through the workspace snapshot store, as the tab editor does.
- `e2e/linked-folders.spec.ts` and the row tests under `scripts/`.
- No server, protocol, or preload change: the panel title update the tab editor sends is reused.
