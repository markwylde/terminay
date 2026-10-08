## Why

On 2026-10-08 three terminals in a running Terminay Desktop were hung up at the
same instant. Their tabs showed `[process exited with code 1]`, and the coding
agents running in them were ended mid-session. The application had not crashed:
the main process, the renderer, and a newer session holder all stayed up.

What could be reconstructed afterwards came from file modification times and
the operating system log, not from Terminay. A session holder left from the
previous launch had closed, saving its tails and sending SIGHUP to every
session it held. Whether it closed because its unattached limit expired after
the server's connection to it dropped, or because something signalled it, could
not be established: the Diagnostics folder held no record that a holder
existed, was attached, was drained, lost its connection, or closed.

The session holder is the process that decides whether a user's shells live or
die, and it is the one part of the Local server that reports nothing. It is
detached, has no output stream anyone reads, and its only client discards every
lifecycle fact it learns.

## What Changes

- The session-holder client in `server-core` reports holder lifecycle to the
  server host: each holder found at start-up and whether it was attached,
  removed as dead, or signalled as incompatible; a holder launched or failing
  to launch; a holder marked drain-only and why; the unattached limit sent; the
  connection to a holder closing, and whether this server asked for that; and
  each held session ending, with its exit code and signal and whether this
  server requested it.
- A holder that closes says why. It sends a final closing notice to an attached
  server and writes a small close record in the data root before it ends its
  sessions. The record carries the close reason (`empty`, `limit`, `end-all`,
  `signal` with the signal name, `first-attach-timeout`, or `crash`), how many
  sessions were live, whether a server was attached, the limit in force, and
  how long since the last attach and detach.
- A server reports a close it hears about immediately. A close record left by a
  holder that had no server attached is reported by the next server to start on
  that data root, marked as reported late with the holder's own timestamp, and
  then removed.
- Desktop records those reports in the diagnostic history for the embedded
  Local server. A standalone server writes them to its own service log.

This change adds evidence only. It does not change when a holder closes, how a
server reattaches, the unattached limit, or how a holder's build is identified.
No record carries terminal output, a session id, a working directory, a shell
command, the holder credential, or the holder socket path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-desktop-diagnostics`: adds always-on coverage of session-holder
  lifecycle and of held sessions ending, with the identifiers and bounds those
  records use.

## Impact

- `packages/server-core/src/sessionHolder/` — an observer option on the
  factory with report points in start-up, launch, drain, limit, connection
  close, and session exit; a closing notice in the holder protocol; a close
  record written by the holder and read by the factory.
- `electron/serverTerminalAuthority.ts`, `electron/main.ts`,
  `electron/diagnostics/core.ts` — route reports to Desktop diagnostics on the
  lifecycle channel and name the new events.
- `apps/terminay-server/src/cli.ts` — write reports to the service log.
- Tests in `packages/server-core/test/` and the diagnostics tests.
- No new dependency and no holder protocol version change: the closing notice
  is a message type that a server which does not know it already ignores, and
  a holder from an earlier build simply never sends it.
- The session holder itself is specified by the unarchived
  `terminals-survive-restart` change (`persistent-terminal-sessions`); this
  change adds no requirement there.
