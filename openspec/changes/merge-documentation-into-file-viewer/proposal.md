## Why

Opening a Markdown file lands people in a read-only Preview with no formatting controls, so editing prose means dropping to raw Text. The rich MDXEditor surface that does this well is hidden behind a separate "Documentation presentation" that has its own chrome, is reached through an easy-to-miss **Open as document** action, and is switched off entirely in linked worktree folders. That makes it unreachable in exactly the place most work happens. Two presentations for one file also double every open path, flush rule, and close rule.

## What Changes

- Markdown (`.md`) and MDX (`.mdx`) file panels gain a **Document** view: the MDXEditor rich editor with its formatting toolbar, live preview, and one-second autosave. It is the first tab in the view switcher (Document, Preview, Tasks, Text, Diff) and the default view.
- **BREAKING**: The separate Documentation presentation is removed. There is one file viewer, and rich editing is one of its views. The **Open as document** toolbar action and the Documentation editor's **View source** action are removed. The view switcher replaces both.
- Every open that names no view (Explorer, the Documentation pane, a Folder tab, drag onto the tab area, a link in rendered Markdown or MDX) opens the Markdown file in the file viewer on the Document view. An open that names a view (Diff from Git changes, Text from go-to-definition, Tasks from a task card) opens the same panel on that view.
- Document view saves through the panel's own folder-scoped file session, so it works in linked worktree folders too. Only live execution of MDX components stays limited to the project root.
- Leaving the Document view, closing the panel, or blurring it flushes a pending autosave. Text and HEX keep explicit save.
- Panels persisted with the old Documentation presentation restore on the Document view.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `file-viewer`: adds the Document view and makes it the default view and first tab for Markdown and MDX; replaces presentation selection with view selection; removes Open as document.
- `documentation-sidebar-and-editor`: the rich editor is the file viewer's Document view rather than a separate panel presentation; the pane and links open files on that view; View source is removed; autosave and flush rules are restated around the Document view.
- `workspace-and-project-tabs`: removes "Documentation presentation within a file panel". The file panel and view rules now live in `file-viewer`.
- `mdx-browser-runtime`: project document links ask the host to open the target on the Document view.

## Impact

- Renderer: `src/components/file-viewer/FilePanel.tsx`, `FileModeSwitcher.tsx`, `DocumentationEditor.tsx`, `openFilePresentation.ts`, `projectRootFileServices.ts`, `types.ts`, and `src/types/fileViewer.ts` (`FileViewerMode` gains `document`). In `src/App.tsx`, `openFile`, the Documentation pane's open handler, link handling, and close flush all go through view selection.
- Capabilities: `src/services/fileViewer/capabilities.ts` adds `document` as the first primary mode and the default mode for Markdown and MDX.
- Workspace persistence: the panel param `presentation` is retired, and a stored `presentation: 'documentation'` is read as `initialMode: 'document'`.
- Tests: unit tests around presentation resolution, and E2E specs that open documents, follow links, or use Open as document / View source.
