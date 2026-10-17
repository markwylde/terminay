# ADR-0069: Terminay's terminals report the Git commands run in them to the server, through Git's own tracing, across server restarts

Status: accepted, supersedes ADR-0052
Date: 2026-10-17
Supersedes: ADR-0052

## Context

ADR-0052 had each terminal's Git send its Trace2 events to a Unix socket owned by the server. Each event is tagged with a random token for the terminal session. The server picked a new random socket address on every start and kept the tokens only in memory.

Terminals outlive the server. The session holder (ADR-0035) keeps shells running through a restart or an update, and the next server re-adopts them under the same session id. Those shells still name the previous run's socket and token. Their Git reports reach nothing, so worktree capture does not move a terminal that was kept across a restart. The fallback process lookup loses its race against Git on most repositories. The capture diagnostics showed this on 2026-10-17: no report arrived, from a shell older than the server it was talking to.

ADR-0054 already says a socket handed to a terminal that may outlive the server cannot have a random address. ADR-0052 left that open for the Git socket, and its decision 1 required a token that is random per session. Both have to change, so this record restates ADR-0052 with those two points revised. ADR-0052's other decisions are carried forward unchanged.

## Decision

1. **Terminay sets Git's Trace2 event variables in the terminals it launches.**
   They name a Unix socket owned by the server, ask for brief events and shallow nesting, and carry a parent session id that is a token for the terminal session.
2. **The socket has a fixed address for a data directory, placed by ADR-0054.**
   A shell started by any run of a server reaches every later run of the same server. A server without a data directory has no session holder and uses a per-run address.
3. **A session's token is derived from its session id with a key private to the data directory.**
   The key is created once, readable only by its owner, and never leaves the server. Tokens are unpredictable without the key and unique per session. A run recognises the token of every session it launches or re-adopts, and stops recognising it when the session ends.
4. **One run of a server listens at a time.** The exclusive lock each host holds on its data directory guarantees this. A socket left at the address by a run that ended without closing is replaced when the next run starts.
5. **The server reads that stream to learn which terminal ran a Git command.**
   A consumer registers for the commands it cares about. The first consumer is worktree capture, which acts on `worktree add`.
6. **Nothing from the stream is stored.** Each line is parsed and dropped as it arrives. The server keeps no log, history, or buffer of Git activity beyond the line being parsed, and its memory does not grow with the number of events.
7. **The stream is untrusted input and names nothing the server acts on.** Any process that can reach the socket can write to it. An event may tell the server that a command ran in a session. It never supplies a path, a project, or a folder to act on. A token the server does not recognise is ignored, and lines are length-bounded.
8. **The user's own tracing wins.** A terminal whose environment already names a Trace2 target keeps it untouched, and Terminay does not report for that terminal.
9. **A terminal that cannot reach the socket still works.** Git runs normally when the target is unreachable. Features built on the stream must have an answer for the case where no event arrives.
10. **The token is not a credential.** It identifies a terminal session to the server for attribution only. It grants nothing, and is never accepted in place of a capability.
11. **The stream never leaves the machine.** It is a local socket between Git and the Terminay Server on the same host. It is not forwarded to any client, extension, or hosted service as a stream.

## Consequences

- Worktree capture works the same for a terminal kept across a restart or update as for one opened afterwards.
- Shells launched by a release before this decision carry a random address and token that no later run knows. They do not report until reopened.
- The data directory gains a small key file. Losing it makes surviving shells unrecognised until reopened, and never makes them misattributed.
- Every Git command run in a Terminay terminal does slightly more work and sends a few kilobytes to the local server. `env` in a Terminay terminal shows the `GIT_TRACE2_*` variables.
- Attribution works the same for an agent, a script, and a person typing, and does not depend on repository size.
- A sandbox that blocks Unix socket connections silences the stream for whatever runs inside it. Worktree capture falls back to the process lookup there.
- Each new consumer of the stream must keep to points 6, 7, and 11. A consumer that wants to store or forward Git activity needs its own decision.
- Git older than the version that introduced Trace2 socket targets sends nothing. That is handled the same way as an unreachable socket.

## Open items

- Whether the socket is reachable from inside each supported agent's sandbox is recorded in [worktree capture signals](./evidence/worktree-capture-signals.md) as it is tested.
