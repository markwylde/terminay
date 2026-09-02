## 1. Correct the narrow-viewport grid

- [x] 1.1 In `src/components/file-viewer/fileViewer.css`, scope the `@media (max-width: 900px)` grid rules to `.documentation-editor--with-preview`, adding the status row via the compound selector `.documentation-editor--with-preview.documentation-editor--with-status`, so a Documentation panel without a preview inherits the base single-row template at every width. Verified by reading back the media block and confirming no rule inside it targets bare `.documentation-editor`.
- [x] 1.2 In the same media block, scope the editor-to-preview separator to `.documentation-editor--with-preview .documentation-editor__surface`, so a preview-less panel draws no orphan bottom border. Verified by reading back the rule's selector.
- [x] 1.3 Confirm the reading-canvas rules in the `900px` and `560px` media blocks still apply to every Documentation panel — they tighten type and margins and are correct regardless of preview. Verified by reading back both blocks and confirming those selectors are unchanged.
- [x] 1.4 Run `npx biome lint src/components/file-viewer/fileViewer.css` (or `npm run lint`) and confirm it passes.

## 2. Regression coverage

- [ ] 2.1 Add a case to `e2e/documentation-sidebar-editor.spec.ts` that opens a Markdown document, resizes the window to a phone-sized viewport (390 wide, ~660 tall), and asserts `.documentation-editor__surface` has a bounding-box height that is a substantial fraction of `.documentation-editor`'s height — not a fixed pixel count, so typography changes do not churn it. Verified by the assertion failing when the fix in task 1.1 is reverted.
- [ ] 2.2 Assert in the same case that the editor toolbar and the rendered heading of the opened document are visible at that viewport. Verified by the assertions passing with the fix and failing without it.
- [ ] 2.3 Run the suite through `npm run test:e2e` — never Playwright's Electron suite directly on the host — and confirm the new case and the existing Documentation cases pass.

## 3. Confirmation and closeout

- [ ] 3.1 Confirm on the reporting iPhone, over remote access, that opening a Markdown document from the Documentation pane now shows the toolbar and document body. Verified by a screenshot from the device showing rendered content where the panel was previously blank.
- [ ] 3.2 Confirm at a narrow desktop window (under 900px) with an `.mdx` document that the editor and live preview still stack vertically with usable height and a visible boundary between them. Verified by observation in the running app.
- [ ] 3.3 Confirm at desktop width that the editor-plus-preview side-by-side layout and the editor-only layout are unchanged. Verified by observation in the running app.
