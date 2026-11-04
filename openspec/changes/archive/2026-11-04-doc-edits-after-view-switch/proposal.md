## Why

Text a user types into a Documentation editor within a quarter of a second of choosing Rich text, Source, or Diff is never saved. The panel does not go dirty, autosave never runs, and the words are lost when the panel closes. A quick user who switches back to rich text and carries on typing loses the first burst of an edit, or all of it.

The cause is a time window. MDXEditor re-exports the document when its views change, and the re-export can respell it — an empty admonition gains a blank line — so the panel stopped treating the editor's reports as edits for 250 ms after any press on a view toggle. Every report in that window was dropped, whoever caused it. The same window also dropped the words a user had typed into an admonition, which reach the document only when the views change or the admonition loses focus.

## What Changes

- A change of views is the click that makes it, not a span of time. MDXEditor makes every report that a change of views causes while that click is being handled, so only reports made inside that click are the change of views'.
- A report made by a change of views is saved unless it describes the same document as before, compared by its parsed structure with the editor's own Markdown extensions, not by its characters. A respelling is not saved; words carried in from a nested editor are.
- Every report made after the click is the user's and is saved as before.
- The 250 ms timer is removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `documentation-sidebar-and-editor`: adds a requirement that changing views is not an edit and never swallows one.

## Impact

- `src/components/file-viewer/DocumentationEditor.tsx` — the timer and its pointer-down handler are replaced by a click-scoped change of views.
- `src/components/file-viewer/documentationEditorChanges.ts` (new) — decides which of the editor's reports are edits, and compares documents by structure.
- `src/components/file-viewer/documentationEditorPlugins.tsx` — a realm plugin hands the editor's parser extensions to that comparison.
- `src/components/file-viewer/documentationEditorChanges.test.ts` (new), run by `npm run test:documentation`.
- `e2e/documentation-sidebar-editor.spec.ts` — types straight after a change of views and into an admonition before one, and reads both off disk; no longer waits out the window.
- No protocol, settings, persistence, or file-session change.
