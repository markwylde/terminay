## Why

Filesystem, folder, task, and file-viewer services were reached through
Electron-specific IPC and `webContentsId` subscriber ids. Several operations
accepted renderer-supplied paths without one uniform server/project
authorization envelope, and file drafts were not canonical multi-client state.

## What Changes

- Move home/root resolution, listing, search, size, create, rename, delete,
  canonical validation, and watches into server-core.
- Key watches by server, project, resource, and client subscription instead of
  `webContentsId`.
- **BREAKING** Route every file operation through the bounded
  `ServerFileAdapter` protocol commands; each operation revalidates the
  canonical path and the exact server/project/session authorization.
- Make file sessions canonical server state: disk revision, draft revision,
  dirty flag, conflict state, and watch state.
- Publish content-free preview capability metadata and a bounded ranged content
  surface with cancellation, concurrency limits, and a decoded-image pixel cap.
- Stream large text, HEX, image, PDF, and Markdown asset content in sequential
  bounded chunks with resumable offsets.
- Move folder tree/list/gallery data and recursive Markdown task aggregation to
  server commands with deterministic directory ordering and bounded recursion.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `file-explorer-and-folder-tabs`: folder data and Markdown task aggregation
  become bounded server-owned commands with server-side path scoping.
- `file-viewer`: file sessions, drafts, capabilities, and content transfer move
  behind the bounded server file adapter and content-stream contract.

## Impact

`packages/server-core/src/fileService/*` (adapter, tasks, catalog, content),
`FileViewerClient`, `FilePanel` and the shared viewer modes, `FolderPanel`, the
Electron host project-root registration path, and the file test suites
(`file-hardening`, `file-adapter`, `file-tasks`, `file-multi-client`,
`file-transfer-resume`, `file-content-stream`, `file-viewer-client-e2e`).
