## 1. Default presentation rule

- [x] 1.1 Add a pure `resolveOpenPresentation(filePath, options, existingPresentation?)` helper beside `openFile`. It returns the explicit presentation if one is given. It returns `file-viewer` if `initialMode` is set. For a new panel it returns `documentation` for `/\.mdx?$/i` and `file-viewer` for anything else. For an existing panel it returns `undefined` (keep the current presentation). Verified by node:test cases covering every branch, including `.MD`/`.Mdx` casing and a `.md.bak` non-match.
- [x] 1.2 Route `openFile` in `src/App.tsx` through the helper, for both new panels and existing panels. Verified by the updated `openFilePresentation.test.ts` and by manual Explorer, Folder tab, and drag-to-tab opens of a `.md` file landing in Documentation.
- [x] 1.3 Run the flush-before-leaving-Documentation step whenever the resolved presentation for an existing Documentation panel is `file-viewer`, including when only `initialMode` is set. Verified by a unit test in which a failing flush leaves the panel in Documentation.

## 2. Presentation toggles

- [x] 2.1 Add an accessible, keyboard-operable **View source** control to the Documentation toolbar (`documentationEditorPlugins.tsx`). It stays reachable through the compact overflow. It awaits the panel's registered save handler and then updates `presentation` to `file-viewer` on the same panel. On a flush failure it stays put and shows the save failure. Verified by a component test for success and failure and by a manual narrow-panel check.
- [x] 2.2 Add an **Open as document** control to the File Viewer toolbar, shown only for `.md`/`.mdx`, that updates `presentation` to `documentation` on the same panel. Verified by a component test that it is present for Markdown and MDX, absent for `.ts`, and keeps the draft and dirty state.

## 3. End-to-end coverage

- [ ] 3.1 Add E2E cases: an Explorer double-click on a `.md` and a `.mdx` file opens the Documentation presentation, and a `.ts` file opens the File Viewer. Verified by `npm run test:e2e` passing.
- [ ] 3.2 Add E2E cases: a Markdown file opened from Git changes opens the File Viewer in Diff mode, and View source followed by an Explorer re-open stays in the File Viewer. Verified by `npm run test:e2e` passing.
- [ ] 3.3 Update any existing E2E test that expected Explorer to open Markdown in the File Viewer. Verified by the full sharded suite passing in Gitea CI with every commit status `success` or `skipped`.

## 4. Validation

- [x] 4.1 Run `openspec validate markdown-opens-documentation-view` and `npm run lint` / typecheck. Verified by clean output.
