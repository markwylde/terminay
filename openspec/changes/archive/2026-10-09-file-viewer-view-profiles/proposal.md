## Why

Text files open in HEX. Clicking a changed file in the Git pane asks for Diff,
and when there is no diff to show the panel falls back to a byte grid instead of
the file's contents; a file with no recognised extension — `Dockerfile`,
`.gitignore` — opens in HEX on its own. Around that, the panel's chrome does not
look like the rest of Terminay: a pill-shaped segmented control with a blue
selection that matches nothing else, an editor whose colours differ from the
Preview of the same file, and a second status bar inside the panel repeating the
path and announcing "Monaco" and "Synced".

Underneath, the file's default view is chosen by a chain that ends in HEX, the
fallback for an unavailable view is hard-coded to HEX, and every file is offered
the same four tabs whether or not they can show it.

## What Changes

- A file opens in the view that suits its type: source and other text in Text,
  Markdown, images, and PDFs in Preview, unrecognised binary data in HEX. Text
  recognised only by its content counts as text.
- A view that turns out to be unavailable gives way to the file's default view,
  never to a rawer one.
- The view switcher lists only the views that can show the file, most relevant
  first. Views that work but rarely matter for the type — HEX for a text file —
  sit under a "More views" menu. Diff stays visible on a text file with nothing
  to compare, disabled, with the reason.
- The switcher is restyled as a quiet tab row on the panel surface, marked by an
  underline in the tab's own colour.
- The Text editor uses the same surface, palette, and type metrics as Preview.
- **BREAKING** The in-panel status bar is removed. The window status bar
  describes the focused file panel instead: its name, folder, branch, size, and
  whether it has unsaved changes. The editing engine is no longer displayed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-viewer`: default view and view switcher are decided by file type; the
  fallback for an unavailable view is the default view; the panel carries no
  status bar of its own; Text and Preview share one appearance.
- `workspace-status-bar`: the left side describes the focused file panel when a
  file, rather than a terminal, holds focus.

## Impact

- `packages/server-core/src/fileService/catalog.ts` — preferred mode by
  classification; wider table of text types.
- `src/services/fileViewer/capabilities.ts`, `src/types/fileViewer.ts` —
  primary and secondary views, default, and fallback.
- `src/components/file-viewer/FileModeSwitcher.tsx`, `FilePanel.tsx`,
  `fileViewer.css`, `monacoSetup.ts`, `modes/TextViewer.tsx`;
  `FileStatusBar.tsx` deleted.
- `src/workspace/WorkspaceStatusBar.tsx`, `workspaceStatusBarModel.ts`,
  `src/App.tsx`, `src/App.css` — focused-file summary.
- `scripts/file-viewer-view-modes.test.mjs`,
  `packages/server-core/test/file-catalog.test.mjs`, and the e2e specs that
  asserted on the in-panel status bar or assumed Preview for text.
- No protocol shape changes: `preferredMode` keeps its three values.
