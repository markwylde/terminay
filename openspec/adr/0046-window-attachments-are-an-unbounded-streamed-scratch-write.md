# ADR-0046: Window message attachments are a streamed scratch write with no size limit, and Terminay does not remove them

Status: accepted
Date: 2026-10-07

## Context

A person answering an agent in an app window (ADR-0037) could reply with text
only. To hand the agent a photo or a file, the bytes must exist on the machine
that owns the PTY (ADR-0017), and the view that offers them is untrusted
(ADR-0038).

ADR-0023 set the pattern for bytes that arrive from a client and must become a
path: the server writes them into a scratch directory it owns, chooses the name,
and never accepts a destination. It also said the bound lives on the command and
that a later feature does not inherit a general temporary-directory write.

The owner decided on 2026-10-07 that attachments have no size cap, that a large
one is warned about, that any type is allowed, and that files are not removed
when the terminal session ends.

## Decision

1. **Attachments travel only as part of a window message.** There is no upload
   without a message, so the gesture rule, the presentation lease, and the
   Window Messages policy all apply before a byte is sent.
2. **The server writes each attachment into its own named scratch directory**,
   `terminay-attachments` under `os.tmpdir()`, with a server-chosen name. The
   operation accepts bytes and an offered name, never a path. This is a second
   named scratch write beside ADR-0023's, not a reuse of it.
3. **The view never learns a path.** The server adds the paths to the message it
   types into the terminal.
4. **There is no size or type limit.** Safety comes from streaming in bounded,
   acknowledged parts so no process holds a whole file, and from the workspace
   asking the person to confirm a large total outside the view.
5. **Terminay does not remove a delivered attachment.** Only an upload that did
   not complete is removed.

## Consequences

- A phone session can attach a photo and the agent receives a path valid in its
  own shell.
- Disk use is bounded by the person's confirmations and the operating system's
  temporary-file cleaner, not by Terminay. A long-lived host that never clears
  its temporary directory accumulates attachments; operators need to know.
- A reviewer of filesystem mutations has three buckets: project-scoped catalog
  operations, the clipboard scratch write, and this one. There is still no
  client-chosen absolute path.
- Untrusted bytes of any type sit on disk as non-executable files the server
  never reads back.

## Open items

- Whether Settings should show the scratch directory's size with a way to clear
  it.
