# ADR-0082: On Windows, Git command reports arrive as files in an owner-only directory and are deleted as they are read

Status: accepted, supersedes ADR-0069
Date: 2026-10-30
Supersedes: ADR-0069

## Context

ADR-0069 has each terminal's Git send Trace2 events to a Unix socket at a fixed
address for the data directory. Its decision 6 says that nothing from the
stream is stored.

Terminay Desktop now runs natively on Windows (ADR-0081). Node's `net` module
serves only named pipes on Windows, and cannot accept on an AF_UNIX socket. Git
for Windows has no named-pipe Trace2 target. Trace2 also accepts a directory as
its target, and Git then writes one file per Git process into that directory.
That is the only target both sides support without a hand-written socket
loop in FFI.

A file is on disk, which ADR-0069 §6 could be read to forbid. The intent of §6
was that Terminay keeps no record of Git activity. A file that lives only as
long as it takes to read one Git process's events, and is then deleted, keeps
no record. This record makes that distinction explicit instead of leaving it to
interpretation, and restates ADR-0069 with §1 and §6 revised.

## Decision

1. **Terminay sets Git's Trace2 event variables in the terminals it launches.**
   They ask for brief events and shallow nesting, and carry a parent session id
   that is a token for the terminal session. On macOS and Linux they name a
   Unix socket owned by the server. On Windows they name a directory owned by
   the server.
2. **The target has a fixed address for a data directory.** The socket is
   placed by ADR-0054. On Windows the directory is `run\git-trace` under the
   data directory, created with a protected DACL that names only the user,
   SYSTEM, and Administrators, and checked on every start. A server without a
   data directory has no session holder and uses a per-run address.
3. **A session's token is derived from its session id with a key private to
   the data directory.** Unchanged from ADR-0069 §3.
4. **One run of a server listens at a time.** Unchanged from ADR-0069 §4. A
   directory left with files by a run that ended is emptied, without
   attribution, when the next run starts.
5. **The server reads that stream to learn which terminal ran a Git command.**
   Unchanged from ADR-0069 §5.
6. **Nothing from the stream is kept.**
   - Each line is parsed and dropped as it arrives.
   - On Windows, a trace file is read as it grows, through a filesystem watch
     and never by polling. It is deleted once its process has exited or a
     per-file bound is reached.
   - The server keeps no log, history, or buffer of Git activity beyond the
     line being parsed, and its memory does not grow with the number of
     events. The directory holds only the files of Git processes that are
     still being read.
7. **The stream is untrusted input and names nothing the server acts on.**
   Unchanged from ADR-0069 §7. Any process that can write to the directory can
   forge a file. Such a file is handled exactly as a forged socket line is.
8. **The user's own tracing wins.** Unchanged from ADR-0069 §8.
9. **A terminal that cannot reach the target still works.** Unchanged from
   ADR-0069 §9.
10. **The token is not a credential.** Unchanged from ADR-0069 §10.
11. **The stream never leaves the machine.** It is a local socket or a local
    directory between Git and the Terminay Server on the same host. It is not
    forwarded to any client, extension, or hosted service.

## Consequences

- Worktree capture works on Windows for every terminal that runs Git for
  Windows, including terminals kept across a restart.
- Git run by Linux inside a WSL terminal does not see the Windows-side
  variables and does not report. That is the existing "no event arrives"
  case.
- Trace data is briefly on disk on Windows. A crash between a write and its
  deletion leaves files, which are removed on the next start. Backup tools
  that snapshot `%APPDATA%` can capture in-flight files. Each holds at most one
  Git process's brief events.
- Windows reporting needs a Git that supports a Trace2 directory target. Older
  Git sends nothing.

## Open items

- ADR-0069's open item on agent sandboxes carries over.
- A spike against the runner's pinned Git for Windows version must record, in
  `./evidence/`, how its files are named, when they are flushed, and whether
  they are complete before the process exits.
