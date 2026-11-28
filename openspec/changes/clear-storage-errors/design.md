## Context

`dispatchError` in `packages/server-core/src/dispatcher.ts` is the single point
where a thrown handler error becomes a protocol error. The workspace commit hook
wraps system errors in `WorkspacePersistenceError` (cause kept), which the
dispatcher does not know, so project and terminal creation read "command failed".
`FileSession.save`, `WorkflowStore`, dropped-file upload and terminal start wrap
the error and drop it. The client already shows a server error's message, except
where it rewrites by code.

## Goals / Non-Goals

**Goals:** name storage failures with correct retryability, once, for the
standalone and embedded server; keep paths out of those errors.

**Non-Goals:** a low-disk health signal (follow-up); parsing Git or other child
process output for "No space left on device"; classifying query (read) failures;
changing failures a handler already turns into a deliberate protocol error.

## Decisions

1. **One classifier, in the dispatcher, over the cause chain.** A pure
   `storageFailure(error, dataRoot)` walks at most 8 `cause` links. It runs for
   commands only, after bot and explicit protocol errors and before the domain
   translations, so a domain wrapper cannot mask the cause. Alternative, mapping
   in each store: many sites, and each new store would miss it.
2. **Match real filesystem errors only.** Require a string `code`, a numeric
   `errno` and a `syscall` from this allowlist: `open`, `read`, `write`,
   `writev`, `close`, `fsync`, `fdatasync`, `ftruncate`, `truncate`, `rename`,
   `mkdir`, `mkdtemp`, `rmdir`, `rm`, `unlink`, `copyfile`, `cp`, `link`,
   `symlink`, `readlink`, `realpath`, `stat`, `lstat`, `fstat`, `access`,
   `scandir`, `opendir`, `chmod`, `fchmod`, `lchmod`, `chown`, `fchown`,
   `lchown`, `utime`, `utimes`, `futime`, `lutime`. It covers each step of a
   durable save (temporary file, write, flush, previous copy, rename) and
   excludes `ENOSPC` from `watch` (inotify limit), `EPERM` from `kill` and
   `EACCES` from `spawn`. A permission error with no `path` gets the generic
   message.
3. **Wrappers keep `cause`.** Error classes take the original error as `cause`.
   Adapters that would convert or serialize it first (`workflows` protocol,
   `files.save`) rethrow the storage case so the dispatcher classifies it.
   Recording storage keeps `cause` too, and the shell-profile protocol mapping,
   which would call any unknown error `validation`, passes a storage failure on.
   The MCP control endpoint keeps its own error vocabulary, and a handler's
   deliberate protocol error (project start, root browsing) keeps precedence.
   The vault drops causes on purpose, so its sanitized failures stay as they are.
4. **No new error code.** Codes are a closed set that clients validate. Quota
   uses `resource`; permission uses `unavailable`, not `forbidden`, which means
   the device lacks scope. `details.reason` is the stable discriminator,
   exported from `@terminay/protocol`.
5. **Data root is a dispatcher option.** `dataRoot` on the server-core options
   crosses the path-privacy boundary only as a choice between two fixed
   messages: the refused path is compared on the server and never sent. Without
   it, the generic permission message is used.
6. **Clients test the reason, not the code.** One `isServerStorageFailure`
   helper in `client-core`, used wherever `unavailable` is rewritten.

## Risks / Trade-offs

- [A full disk on a project volume, not the data root, reads "The server's disk
  is full"] → true of the server's machine; the server log has the path.
- [`EACCES` from opening a file for reading inside a command] → the permission
  messages say "access", not "write".
- [A handler that swallows the cause stays generic] → the known wrappers are
  fixed and tested; others keep their current behaviour.

## Migration Plan

None. Clients show the new message as they show any server message. Rollback is
a revert.
