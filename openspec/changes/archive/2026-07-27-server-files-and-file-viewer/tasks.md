## 1. Filesystem and watches

- [x] 1.1 Move home/root resolution, list, search, size, create, rename, delete, canonical validation, and watches into server-core and verify through the server-core filesystem suites
- [x] 1.2 Key watches by server/project/resource and client subscription rather than `webContentsId`, verified by watch delivery across a renderer reload
- [x] 1.3 Preserve symlink, case, atomic-save, missing-root, and ignore-pattern safeguards at the final server boundary, verified by `file-hardening.test.mjs`
- [x] 1.4 Preserve large-content safeguards across the full viewer transfer path, verified by the server file/content, adapter, session, and resume fixtures alongside the viewer/draft/diff suites (37 + 17 tests) covering bounded ranges, previews, HEX, UTF-8 paging, cancellation, and sparse edits
- [x] 1.5 Add bounded pagination/chunks, cancellation, deduplication, and overflow resync, verified by the bounded transfer tests

## 2. File sessions and drafts

- [x] 2.1 Implement canonical file session, disk revision, draft revision, dirty, conflict, and watch state, verified by the file-session suite
- [x] 2.2 Expose canonical bounded file-session metadata (optional host metadata, ordered revisions, conflict state) without returning content, verified by the metadata response tests
- [x] 2.3 Move metadata, ranged bytes/text, atomic save, reload, and keep-local behind the bounded `ServerFileAdapter` protocol commands with per-operation path and authorization revalidation, verified by `file-adapter.test.mjs`
- [x] 2.4 Prevent a stale client or external change from overwriting newer state silently, verified by the stale-revision conflict tests
- [x] 2.5 Retain dirty drafts through client disconnect and release them only through the documented panel lifecycle, verified by the multi-client disconnect tests

## 3. Viewer data

- [x] 3.1 Publish bounded canonical preview capability metadata for text, Markdown, image, PDF, binary/HEX fallback, and large-file mode selection without returning content bytes, verified by the capability tests
- [x] 3.2 Provide a canonical bounded content surface for ranged text/HEX reads and capped Markdown/image/PDF preview bytes with typed size/path offsets, cancellation, concurrent-read limits, and a decoded-image pixel cap, verified by the content suites
- [x] 3.3 Stream image, PDF, Markdown asset, HEX, and large-text content through `FileViewerClient.openContentStream` with sequential bounded chunks, resumable offsets, cancellation, contiguous-response validation, and server-authorized decoded-image limits, verified by the client and server content-stream suites
- [x] 3.4 Preserve Monaco, Performant text, HEX, Preview, and shared-draft behaviour in `FilePanel` through server-authorized capabilities, verified by the shared-client/draft tests and the existing file-viewer E2E suites
- [x] 3.5 Disable server-denied modes and resolve an unavailable requested mode to the server-authorized fallback, verified by `capabilities.ts` and `scripts/file-viewer-shared-client.test.mjs`
- [x] 3.6 Materialize the edited projection and preserve dirty state when a Performant sparse text draft switches into Monaco, verified by `scripts/file-viewer-draft.test.mjs`
- [x] 3.7 Bound Monaco engine selection to the shared 128 MiB rich-editor budget and force oversized text files to the ranged Performant engine, verified by the shared-client chooser boundary regression
- [x] 3.8 Keep mode/capability decisions deterministic and server-authorized through validated `FileViewerClient.getCapabilities` results, verified by `file-viewer-shared-client.test.mjs`

## 4. Folder panels and tasks

- [x] 4.1 Move tree/list/gallery data and recursive Markdown task aggregation to the `files.list` / `files.tasks` server commands, verified by the Electron folder-panel suite (4/4)
- [x] 4.2 Route the production Folder Tasks aggregation through the connected `FileViewerClient` `files.tasks` query with host-side project-root registration, verified by `e2e/folder-panel.spec.ts`
- [x] 4.3 Apply deterministic directory ordering before bounded recursive aggregation, verified by `packages/server-core/test/file-tasks.test.mjs`
- [x] 4.4 Preserve sorting, navigation, metadata, previews, ignored directories, progress, search, filtering, and grouping, verified by the Electron folder-panel suite
- [x] 4.5 Bound recursion, file count, content bytes, and concurrent work in the server-owned aggregation, verified by `file-tasks.test.mjs`

## 5. Tests

- [x] 5.1 Run file explorer, folder, and file-viewer E2E through `TerminayClient`, verified by `file-viewer-client-e2e.test.mjs`
- [x] 5.2 Add bounded server-core two-client edit/save/watch/conflict/reconnect coverage, verified by `file-multi-client.test.mjs` (full client E2E parity remains open)
- [x] 5.3 Test traversal, symlink escape, case aliases, atomic replacement, deleted roots, stale revisions, and cancellation, verified by `file-hardening.test.mjs` and `file-adapter.test.mjs`
- [x] 5.4 Test interrupted bounded transfers and reconnect/resume, verified by `file-transfer-resume.test.mjs`
- [x] 5.5 Exercise bounded large text, binary/HEX, image, PDF, Markdown, and malformed UTF-8 inputs, verified by `file-content-stream.test.mjs`
