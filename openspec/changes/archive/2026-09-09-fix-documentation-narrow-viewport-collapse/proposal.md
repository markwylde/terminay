## Why

On a phone, opening a Markdown document from the Documentation pane shows a tab, a filename, and a byte count — but no document. The reading canvas and the editor toolbar are both missing, so remote access from an iPhone cannot read or edit project documentation at all.

The Documentation panel's narrow-viewport layout reserves two stacked rows totalling at least 640px of height for an editor/preview split. When a plain Markdown document is open there is no preview and no status notice, so the editor is the panel's only child and lands in the remaining row. On a phone-sized viewport there is no remaining height, the editing surface collapses to zero, and its `overflow: auto` clips every glyph. The layout is width-driven, not engine-driven: it reproduces identically in WebKit and Chromium below 900px, which is why a desktop Safari or Firefox window never shows it.

## What Changes

- The Documentation panel's narrow-viewport stacked layout applies only when a live preview is actually present. A Documentation panel showing the editor alone fills the panel's full height at every viewport size.
- The narrow-viewport separator between the editing surface and the preview is scoped to the same condition, so a preview-less panel gains no orphan border.
- The Documentation panel's reading canvas and toolbar remain visible and scrollable at phone viewport sizes, verified by a regression test at a mobile viewport.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `documentation-sidebar-and-editor`: adds a requirement that the Documentation panel's editing surface occupies the panel's full available height whenever no preview is displayed, at every viewport size, and constrains the stacked narrow-viewport arrangement to the editor-plus-preview case.

## Impact

- `src/components/file-viewer/fileViewer.css` — the `@media (max-width: 900px)` block governing `.documentation-editor` grid rows and the editing-surface separator.
- Documentation panels opened on phones and on narrow desktop windows; no server, protocol, or authority surface is touched.
- Adds regression coverage asserting non-zero editing-surface height at a mobile viewport.
