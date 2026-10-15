## Context

A Markdown or MDX file panel currently has two presentations, set by the panel param `presentation: 'file-viewer' | 'documentation'`:

- **File viewer**: `FileModeSwitcher` tabs (Preview, Tasks, Text, Diff, plus HEX under More views). Saving goes through `fileGateway`, which `createServerFileGateway` builds from the panel's `projectRoot`, meaning the folder root, so a linked worktree folder edits its own file.
- **Documentation**: `DocumentationEditor` (MDXEditor plus `documentationEditorPlugins`) is drawn instead of the toolbar. `saveDocumentationDraft` and the autosave session use a revision-checked server file session opened through `fileViewerClient`.

A linked folder's panel gets a `fileViewerClient` already scoped to that folder (`forFolder`), so both save paths write the worktree's file. Documentation was switched off in linked folders anyway (`projectRootFileServices`, ADR-0050 open item) because the MDX runtime it uses is still project-root bound. The screenshot that started this change was a linked folder, so Explorer's "open as Documentation" silently fell back to Preview.

Presentation is threaded through `App.tsx` `openFile` (`resolveOpenPresentation`, `presentationForFolder`), the Documentation pane's `onOpen`, the `terminay-documentation-open` link event, the close flush in `requestClosePanel`, and `FilePanel`'s save registration.

## Goals / Non-Goals

**Goals:**
- One file viewer. Rich editing becomes `FileViewerMode` `'document'`: first tab and default for `.md`/`.mdx`.
- Every open with no named view lands on Document. Named views (Diff, Text, Tasks) still win.
- Document works in linked worktree folders.
- Keep MDXEditor behaviour: toolbar, autosave, self-write reconciliation, conflict handling, zoom, failure boundary.

**Non-Goals:**
- Changing the Documentation pane's catalog, indexing, or tree.
- Making the MDX runtime or language intelligence folder-aware (still ADR-0050's open item).
- Extending Document to `.markdown`, `.mdown`, or `.mkd`. Those stay on Preview.
- Restyling MDXEditor or its toolbar.

## Decisions

**1. `document` is a `FileViewerMode`, not a presentation.** `capabilities.ts` puts `document` first in `primaryModes` and makes it `defaultMode` for `.md`/`.mdx`. `FileModeSwitcher` labels it "Document". `FilePanel` draws the toolbar for every mode and renders `DocumentationEditor` below it when `effectiveMode === 'document'`.
*Alternative*: keep the presentation and only add a tab that toggles it. Rejected because it keeps two open paths, two flush paths, and the linked-folder gap.

**2. Document saves through the panel's own folder-scoped file client.** Document keeps its revision-checked server session (`edit`/`save` with expected draft and disk revisions, which the autosave spec requires), opened through the panel's `fileViewerClient`. That client is already scoped to the panel's folder, so file authority stays with the server-resolved folder root (ADR-0050) and the renderer never builds a project-root path for a folder's file. Document and Text share the panel's draft buffer, and switching between them carries the buffer across. The session is reopened each time the panel enters Document, so its revisions reflect any explicit save made in Text.
*Alternative*: route Document through `fileGateway.saveFile`, as Text does. Rejected because that path opens a fresh session on every save and declares no expected revisions, so autosave would lose its conflict check.

**3. Only MDX execution stays project-root bound.** `projectRootFileServices` loses its `documentation` flag. `mdxPreview` stays. Where it is false, `DocumentationEditor` gets no `runtimeClient`, so JSX blocks render as non-executing blocks while the Markdown still edits. Images keep loading through `fileGateway`, which is already folder-scoped.

**4. Autosave belongs to the Document view.** The save registration for the panel is the Document flush while `mode === 'document'` and explicit save otherwise. `handleModeChange` awaits the flush before leaving `document` and stays put on failure (this replaces `viewDocumentSource`). The close flush in `App.tsx` is keyed off the panel's current mode instead of `presentation`.

**5. Opening chooses a view, not a presentation.** `OpenFileOptions.presentation` is removed. The Documentation pane and the link event call `openFile(path)` with no view, so the default (Document) applies. `resolveOpenPresentation` and `presentationForFolder` are deleted. An existing panel with no requested view keeps its mode, which is the current `initialMode` path.

**6. Persisted panels migrate on read.** A restored panel param `presentation: 'documentation'` with no `initialMode` is read as `initialMode: 'document'` (`normalizeFilePanelParams`), and `presentation` is dropped on the next params write. This is a client-side read of an optional param. The server workspace record's optional `presentation` field on file panels, and the matching `PanelUpdateRequest` patch field, stay in the protocol unchanged: no renderer reads or writes them, and removing protocol vocabulary is a separate compatibility decision.

## Risks / Trade-offs

- [Autosave and explicit save on one panel can confuse] → The status bar already reports per-mode save state. Leaving Document flushes first, so Text always starts from a saved base.
- [The Document toolbar above MDXEditor's toolbar costs vertical space] → Accept one row. MDXEditor's own "View source" button goes away, so the net chrome is unchanged.
- [Linked-folder MDX shows components without running them] → Clearer than the current fallback to Preview. Revisit when the MDX runtime becomes folder-aware.
- [E2E specs that click Open as document or View source break] → They are rewritten to select the Document or Text tab, in the same change.

## Migration Plan

Ships as one renderer change. No server or protocol change. Old persisted panels restore on Document (Decision 6). Rollback is a revert. A reverted build ignores the missing `presentation` param and opens panels in the file viewer, which is safe.

## Open Questions

- None blocking. ADR-0050's open item about folder-aware MDX runtime and language intelligence stays open. This change does not need to resolve it.
