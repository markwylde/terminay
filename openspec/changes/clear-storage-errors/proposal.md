## Why

When a standalone server's disk filled up, every write failed and people saw only
"Operation failed: command failed". Open terminals kept streaming, so the server
looked healthy and nothing named the cause (Gitea #674). The raw Node system
error reaches `dispatchError`, which knows only domain errors, and falls through
to `internal` / `command failed`.

## What Changes

- A command that fails because the server's storage refused it returns a
  structured error with a plain message, a stable `details.reason` and a correct
  `retryable` flag:
  - `ENOSPC` → `unavailable`, "The server's disk is full", retryable.
  - `EDQUOT` → `resource` (quota exceeded), retryable.
  - `EROFS` → `unavailable`, "The server's storage is read-only", not retryable.
  - `EACCES` / `EPERM` → `unavailable`, a permissions message that names the
    server data folder when the refused path is inside it, not retryable.
- The system error is found through the error's cause chain. Wrappers that drop
  it today (file save, workflow save, dropped-file upload, terminal start, recording storage) keep
  it, including the file save that reports failure inside a successful result.
- A storage failure carries no path or platform error text. This also stops the
  raw system message that file save and workflow save send for these conditions.
- The client shows the server's message. Where it replaces `unavailable` with
  reconnect copy (feature failure banners, transport-failure suppression,
  project root update), it lets a storage failure through unchanged.

Not included: a low-disk health signal for the data root. It needs its own
thresholds, sampling, protocol surface and UI, so it is follow-up work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-runtime-and-protocol`: adds the contract for reporting server storage
  failures to clients.
- `terminal-workflows`: a client command whose workflow write storage refused
  fails with the storage failure instead of `internal`. MCP tools are unchanged.

## Impact

`packages/protocol` (reason constants), `packages/server-core` (a classifier used
by the dispatcher, file/workflow/terminal error wrapping, data root passed to the
dispatcher), `apps/terminay-server` and Desktop's embedded server (supply the data
root), `packages/client-core` and `src/shared` (do not rewrite storage
failures). No new protocol error code and no protocol version change. No new or
changed UI, so the pull request carries no screenshots.
