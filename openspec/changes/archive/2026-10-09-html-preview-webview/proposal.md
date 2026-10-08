## Why

Opening an HTML file from the sidebar gives a file panel with a Text tab and a
Preview tab, and the Preview tab shows the same source again, only
syntax-highlighted. There is no way to see the page the file describes without
leaving Terminay for a browser. `.xhtml` fares worse: the server does not
recognise the extension, so it is treated as text of unknown type.

Underneath, the server's file catalog has no HTML preview kind — `.html` and
`.htm` classify as plain text — and the file viewer's security contract forbids
any previewed content from running script, which rules out rendering a real
page.

## What Changes

- The Preview tab of an `.html`, `.htm`, or `.xhtml` file renders the page in a
  webview: a sandboxed, opaque-origin frame inside the same proxy document that
  app views already run in (ADR-0038). It works the same on Terminay Desktop and
  in a remote browser client.
- The page's own JavaScript runs inside that sandbox. It has no Terminay
  authority: no preload, no host IPC, no protocol access, no Terminay storage.
- The page can load other project files it references by relative path —
  stylesheets, scripts, images, fonts, media — within the server-authorized
  project scope. It has no network access; an external resource does not load.
- Preview follows the live draft: edits made in Text appear in Preview after a
  short debounce, without saving.
- An HTML file opens in Preview first, with Text one tab away.
- **BREAKING** The rule that Preview never executes file-provided script is
  narrowed. It still holds for Markdown, image, PDF, and text previews; an HTML
  preview runs the page's script, confined to the sandbox.
- A host on which the sandbox proxy cannot be framed shows the HTML Preview as
  unavailable, with the reason, and opens the file in Text. Isolation is never
  weakened to make a page render.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-viewer`: adds an HTML preview kind published by the server; Preview
  renders HTML in a sandboxed webview with project-relative resources and no
  network; HTML files open in Preview; the "no file-provided script" security
  rule gains a bounded exception for HTML preview.

## Impact

- `packages/server-core/src/fileService/catalog.ts` — `html` preview kind for
  `.html`, `.htm`, `.xhtml`; `xhtml` in the MIME table; Preview as the preferred
  mode for a safely previewable HTML file.
- `src/types/fileViewer.ts`, `src/services/fileViewer/capabilities.ts` — the
  `html` preview kind, its default view, and the client-side fallback
  classification.
- `src/components/file-viewer/modes/PreviewViewer.tsx`, a new
  `preview/HtmlPreview.tsx`, and a document builder that inlines
  project-relative resources read through the file gateway.
- `src/workspace/appWindows/` — the proxy availability probe and the view
  document's content security policy are reused; the parts an HTML preview needs
  are lifted out of `AppWindowHost.tsx` so both callers share them.
- `public/app-view.html` — unchanged in contract; reused as the frame host.
- `openspec/adr/` — a new ADR extending the ADR-0038 sandbox to file previews.
- Tests: `packages/server-core/test/file-catalog.test.mjs`, unit tests for the
  document builder and capabilities, and an Electron end-to-end spec.
- No new protocol method: resources are read with the existing bounded file
  reads. `previewKind` gains one value, `html`.
