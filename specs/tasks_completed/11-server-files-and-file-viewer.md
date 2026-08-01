# Server files and file viewer

## Goal

Move filesystem, folder, task, and file-viewer services behind the server
protocol while preserving path safety, drafts, conflicts, watches, and bounded
large-content behaviour.

## Governing specifications

- [File explorer and folder tabs](../features/file-explorer-and-folder-tabs.md)
- [File viewer](../features/file-viewer.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Why this is active

Filesystem services are reached through Electron-specific IPC and subscriber
ids. Several operations accept renderer paths without one uniform
server/project authorization envelope, and file drafts are not yet canonical
multi-client state.

## Dependencies

- [Standalone and embedded server runtime](./6-standalone-and-embedded-server-runtime.md)
- [Server-owned workspace model](./5-server-owned-workspace-model.md)

## Work slices

### Filesystem and watches

- [x] Move home/root resolution, list, search, size, create, rename, delete,
  canonical validation, and watches into server-core.
- [x] Key watches by server/project/resource and client subscription rather
  than `webContentsId`.
- [x] Preserve symlink, case, atomic-save, missing-root, and ignore-pattern
  safeguards at the final server boundary (`file-hardening.test.mjs`).
- [x] Preserve large-content safeguards across the full viewer transfer path.
  Server file/content, adapter, session, and resume fixtures pass alongside
  the performant viewer/draft/diff suites (37 + 17 tests), covering bounded
  ranges, previews, HEX, UTF-8 paging, cancellation, and sparse edits.
- [x] Add bounded pagination/chunks, cancellation, deduplication, and overflow
  resync.

### File sessions and drafts

- [x] Implement canonical file session, disk revision, draft revision, dirty,
  conflict, and watch state.
- [x] Expose canonical, bounded file-session metadata (including optional host
  metadata, ordered revisions, and conflict state) without returning content.
- [x] Move metadata, ranged bytes/text, atomic save, reload, and keep-local
  operations behind the bounded `ServerFileAdapter` protocol commands; each
  operation revalidates the canonical path and exact server/project/session
  authorization (`packages/server-core/src/fileService/adapter.ts`, covered by
  `file-adapter.test.mjs`).
- [x] Prevent a stale client or external change from being overwritten
  silently.
- [x] Retain dirty drafts through client disconnect and release them only
  through documented panel lifecycle.

### Viewer data

- [x] Publish bounded, canonical preview capability metadata for text,
  Markdown, image, PDF, binary/HEX fallback, and large-file mode selection
  without returning content bytes.
- [x] Provide a canonical bounded content surface for ranged text/HEX reads
  and capped Markdown/image/PDF preview bytes, with typed size/path offsets,
  cancellation, concurrent-read limits, and an explicit decoded-image pixel
  cap.
- [x] Stream image, PDF, Markdown asset, HEX, and large-text content with type,
  size, path, byte, concurrency, and decoded-resource caps. The shared
  `FileViewerClient.openContentStream` surface provides sequential bounded
  chunks, resumable offsets, cancellation, contiguous-response validation, and
  server-authorized decoded-image limits; client and server content-stream
  suites cover the transfer path.
- [x] Preserve Monaco and Performant text, HEX, Preview, and shared-draft
  behaviour in the client. `FilePanel` renders the shared viewer modes through
  server-authorized capabilities, the focused shared-client/draft tests cover
  fallback and sparse-to-Monaco preservation, and existing file-viewer E2E
  suites cover Monaco, Preview, HEX, and large-file Performant behaviour.
  - [x] FilePanel disables server-denied modes and resolves an unavailable
    requested mode to the server-authorized fallback (`capabilities.ts`,
    `scripts/file-viewer-shared-client.test.mjs`).
  - [x] Switching a Performant sparse text draft into Monaco materializes the
    edited projection and preserves its dirty state
    (`src/components/file-viewer/modes/sharedDraftTransition.ts`,
    `scripts/file-viewer-draft.test.mjs`).
- [x] Implement or verify the performant editor, virtualized surfaces, and
  large-file chooser required by the feature contract. Monaco is now bounded
  to the shared 128 MiB rich-editor budget; larger text files resolve directly
  to the ranged Performant viewer, with chooser-boundary coverage in
  `scripts/file-viewer-shared-client.test.mjs`; `FileLargeFileChooser`,
  `PerformantTextViewer`, `HexViewer`, and the large-file E2E suite cover the
  rendered chooser and virtualized surfaces.
  - [x] Bound Monaco engine selection and force oversized text files to the
    ranged Performant engine (`capabilities.ts` and the shared-client chooser
    boundary regression).
- [x] Keep mode/capability decisions deterministic and server-authorized. The
  production `FilePanel` metadata path now consumes validated
  `FileViewerClient.getCapabilities` results; `file-viewer-shared-client.test.mjs`
  proves the server preference controls the resulting viewer mode.

### Folder panels and tasks

- [x] Move tree/list/gallery data and recursive Markdown task aggregation to
  server commands. The embedded server now registers canonical project roots
  and exposes `files.list` / `files.tasks`; FolderPanel uses the connected
  `FileViewerClient` rather than renderer-side directory recursion. The real
  Electron folder-panel suite covers tree/list/gallery, recursive tasks,
  sorting, grouping, refresh, and context menus (4/4).
- [x] Route the production Folder Tasks aggregation call through the connected
  `FileViewerClient` `files.tasks` query instead of renderer-side recursive
  `listDirectory` plus per-file Markdown reads. The Electron host registers
  the project root with the embedded server before each scoped request;
  `e2e/folder-panel.spec.ts` proves the live Electron route.
- [x] Apply deterministic directory ordering before bounded recursive Markdown
  task aggregation (`packages/server-core/src/fileService/tasks.ts` and
  `packages/server-core/test/file-tasks.test.mjs`), so partial results do not
  depend on host directory enumeration order.
- [x] Preserve sorting, navigation, metadata, previews, ignored directories,
  progress, search, filtering, and grouping. The real Electron folder-panel
  suite covers view modes, metadata/preview opening, navigation, refresh,
  directory-size output, ignored directories, recursive task updates,
  filtering/search, Kanban/list grouping, sorting, and context-menu actions
  (4/4).
- [x] Bound recursion, file count, content bytes, and concurrent work in the
  server-owned Markdown aggregation (`packages/server-core/test/file-tasks.test.mjs`).

### Tests

- [x] Run file explorer, folder, and file-viewer E2E through
  `TerminayClient` (`packages/server-core/test/file-viewer-client-e2e.test.mjs`).
- [x] Add bounded server-core two-client edit/save/watch/conflict/reconnect
  coverage (`file-multi-client.test.mjs`); full TerminayClient/E2E parity
  remains open.
- [x] Test traversal, symlink escape, case aliases, atomic replacement, deleted
  roots, stale revisions, and cancellation (`file-hardening.test.mjs`,
  `file-adapter.test.mjs`, and existing catalog/content/session tests).
- [x] Test interrupted bounded transfers and reconnect/resume behavior for
  file content (`file-transfer-resume.test.mjs`); a stale watch cursor forces
  a bounded restart from offset zero.
- [x] Exercise bounded large text, binary/HEX, image, PDF, Markdown, and
  malformed UTF-8 inputs (`file-content-stream.test.mjs` and existing
  catalog-preview coverage).

## Acceptance checks

- Embedded and standalone servers provide the same file UI without Electron
  filesystem IPC.
- A stale remote save cannot overwrite newer disk or draft state.
- Dirty drafts survive client disconnect and resync.
- Large files use bounded ranged transfer without blocking terminal control.
- Cross-project, traversal, symlink-escape, oversized, and unauthorized
  operations are rejected on the server.

## Definition of done

Terminay Server is the only filesystem and file-session authority, and local
and remote clients use one safe bounded file contract.
