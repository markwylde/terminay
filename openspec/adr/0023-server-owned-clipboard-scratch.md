# ADR-0023: Materialise browser clipboard images in a server-owned scratch directory

Status: accepted
Date: 2026-09-15

## Context

ADR-0011 keeps server filesystem and Git services inside the selected project
root: the catalog revalidates canonical paths at mutation time, and
`files.create` cannot write outside that root. Browser file drop uses that
path, so a dropped file lands in the project.

A terminal paste of a screenshot wants the opposite. The file has to exist on
the machine that owns the PTY (ADR-0017), but it must not appear in `git
status`. Desktop already writes Electron clipboard images under
`app.getPath('temp')/terminay-clipboard/`. A browser client has no local path
the PTY can open, and a client-supplied absolute path would be a renderer-
chosen write — the failure mode ADR-0011 exists to prevent.

## Decision

1. **Clipboard images from a browser are written by Terminay Server into a
   directory it owns**, `terminay-clipboard` under `os.tmpdir()` (typically
   `/tmp/terminay-clipboard` on Unix). The server chooses the file name. The
   command returns the absolute path; the client inserts that path into the
   terminal.
2. **This is not a catalog write.** `files.create` and the project-root
   invariant stay as ADR-0011 specified. The new command accepts bytes and a
   MIME type, never a destination path, and refuses to write anywhere else.
3. **The bound is the command, not the directory.** Size and type limits live
   on the operation. Future paste or media features may reuse the directory;
   they do not inherit a general `/tmp` write.

## Consequences

- A remote or phone session pastes a path that is valid in that server's
  shell, not on the client device.
- Screenshots do not dirty the project. Operators accept scratch files in
  tmp until the OS cleaner removes them.
- A reviewer looking at filesystem mutations has two buckets: project-scoped
  catalog operations, and this named scratch write. There is still no
  client-chosen absolute path.
