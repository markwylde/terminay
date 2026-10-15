## 1. Document as a view mode

- [x] 1.1 Add `'document'` to `FileViewerMode` (`src/types/fileViewer.ts`) and label it "Document" in `FileModeSwitcher`. Verify: `tsc --noEmit` passes, and an exhaustive `MODE_LABELS` record compiles.
- [x] 1.2 In `src/services/fileViewer/capabilities.ts`, make `document` the first primary mode and the default mode for `.md`/`.mdx` only, keeping Preview, Tasks, Text, Diff after it, and leaving `.markdown`/`.mdown`/`.mkd` unchanged. Verify: a unit test asserts tab order and default for `.md`, `.mdx`, `.markdown`, `.ts`, and `.png`.
- [x] 1.3 Let a custom extension default still override, and fall back to the file default when it cannot show the file. Verify: a unit test for a custom `.md` → `text` default.

## 2. FilePanel renders Document inside the file viewer

- [x] 2.1 Always render the file viewer toolbar. Render `DocumentationEditor` when `effectiveMode === 'document'`, and drop the `isDocumentation` branches. Verify: a Markdown panel shows the view switcher above the MDXEditor toolbar.
- [x] 2.2 Remove the **Open as document** button and `DocumentationEditor`'s `onViewSource` / View source control. Verify: grep finds no "Open as document" or "View source" in `src/`, and `openFilePresentation.test.ts` is updated.
- [ ] 2.3 Keep Document's revision-checked session on the panel's folder-scoped `fileViewerClient`, open it whenever the panel enters Document, and carry the shared draft buffer across Document ⇄ Text switches. Keep self-write reconciliation and conflict handling. Verify: `DocumentationAutosaveController.test.ts` passes, and the linked-folder e2e case (3.5) saves to the worktree.
- [x] 2.4 Register the Document flush as the panel save handler while on Document, and explicit save otherwise. `handleModeChange` awaits the flush before leaving Document and stays on Document if it fails. Verify: unit tests for flush-then-switch and for failed flush keeping Document.
- [x] 2.5 Remove the `documentation` flag from `projectRootFileServices`. Pass `runtimeClient` to `DocumentationEditor` only when `mdxPreview` is allowed. Verify: `projectRootFileServices.test.ts` is updated, and `npm run test:linked-folders` passes.

## 3. Opening chooses a view

- [x] 3.1 Remove `presentation` from `OpenFileOptions`, `FilePanelInstanceParams`, and `src/components/file-viewer/types.ts`. Delete `resolveOpenPresentation`, `presentationForFolder`, and `viewDocumentSource`. Verify: `tsc --noEmit` passes, and grep finds no `presentation: 'documentation'`.
- [x] 3.2 The Documentation pane `onOpen` and the `terminay-documentation-open` link handler call `openFile(path)` with no view. Verify: e2e (3.5) shows that both land on Document.
- [x] 3.3 Key `requestClosePanel`'s pre-close flush off the panel's registered save handler or current mode, not `presentation`. Verify: e2e closing a Document panel with a pending edit saves it.
- [x] 3.4 Read a restored panel param `presentation: 'documentation'` (with no `initialMode`) as `initialMode: 'document'`, and drop `presentation` on the next write. Verify: a unit test on the params normaliser.
- [ ] 3.5 Update `e2e/markdown-opens-documentation.spec.ts`, `documentation-sidebar-editor.spec.ts`, `file-explorer-sidebar.spec.ts`, `documentation-zoom.spec.ts`, and `e2e/support/ui.ts` for the Document tab, removing Open as document and View source steps. Add one case: opening a `.md` in a linked worktree folder lands on Document and saves to that worktree. Verify: `npm run test:e2e` passes for these specs.

## 4. Close out

- [x] 4.1 Run `npm run lint`, `npm run test:documentation`, `npm run test:linked-folders`, and the file-viewer unit tests. Verify: all pass.
- [x] 4.2 Run `openspec validate --all`. Verify: no errors.
- [ ] 4.3 Run the app (`/run`) and confirm that AGENTS.md opened from Explorer, the Documentation pane, and a linked folder all land on Document with the formatting toolbar. Verify: a screenshot of each.
