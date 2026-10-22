## Why

The Open a folder dialog shows the same path twice: once in the editable path field and again as a read-only "current folder" line under it. Typing a path needs a separate **Go** step before the listing follows, Tab leaves the field instead of completing, and every listing opens on a wall of dotfolders (`.Trash`, `.cache`, `.cargo`…) that pushes the folders people actually open out of view. For a terminal app, picking a folder should feel like typing `cd` in a shell.

## What Changes

- The dialog shows the path once, in one editable field. The read-only current-folder line, the **Go** button and the separate parent button go away.
- The listing always shows the subfolders of the folder the field names, filtered live by the last segment being typed. There is no separate "navigate" step.
- Tab completes the way zsh does and keeps focus in the field: it fills the longest common prefix, then cycles through the matches; Shift+Tab cycles backwards.
- Fish-style ghost text shows the completion after the caret; → at the end of the field accepts it.
- ↑/↓ highlight a row, and Tab or → goes into it. Clicking a row goes into it, and double-clicking opens it.
- ⌥⌫ or ⌃W (macOS) / Ctrl+Backspace (elsewhere, where Ctrl+W stays the app's close shortcut) delete the last path segment. ⌘↑ (macOS) / Alt+↑ goes to the parent folder.
- Enter opens the folder the field names. If the field holds a partial name that matches exactly one folder, Enter opens that folder.
- Esc first undoes a Tab cycle and then clears a highlight or error. If there is nothing to undo, Esc closes the dialog.
- Hidden folders (names starting with `.`) are listed only when the segment being typed starts with `.`.
- The primary button is labelled with the folder Enter would open (for example **Open "terminay"**) and is disabled when no folder would be opened.
- A line above the list gives the match count and the folder being listed, and becomes a plain error message when the typed folder does not exist.

Not breaking: the server browse query, its authority checks and its limits are unchanged.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `project-start-chooser`: The **Open a folder** requirement now describes the single path field, the live listing and keyboard completion. A new requirement covers the folder browser's keyboard contract. This capability is introduced by the unarchived `new-project-start-chooser` change, so archive that change before this one.

## Impact

- `src/workspace/RootFolderBrowser.tsx`: the view is rewritten as the shell-line dialog.
- `src/workspace/rootFolderCompletion.ts`: becomes the completion engine (path split, prefix match, hidden filtering, longest common prefix, cycle state, ghost text, open target) as pure functions with unit tests. `RootFolderCompleter` stays the one place that asks the server for a parent listing.
- `src/workspace/rootFolderNavigator.ts`: kept only if the design still needs it; otherwise it is folded into the completer.
- `src/workspace/projectStart.css`: dialog styles.
- `src/workspace/projectStart.test.ts`, plus a new `rootFolderCompletion.test.ts`.
- `e2e/support/project-start.ts` (`browseToFolder`) and `e2e/project-start-chooser.spec.ts`: these use the **Go** button and the `data-terminay-root-folder-current` / `-parent` hooks, which go away.
- No protocol, server, Electron or MCP changes. ADR-0066 (server-side directory-names-only browse) and ADR-0053 (in-page window frame) still hold.
