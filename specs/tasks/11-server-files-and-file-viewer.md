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
- [ ] Preserve large-content safeguards across the full viewer transfer path.
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
- [ ] Stream image, PDF, Markdown asset, HEX, and large-text content with type,
  size, path, byte, concurrency, and decoded-resource caps.
- [ ] Preserve Monaco and Performant text, HEX, Preview, and shared-draft
  behaviour in the client.
- [ ] Implement or verify the performant editor, virtualized surfaces, and
  large-file chooser required by the feature contract.
- [ ] Keep mode/capability decisions deterministic and server-authorized.

### Folder panels and tasks

- [ ] Move tree/list/gallery data and recursive Markdown task aggregation to
  server commands.
- [ ] Preserve sorting, navigation, metadata, previews, ignored directories,
  progress, search, filtering, and grouping.
- [x] Bound recursion, file count, content bytes, and concurrent work in the
  server-owned Markdown aggregation (`packages/server-core/test/file-tasks.test.mjs`).

### Tests

- [ ] Run file explorer, folder, and file-viewer E2E through
  `TerminayClient`.
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
