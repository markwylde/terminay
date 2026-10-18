## 1. Tests first

- [x] 1.1 Extend `e2e/documentation-sidebar-editor.spec.ts` to type into the rich text straight after switching from diff, and to type into an admonition before switching to source, then read both off disk in one save, with no held-clock wait after the change of views. Verified by the case failing through `npm run test:e2e` against the timer (`info: false, edit: false` after the 5 s poll).
- [x] 1.3 Add `Documentation does not rewrite a document whose views were only changed` to the same file: an empty admonition, every view, then the held renderer clock run past the autosave delay. Verified by the file being unchanged and the panel clean.
- [x] 1.2 Add `src/components/file-viewer/documentationEditorChanges.test.ts` for each scenario in the delta spec: an edit straight after a change of views, a respelling inside one, nested-editor text carried by one, a respelling outside one, the opening normalization, a loaded document, and an uncomparable report. Verified by `npm run test:documentation` passing.

## 2. Implementation

- [x] 2.1 Add `createDocumentationEditorChanges` and `sameMarkdownDocument` in `src/components/file-viewer/documentationEditorChanges.ts`. Verified by the cases from 1.2.
- [x] 2.2 Add `documentComparisonPlugin` to `createDocumentationEditorPlugins`, comparing with the editor's own syntax and mdast extensions. Verified in the E2E harness: switching views over an empty admonition left the file unchanged.
- [x] 2.3 Replace the 250 ms timer in `DocumentationEditor.tsx` with a click-scoped change of views. Verified by the case from 1.1 passing three times in a row with `--retries=0`.

## 3. Validation

- [x] 3.1 Run `openspec validate --all`. Verified by it passing.
- [x] 3.2 Run `npm run lint` and `npx tsc -p tsconfig.json --noEmit`. Verified by both passing.
- [ ] 3.3 Open a pull request on `origin` and read back every commit status. Verified by each status being `success` or `skipped`.
