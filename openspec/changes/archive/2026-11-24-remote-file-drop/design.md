## Context

`TerminalPanel` handles a terminal drop in three ways today:

1. `terminay/path` data from Terminay's own explorer: a server path, inserted as is.
2. A portable text path: inserted as is.
3. OS files. Desktop asks the preload bridge for each `File`'s native path (`resolveDesktopDroppedFilePath`) and inserts it, whatever server the terminal belongs to. A browser uploads the files through `files.create` into the project root, at most 4 MB each.

A Desktop window can hold terminals from several servers (ADR-0018), and only one of them is the Local embedded server. Desktop's native path is valid only there.

ADR-0023 (clipboard scratch) and ADR-0046 (window attachments) already define how client bytes become a server path. The server owns a named directory under `os.tmpdir()` and chooses every file name. The client supplies bytes and an offered name, never a path. ADR-0046's `AppWindowAttachmentWriter` streams files in ordered parts and removes them if the upload does not complete.

## Goals / Non-Goals

**Goals:**
- A dropped file reaches the shell as a path that is valid on the machine running the PTY, from Desktop and from the browser client.
- Local drops on Desktop stay instant and copy nothing.
- Large files work without either side holding the whole file in memory.

**Non-Goals:**
- Desktop smart paste of copied files or clipboard images into a remote terminal. Electron writes those locally (Desktop clipboard preference order), which has the same problem, but it is a separate change.
- Folder upload.
- Removing delivered drop files. Like attachments, they are left for the OS temporary-file cleaner.

## Decisions

### Where the terminal runs decides the route

The panel uses its server's connection: `isLocalConnection(connection, profiles)`, the same rule that hides server upgrades for Local.

- **Local, on Desktop:** native paths, as before.
- **Otherwise:** files are uploaded, provided the server advertises `terminal-file-drop.v1`.
- **Otherwise:** a visible `[file drop failed: …]` line, and nothing is inserted.

A client-local path is never inserted for a remote terminal. Boundary: renderer code still only sees `File` objects. Native path lookup stays in the preload bridge, and the server owns every write.

### A third named scratch write: `terminay-drops`

Each drop gets its own directory `terminay-drops/<random>/` (mode 0700), and each file keeps a sanitised form of its original name (`keptAttachmentName`). Sanitising keeps the name readable and its extension recognisable to tools such as coding agents. Because each drop has its own directory, two files with the same name in different drops cannot collide.

The writer is ADR-0046's `AppWindowAttachmentWriter`, given a configurable part size. Drops use 1 MiB parts, which stay well within the 8 MiB frame body and take fewer round trips than attachments' 256 KiB parts. Boundary: like ADR-0023, the operation accepts names and bytes, never a destination.

### Operations, authorisation and lifetime

`terminal.drop-begin` takes `{ identity, files: [{ name, size }] }`, at most 64 files per drop. It is authorised exactly like `terminal.materialize-clipboard-image`: write scope, project claim, and a live session matching the identity. It returns an `uploadId`.

`terminal.drop-part` takes `{ uploadId, file, offset }` with a body. `terminal.drop-finish` takes `{ uploadId }` and returns `{ paths }`. `terminal.drop-cancel` takes `{ uploadId }`.

An upload belongs to the connection and client that began it. A part, finish or cancel from anyone else is refused as `not_found`. Any invalid part aborts the upload and removes what was written. Each connection may have at most 4 uploads in progress. An upload with no part for 2 minutes is aborted, so a client that disappears mid-drop does not leave partial files behind.

### Client

`TerminayTerminalClient.uploadDroppedFiles(identity, files, readPart, { signal, onProgress })` mirrors `sendMessageWithAttachments`. It reads one part at a time from `File.slice()` and cancels on any failure or abort.

The panel shows an "Uploading N%" indicator with Stop, in the same position and style as the paste indicator. A `File` entry that is a directory is detected through `webkitGetAsEntry()` during the drop event, because it is not available afterwards, and refused.

## Risks / Trade-offs

- **No size cap:** a very large drop fills the server's temporary directory. This is mitigated by the visible progress and the Stop control, and is the same trade-off ADR-0046 accepted.
- **Removing the project-root browser upload:** a browser user who relied on drops landing in the project now gets a temp path. The file explorer's own upload remains the way to add a file to a project.
- **A Desktop window whose Local profile cannot be identified** is treated as remote and uploads. That is slower but correct. The reverse mistake, inserting a local path into a remote shell, is what this change exists to prevent.
