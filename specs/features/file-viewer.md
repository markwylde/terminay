# File viewer

## Summary

Terminay opens files from the project explorer into dockable file panels in the
same workspace as terminal and folder panels. File panels support Preview,
Text, HEX, and Diff modes and preserve one shared draft and conflict state
across modes.

Terminay Server owns file identity, metadata, reads, saves, watches, preview
sources, draft coordination, and Git diff generation. Clients render the
appropriate responsive viewer through the application protocol.

## Opening and workspace behaviour

- Double-clicking a file opens it; double-clicking a directory expands or
  collapses it.
- Opening the same canonical path in the same project focuses the existing
  panel instead of creating a duplicate.
- File panels support close, focus, split, drag, reorder, and movement between
  server-owned workspace views.
- Desktop presents view movement through native windows; web clients present it
  in-page.
- Panel movement preserves file identity, view mode, draft, dirty state,
  conflict state, and watch subscription.
- The server validates the path against the exact project and final canonical
  filesystem scope.

## Modes

The available modes are:

- **Preview**
- **Text**
- **HEX**
- **Diff**

Preview is the default. The mode switcher remains visible when Terminay falls
back to another mode and explains why a requested mode is unavailable.

Text and HEX are editable. Preview and Diff are read-only. Switching modes does
not discard a draft.

## Capability detection

The server publishes normalized capabilities derived from path, metadata,
bounded content inspection, project scope, and Git state:

- text-like or binary-like;
- safe preview type;
- Monaco suitability;
- HEX availability;
- Diff availability;
- large-file status; and
- preferred fallback mode.

The client does not infer extra filesystem authority from a filename extension.
Unsupported or unsafe Preview falls back to Text or HEX.

## Preview

Preview supports:

- Markdown;
- images; and
- PDF.

Markdown links and relative assets resolve relative to the file's folder but
remain within the server-authorized content path and normal external-link
policy. Raw HTML and active content are sanitized. Images use bounded decoded
dimensions and fit controls. PDF pages render lazily.

Content too large or unsafe for a full preview uses an incremental path or
falls back explicitly.

## Text

Text mode has two engines:

- **Monaco** for normal files and an explicitly selected rich large-file path;
  and
- **Performant** for ranged, virtualized access.

Monaco provides language detection, syntax highlighting, and standard editing
for a complete bounded text model.

Performant mode:

- reads text in ranges;
- renders visible lines plus bounded overscan;
- supports selection, cursor movement, editing, scrolling, and line numbers;
- does not create one in-memory string for a multi-gigabyte file; and
- reads and writes through the shared draft model.

Incremental decoding preserves character boundaries between ranges and reports
invalid encoding without corrupting the file.

## HEX

HEX mode is a virtualized byte editor with:

- offsets;
- configurable bytes per row;
- hexadecimal and ASCII columns;
- selection and byte editing;
- ranged reads; and
- the shared draft and dirty state.

HEX is the preferred fallback for binary data that cannot be previewed safely.
It renders visible rows plus bounded overscan rather than one DOM node per byte.

## Diff

Diff mode is a read-only, lazy, virtualized HTML viewer. It supports unified and
side-by-side layouts.

The default layout is a server preference shared across clients. Changing it
updates later Diff panels as well as the current panel where practical.

The server:

- determines repository membership;
- obtains the working tree versus `HEAD` diff;
- normalizes hunks into bounded structured rows; and
- reports missing Git, non-repository, binary, too-large, and no-diff states.

Clients do not receive raw Git command output as the rendering contract.

## Large files

Files larger than 100 MB are large.

When a Monaco-backed path is relevant, Terminay asks on each open:

- **Performant**
- **Monaco**

The choice is scoped to that open panel and is not remembered globally.
Performant uses ranged reads and virtualization. Monaco loads a complete
bounded model after the user chooses it. A user can switch from Performant to
Monaco from inside the panel.

All modes apply independent limits for range size, concurrent reads, decoded
image dimensions, Markdown work, diff work, and client memory. Cancellation and
backpressure follow the application protocol.

## Drafts and dirty state

One server-owned file session coordinates the on-disk base revision and draft
edits for the panel. Text and HEX mutate that same draft.

- A clean file matches its confirmed disk revision.
- A dirty file differs from its confirmed disk revision.
- Dirty panels show an accessible dirty indicator.
- Save is available through the File menu and keyboard command.
- Save declares the expected disk revision and writes atomically using a
  temporary file plus replace.
- A successful save advances the base revision and clears dirty state.
- A failed or conflicting save preserves the draft.

Clients can use optimistic local editing, but the server remains authoritative
for the ordered draft revision. A stale client edit receives a conflict or
resync response rather than overwriting newer edits.

This contract coordinates Terminay clients; it is not simultaneous
collaborative text editing.

## Watches and conflicts

- Open clean files are watched on the server.
- An external change to a clean file advances the disk revision and refreshes
  connected clients.
- An external change to a dirty file stops auto-refresh and creates a conflict.
- The conflict banner offers **Reload from disk** and **Keep local edits**.
- Reload discards the draft only after explicit confirmation.
- Keep local edits rebases or retains the draft against the new disk revision
  and requires an explicit later save.
- Rename, delete, atomic replace, temporarily unavailable roots, and watch
  overflow produce distinct recoverable states.
- Closing the final panel releases its watch and bounded draft resources after
  normal close/dirty confirmation.

## Multi-client behaviour

- Every command names the exact server, project, panel/file session, and
  expected revision.
- Connected clients receive ordered disk, draft, save, and conflict events.
- A client reconnects from known revisions or requests a fresh bounded
  snapshot.
- Client disconnect does not discard a server-held dirty draft.
- Another client cannot save, reload, or close a dirty file without the same
  authorization and explicit conflict rules.
- Files with the same path text on different servers or project scopes are not
  the same identity.

## Security

- Filesystem operations use canonical server-side path validation at the final
  operation boundary.
- Symlinks, worktrees, case rules, deleted roots, and replacements are
  revalidated rather than trusted from an earlier client response.
- Preview rendering is sandboxed and does not execute file-provided script.
- File contents and paths never pass through the hosted signaling service.
- Protocol responses are bounded and reveal no data outside the authorized
  project scope.
- Save, reload, delete-related, and conflict actions reject stale or
  cross-server identities.

## Non-goals

- No language-server or IDE contract beyond Monaco's built-in features.
- No editing in Preview or Diff.
- No simultaneous collaborative editing.
- No remembered large-file engine choice.
- No full file-tree redesign.

## Acceptance outcomes

- Opening a file creates or focuses one canonical project-scoped file panel.
- Preview, Text, HEX, and Diff use one shared draft/conflict lifecycle and mode
  switches do not lose edits.
- Large files remain responsive through ranged reads and virtualization.
- Clean external changes refresh automatically; dirty external changes produce
  an explicit conflict without losing the draft.
- A stale save cannot overwrite a newer disk or draft revision.
- Local and remote clients use the same server file contract without direct
  filesystem access.
- Traversal, symlink escape, cross-project, cross-server, oversized, and
  unauthorized requests are rejected.
