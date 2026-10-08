## 1. Server classification

- [x] 1.1 Add `html` to `FileCatalogPreviewKind` and classify `.html`, `.htm`, and `.xhtml` text as `html` in `classifyPreview`; add `xhtml` to the MIME table. Verified by new cases in `packages/server-core/test/file-catalog.test.mjs` asserting `previewKind: 'html'`, `isBinary: false`, and `canEditText: true` for all three extensions.
- [x] 1.2 Count `html` as a safe preview within `maxPreviewBytes` and prefer Preview for it. Verified by catalog tests asserting `safePreview: true` and `preferredMode: 'preview'` under the limit, and `previewKind: 'text'` with `preferredMode: 'text'` over it.
- [x] 1.3 Keep binary content with an HTML extension out of the `html` kind. Verified by a catalog test feeding NUL bytes under `page.html` and asserting `previewKind: 'hex'`.
- [x] 1.4 Publish `html` only to a client that asks for it: an older workspace bundle rejects a snapshot whose preview kind it does not know. The capability request carries `options.acceptPreviewKinds: ['html']`; a request without it is answered `text`. Verified by a test in `packages/server-core/test/file-catalog-adapter.test.mjs` covering the older-client case and by `packages/client-core/test/file-viewer.test.mjs` asserting the option is sent.

## 2. Client capabilities

- [x] 2.1 Add `html` to `FilePreviewKind`, and to `detectPreviewKind` for the three extensions when no server capabilities are present. Verified by cases in `scripts/file-viewer-view-modes.test.mjs`.
- [x] 2.2 List Preview before Text for the `html` kind in `resolveViewModes` and let `defaultMode` follow the server's `preferredMode`. Verified by view-mode tests asserting `primaryModes` starts `['preview', 'text']` and `defaultMode` is `'preview'` for an HTML file.
- [x] 2.3 Do not upgrade a file to `html` from its extension when the server published another kind. Verified by a view-mode test passing `viewerCapabilities.previewKind: 'text'` for `index.html` and asserting the resolved kind stays `text`.

## 3. Shared sandbox frame

- [x] 3.1 Export the proxy's message names (`sandbox-resource-ready`, the proxy key) from `appViewAvailability.ts` beside the URL, sandbox attribute, and probe, for the HTML preview to use. `AppWindowHost.tsx`, `AppWindowMirror.tsx`, and `public/app-view.html` are left as they are. Verified by `appViewAvailability.test.ts`, `viewBridge.test.ts`, and `viewDocument.test.ts` passing, and those three files being unchanged against `main`.
- [x] 3.2 Add a `file` view source to `viewDocument.ts` with the fixed no-network policy from design decision 3 and an empty `allow` attribute. Verified by `viewDocument.test.ts` cases asserting the exact policy string, that declared origins are ignored for a `file` source, and that no permission feature is granted.

## 4. Document builder

- [x] 4.1 Create the HTML preview document builder: scan the draft's start tags without running or parsing it into a tree, collect references from the element and attribute set in design decision 2, and classify each as relative, root-relative, or external. Verified by unit tests over a fixture page covering every listed element, `srcset`, and `//` and scheme-prefixed URLs.
- [x] 4.2 Resolve relative references against the file's project-relative folder and root-relative ones against the project root, read each through the file gateway's bounded reads, and rewrite to `data:` URLs with a MIME type from a fixed extension table. Verified by unit tests with a fake gateway asserting the paths requested and the rewritten output.
- [x] 4.3 Resolve `url()` and `@import` in inline styles and fetched stylesheets, relative to the stylesheet's own folder, to `@import` depth 4. Verified by unit tests including a nested import and an import cycle.
- [x] 4.4 Enforce the bounds — 200 resources, 16 MB total, 4 MB per resource, bounded read concurrency — and report when any reference was left unresolved. Verified by unit tests that exceed each bound and assert the remaining references are untouched and the `incomplete` flag is set.
- [x] 4.5 Leave a reference unresolved when its read is refused or fails, without failing the build. Verified by a unit test whose fake gateway rejects `../../outside/secret.css` and asserts the rest of the page is built.
- [x] 4.6 Strip `<base>` and `<meta http-equiv>` for `Content-Security-Policy` and `refresh`, and inject the anchor-interception script. Verified by unit tests asserting their absence and the script's presence in the output.

## 5. Preview component

- [x] 5.1 Add `preview/HtmlPreview.tsx` and the `html` case in `PreviewViewer.tsx`, rendering the built document in the shared sandbox frame. Verified by an e2e case in `e2e/file-viewer-modes.spec.ts` that opens `index.html` from the sidebar and asserts Preview is selected and the frame shows the page's heading.
- [x] 5.2 Rebuild 300 ms after a draft change and swap in a fresh proxy frame once it reports ready; keep fetched resources cached while Preview is mounted. Verified by an e2e case that edits the file in Text, returns to Preview without saving, and sees the new text; and by a unit test asserting a second build with an unchanged resource makes no further gateway read.
- [x] 5.3 Show "Some resources were not loaded" when the builder reports an incomplete build, and "The page navigated away" with a Reload action when the proxy removes the frame. Verified by e2e cases using a fixture that references stylesheets that cannot be loaded and a fixture whose script sets `location`.
- [x] 5.4 Handle open-link requests from the frame: accept only credential-free `http:` and `https:` URLs, only with user activation reported by the proxy, and open through the existing external-link policy. The workspace also checks its own browser's user activation. Verified by unit tests on the request handler covering a credentialed URL, a `file:` URL, and a request with no activation.
- [x] 5.5 When the proxy probe fails, show the Preview tab disabled with the reason and open the file in Text. Verified by a unit test of the mode resolution with the probe forced false.

## 6. Security verification

- [x] 6.1 Prove page script runs and is confined: a fixture whose script writes to the DOM, then tries `parent.document`, `localStorage`, and `fetch('https://example.invalid')`. Verified by an e2e case asserting the DOM write happened and each of the three attempts failed.
- [x] 6.2 Prove an external resource does not load and a project-relative one does. Verified by an e2e case with a fixture referencing `./style.css` and an `https://` stylesheet, asserting the computed style from the first and no request for the second.
- [x] 6.3 Prove a reference escaping the project scope does not load. Verified by an e2e case with a fixture referencing a file outside the project root and asserting its content is absent.
- [x] 6.4 Confirm `webviewTag` is still `false` everywhere and no `will-attach-webview` denial was removed. Verified by `electron/` being unchanged against `main`.

## 7. Wrap-up

- [x] 7.1 Run `npm run test:ci` and `npm run test:e2e`. Verified by both exiting zero.
- [x] 7.2 Run `openspec validate --all`. Verified by it reporting no errors.
- [x] 7.3 Open the pull request on `origin` with `tea` and read back the commit statuses. Verified by every status on the head SHA being `success` or `skipped`.
