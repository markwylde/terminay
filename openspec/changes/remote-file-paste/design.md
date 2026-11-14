## Context

ADR-0113 routes a File drop by where the terminal runs: native paths only on this machine's Local server, otherwise a streamed upload into the server's `terminay-drops`. Desktop paste predates it. `readTerminalClipboard` in Electron main resolves a copied file's `text/uri-list` to native paths, and an image to a PNG in this machine's temporary directory, and returns shell-ready text whatever the terminal's server.

## Goals / Non-Goals

**Goals:** a Desktop paste into a remote terminal inserts only paths valid on that terminal's server. Local behaviour is unchanged.

**Non-Goals:** pasting folders; any server or protocol change; browser paste, which already has no local paths.

## Decisions

### The panel chooses the route, as for a drop

The panel already knows whether its server is Local (`fileDropRouteRef.resolveNativePath`). Local keeps the existing shell-ready read. Otherwise the panel uses a second Electron read that answers `files` (names and sizes), `folder`, `text`, `image` (PNG bytes) or `empty`.

### Files are named, not pathed, and read back by token

Electron keeps the copied paths of its latest read and gives the renderer an opaque token. The renderer reads parts by token, file index, offset and length, each at most 1 MiB, the client's part size. A later read retires the token. The renderer never learns a local path and cannot name an arbitrary file. A `text/uri-list` is treated as files only when every entry is a local file URL; otherwise it falls through to text.

### One upload path for drop and paste

The drop's upload, indicator, Stop control and failure reporting move into one panel helper that both use. Clipboard files are adapted to the drop's sliceable source shape, so `uploadTerminalDropFiles` and `TerminayTerminalClient.uploadDroppedFiles` are reused unchanged. An image goes through `materializeClipboardImage`, as a browser paste does.

## Risks / Trade-offs

- A file that changes between the read and the upload may upload short or fail; the server removes partial drops, and the failure is shown.
- Only one paste or drop uploads at a time per terminal, as before.
