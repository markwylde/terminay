## Why

Opening a Markdown or MDX file from the Documentation sidebar shows the clean rich editor. Opening the same file from Explorer, a Folder tab, a drag onto the tab area, or a link in a Markdown preview shows the raw File Viewer instead, so users only get the good view if they happen to start from the right pane. Which view you get should depend on the file, not on which sidebar entry you clicked.

## What Changes

- A Markdown (`.md`) or MDX (`.mdx`) file opened without a specific mode now opens in the Documentation presentation. This covers Explorer, Folder tabs, drag-to-tab, Markdown preview links, and Documentation itself.
- Opens that ask for a specific File Viewer mode keep the File Viewer: Git changes (Diff), go-to-definition and reveal (Text), and task cards (Tasks).
- Opening a file that already has a panel, without naming a mode, focuses that panel and leaves its presentation alone. Documentation opens still switch the panel to Documentation.
- The Documentation toolbar gets a **View source** action. It flushes pending autosave and switches the same canonical panel to the File Viewer presentation, so Text, HEX, Diff, and Tasks stay reachable. The File Viewer toolbar gets a matching **Open as document** action for Markdown and MDX files.
- **BREAKING** (behaviour only): Explorer no longer opens Markdown in the File Viewer by default.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `file-viewer`: the presentation-selection rule for Markdown and MDX now picks the presentation by file type and requested mode, not by the surface that made the request. It also adds the switch into Documentation.
- `documentation-sidebar-and-editor`: canonical panel identity now covers opens with no presentation. The toolbar gains the View source action.

## Impact

- `src/App.tsx` `openFile`: resolves the default presentation when the caller passes neither `presentation` nor `initialMode`.
- `src/components/file-viewer/FilePanel.tsx`: toolbar actions that switch presentation on the same panel.
- Documentation editor toolbar component: new View source control.
- No server, protocol, or persistence change. `presentation` is already a server-owned panel parameter with values `file-viewer | documentation`.
- E2E: Explorer, Folder-tab, and preview-link opens of `.md`/`.mdx` files; Git diff opens of Markdown files.
