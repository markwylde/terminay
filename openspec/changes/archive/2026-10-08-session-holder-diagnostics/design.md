## Context

ADR-0035 put PTYs in a detached session holder so shells outlive the server.
The holder (`packages/server-core/src/sessionHolder/holder.ts`) closes for one
of five reasons — `empty`, `limit`, `end-all`, `signal`, `first-attach-timeout`
— and on every one except `end-all` it saves tails and sends SIGHUP to each
live session. The reason is passed to an `onClosed` callback whose production
implementation is `process.exit(0)`. Nothing else learns it.

The server side (`factory.ts`, `client.ts`) is equally quiet. `start()` attaches
holders, drains ones from another build, signals incompatible ones, and removes
dead records; `track()` forgets a holder when its connection closes. None of it
is reported. The host seam for this already exists for other subsystems:
`ServerTerminalAuthority` takes `onGitObservation`, and `electron/main.ts`
turns each report into a diagnostic event on the lifecycle channel
(`electron/diagnostics/gitObservation.ts`).

During the 2026-10-08 incident a drain-only holder from the previous launch
closed with three live sessions while Desktop was running. The two plausible
causes — the server's connection dropped and the five-minute limit expired, or
the holder was signalled — leave identical traces on disk.

Constraints: the holder is detached with no stdout or stderr; a holder's code
is frozen for the life of its sessions (ADR-0035), so holders already running
when this ships report nothing new; ADR-0028 forbids polling; the diagnostics
specification forbids session ids, paths, and terminal content in records.

## Goals / Non-Goals

**Goals:**

- Every holder close is attributable to a reason after the fact, whether or
  not a server was attached when it happened.
- The history shows the server's view of each holder across a launch: found,
  attached, drained, connection lost, sessions ended.
- An unrequested connection loss is visible at the moment it happens, since it
  starts the limit that ends the sessions.

**Non-Goals:**

- Changing holder or server behaviour: no reconnect after a dropped
  connection, no change to the limit, to draining, or to how a build is
  identified. The history gathered here should say whether any of those is
  needed.
- Logging from inside the holder to the Diagnostics folder. Desktop main owns
  that folder; a holder is a server-side process that may outlive it.
- Recording anything per byte, per write, or per foreground query.

## Decisions

### 1. The factory reports through a host-supplied observer

`SessionHolderPtyFactoryOptions` gains an optional `onObservation(report)`,
with `SessionHolderObservationReport` a discriminated union exported from
`server-core`. `ServerTerminalAuthority` forwards it as
`onSessionHolderObservation`, `electron/main.ts` maps it to diagnostic events
in a new `electron/diagnostics/sessionHolderObservation.ts`, and
`apps/terminay-server/src/cli.ts` writes it to the service log. The observer is
called inside try/catch: a throwing host cannot affect a session. The
standalone `end-sessions` command passes no observer: it is a one-shot command
a person runs, and its stderr is not a service log.

*Boundary:* this keeps diagnostic ownership in Desktop main and keeps
`server-core` free of any log sink (ADR-0017). It is the Git observation
pattern, unchanged.

*Alternative considered:* the holder appending to a file in the Diagnostics
folder. Rejected — it would give a second process write access to an artifact
set main owns and bounds, and a standalone server has no such folder.

### 2. The holder states its close reason twice: a notice and a record

In `close()`, before ending sessions, the holder (a) writes a close record
synchronously and (b) sends a `closing` message to the attached server if
there is one. The same payload is used for both: reason, signal name, live and
ended session counts, whether a server was attached, limit in force, and the
times of start, last attach, last detach, and close. An `end-all` close sends
the notice and writes no record: the server asked for it, is attached to hear
it, and is removing everything the holder kept.

The notice covers the attached case immediately. The record covers the case
that actually ends a user's sessions unannounced — closing with no server
attached — and also a server that died before reading the notice.

*Boundary:* the notice is a new holder-to-server message in the internal
holder protocol (ADR-0035, decision 3). It needs no version change: the client
ignores message types it does not know, and no request depends on it.

*Alternatives considered:* notice only — rejected, because a `limit` close by
definition has nobody attached. Record only — rejected, because it would leave
the attached case unexplained until the next start.

### 3. Close records live in the data root and are consumed once

The record is one small JSON file per holder in the session-holder directory,
under a name the holder-record scan does not match, written owner-only like its
siblings. `start()`, once it has dealt with every holder it found, reads every
close record, reports each as closed with `late: true`, and deletes it. When the factory receives a `closing` notice it
reports immediately and deletes that holder's record once the connection has
closed, so the next start does not report it again. More than a small fixed
number of unconsumed records are pruned oldest-first at start.

Nothing watches or polls for records (ADR-0028). A holder that closes
unattached while Desktop is running is therefore reported at the next start;
in the meantime the history already holds the warning for the connection that
dropped, and the record itself is readable on disk.

*Boundary:* the record sits inside the data root, which is already the trust
boundary for the holder socket and credential. It contains no credential, no
session id, and no output, so it is not a new sensitive artifact.

### 4. A holder failure is recorded without being handled

`process.ts` registers `uncaughtExceptionMonitor`, which writes a close record
with reason `crash` and the error. The monitor does not catch: the process
still dies exactly as it does today.

### 5. Identification

Reports carry the holder's pid and start time, which the client already
learns from the welcome and the holder record; the host assigns the
process-local diagnostic ids. Session ids never leave `server-core` in a
report — the factory maps each to a small per-factory ordinal. The holder
generation is not reported: it names the socket, and pid plus start time
correlate a late close to its attach without it.

A session found already ended is reported on adoption only when its saved tail
carries an exit: a holder saves that only for a session nobody was watching. A
session that ended while an earlier server watched was reported by that server.

### 6. What is a warning

A close with live sessions and a reason other than `end-all`; a connection
close this server did not request; a launch failure; an incompatible holder
signalled; a live holder that refused this server. Everything else is info. Session ends the holder announced are
counted on the close record, not recorded singly.

## Risks / Trade-offs

- [Holders running before this ships say nothing] → Their attach, drain, and
  connection records still appear, because those are reported by the server.
  Only their close reason is missing, and it ages out with their sessions.
- [A close record is never consumed, e.g. the data root is abandoned] → Bounded
  count, pruned at start; each is a few hundred bytes.
- [Synchronous write in `close()` delays ending sessions] → One small file in a
  directory the holder already writes to; a failed write is swallowed.
- [The observer adds work on the session-exit path] → One call per session
  end, none per output event (ADR-0044).
- [A `limit` close while the app is running is only reported at next start] →
  Accepted; avoiding it needs a watch or a reconnect, which is behaviour this
  change deliberately leaves alone.

## Open Questions

- Should a server that loses its connection to a holder unexpectedly try to
  reattach before the limit expires? Left for a follow-up once the history
  shows whether that is what happened.
- A packaged Desktop derives the holder build id from a file inside the
  application archive, and the value observed in production tracked launch
  time rather than the build. If so, every launch drains the previous holder.
  The same-build fact recorded at attach will confirm or refute it.
