## Context

`DocumentationEditor` (`src/components/file-viewer/DocumentationEditor.tsx`) hands MDXEditor's `onChange` reports to `DocumentationAutosaveController`. Two kinds of report are not edits. Opening a document reports the editor's normalized form, flagged `initial` by MDXEditor, and the panel already keeps it without saving. A change of views reports a re-export, which the panel suppressed with a 250 ms timer started on `pointerdown` over a view toggle.

What a change of views does, read from `@mdxeditor/editor` 4.2.1 and observed in the Electron E2E harness:

- The toggle is a Radix toggle group controlled by MDXEditor. Its `click` handler publishes `viewMode$` synchronously.
- Leaving rich text dispatches `NESTED_EDITOR_UPDATED_COMMAND` on the active editor. A nested Lexical editor (an admonition's body) answers with a `discrete` update of its parent, so the root's export listener runs and `onChange` fires before the click handler returns. For an admonition inserted empty this report respells `:::info\n:::` as `:::info\n\n:::`.
- Leaving source or diff publishes `setMarkdown$`, whose import runs under MDXEditor's own `muteChange$` and reports nothing.
- A nested editor writes its text into the parent only on blur to outside the editor UI, or on that command. The view toggle is inside the editor UI, so text typed into an admonition reaches the document first in the change-of-views report.

So every report a change of views makes is made during the click that makes it, and such a report can carry user text.

## Goals / Non-Goals

**Goals:**

- No edit is ever dropped because of when it arrives.
- A change of views that only respells the document is not saved.
- Text a change of views carries in from a nested editor is saved.

**Non-Goals:**

- Making nested editors write back on every keystroke. Their blur and view-change write-back is MDXEditor's behaviour and is left as it is.
- Changing what opening a document reports, or the autosave debounce.

## Decisions

### 1. A change of views is the click that makes it

The editor root brackets the toggle's handler with React's `onClickCapture` (start, only when the target is a view toggle) and `onClick` (end, on every click). React runs both for the same dispatch, around the toggle's own handler, and runs the rest of a dispatch even if one handler throws. No input event can land inside the bracket, and every input after it is outside.

Alternatives considered:

- *Keep a time window, shorter or longer.* Rejected: any window drops a fast user's edit, and the window's length has no relation to the cause.
- *Subscribe to `viewMode$` from a realm plugin.* Gurx runs a node's own subscriptions before those on nodes derived from it, so a subscription there starts before MDXEditor's effects but there is no matching point after them. Wrapping the realm's `pubIn` would bracket them, at the cost of patching a library object.
- *End the scope at the user's next input.* Rejected: any input path the list missed, such as a toolbar action, would be dropped.

### 2. Inside a change of views, a report is an edit unless it is the same document

A report made inside the bracket is compared with the document the editor last held, by parsing both with `mdast-util-from-markdown` and the editor's own `syntaxExtensions$` and `mdastExtensions$`, and comparing the trees without positions. The same document is kept as the editor's current text, so it is neither re-imported nor reported again by the source view, and is not saved. A different document is an edit. If the comparison throws, or the extensions cell is unavailable, the report is saved: the worst case is the respelling being written, never an edit being lost.

Alternatives considered:

- *Drop every report made inside the bracket.* Rejected: it loses admonition text typed before the switch.
- *Compare characters.* Rejected: the respelling is a character difference.
- *Compare structurally outside a change of views as well.* Rejected: a user-typed trailing space parses away, and it is an edit.

`mdastExtensions$` is exported at runtime by `@mdxeditor/editor` but left out of its type declarations, so it is read through a typed accessor, and its absence falls back to saving.

### 3. The decision lives in a pure module

`createDocumentationEditorChanges` holds the editor's current text and makes the decision, so it is unit-tested under `node --test` without a DOM. `DocumentationEditor` only feeds it reports, loaded documents, and the start and end of a change of views.

### Boundary

The change stays inside the renderer's rich editor view. It crosses no security or architectural boundary: saves still go through the panel's own server file session (ADR-0064), and no privileged API is added.

## Risks / Trade-offs

- [A future MDXEditor defers a change of views' report past the click] → The report would be outside the bracket and saved, which rewrites a respelling to disk, not a lost edit. The E2E would still pass. The unit test pins the decision, and the design names the assumption.
- [The view toggle changes its accessible names] → `isViewToggle` would miss it, and a respelling would be saved. Same direction of failure.
- [Structural comparison misses a difference the user cares about] → Only inside a change of views, and only for a nested editor's text that the parser reads as equal, such as trailing whitespace in an admonition.

## Open Questions

None.
