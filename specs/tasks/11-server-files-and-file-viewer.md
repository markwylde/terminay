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

- [ ] Move home/root resolution, list, search, size, create, rename, delete,
  canonical validation, and watches into server-core.
- [ ] Key watches by server/project/resource and client subscription rather
  than `webContentsId`.
- [ ] Preserve symlink, case, atomic-save, missing-root, ignore-pattern, and
  large-content safeguards.
- [ ] Add bounded pagination/chunks, cancellation, deduplication, and overflow
  resync.

### File sessions and drafts

- [ ] Implement canonical file session, disk revision, draft revision, dirty,
  conflict, and watch state.
- [ ] Move metadata, ranged bytes/text, decoding, preview source, atomic save,
  reload, and keep-local operations behind protocol commands.
- [ ] Prevent a stale client or external change from being overwritten
  silently.
- [ ] Retain dirty drafts through client disconnect and release them only
  through documented panel lifecycle.

### Viewer data

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
- [ ] Bound recursion, file count, content bytes, and concurrent work.

### Tests

- [ ] Run file explorer, folder, and file-viewer E2E through
  `TerminayClient`.
- [ ] Add two-client edit/save/watch/conflict/reconnect tests.
- [ ] Test traversal, symlink escape, case aliases, atomic replacement, deleted
  roots, stale revisions, interrupted transfer, and cancellation.
- [ ] Exercise large text, binary, image, PDF, Markdown, and malformed inputs.

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
