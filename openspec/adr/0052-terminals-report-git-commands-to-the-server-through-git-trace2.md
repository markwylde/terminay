# ADR-0052: Terminay's terminals report the Git commands run in them to the server, through Git's own tracing

Status: accepted
Date: 2026-10-08

## Context

The `linked-folders` change moves a terminal into the folder of a worktree it
created. To do that the server has to know which terminal ran
`git worktree add`. The repository watch says that a worktree appeared, and
nothing about who made it.

ADR-0051 rules out learning it from the agent. The remaining ways were measured
and are recorded in
[worktree capture signals](./evidence/worktree-capture-signals.md):

- **Find the running Git process when the watch fires.** No change to the
  terminal, but a race against Git finishing. It found the process 10 times out
  of 10 on a 3,644-file repository and 0 times out of 20 on a one-file
  repository on macOS.
- **An operating-system stream of file access per terminal.** `fs_usage`,
  `dtrace`, and `eslogger` all refuse to run without root on macOS, and Linux
  offers the equivalent only with `CAP_SYS_ADMIN` or by tracing every process.
- **Own worktree creation**, as other tools do: a Terminay command or MCP tool
  that agents are told to use in place of Git. It attributes only when the agent
  chooses to use it, and steering agents towards it is the instrumentation
  ADR-0051 forbids.
- **Have Git report its own commands.** Git's Trace2 facility writes one line
  per event to a target named in the environment, which may be a Unix socket.
  It was seen 20 times out of 20 on macOS and on Linux, always before Git
  exited, at about half a millisecond and 4.5 KB per Git command.

ADR-0051 left open, to be decided where it came up, the case of a variable that
changes what another tool does in the terminal. This is that case, and the
repository owner approved it on 2026-10-08, with the process lookup kept as a
fallback.

## Decision

1. **Terminay sets Git's Trace2 event variables in the terminals it launches.**
   They name a Unix socket owned by the server, ask for brief events and shallow
   nesting, and carry a parent session id that is a random token unique to the
   terminal session.
2. **The server reads that stream to learn which terminal ran a Git command.**
   A consumer registers for the commands it cares about. The first consumer is
   worktree capture, which acts on `worktree add`.
3. **Nothing from the stream is stored.** Each line is parsed and dropped as it
   arrives. The server keeps no log, history, or buffer of Git activity beyond
   the line being parsed, and its memory does not grow with the number of
   events.
4. **The stream is untrusted input and names nothing the server acts on.** Any
   process that can reach the socket can write to it. An event may tell the
   server that a command ran in a session; it never supplies a path, a project,
   or a folder to act on, and a token the server did not issue is ignored. Lines
   are length-bounded.
5. **The user's own tracing wins.** A terminal whose environment already names a
   Trace2 target keeps it untouched, and Terminay does not report for that
   terminal.
6. **A terminal that cannot reach the socket still works.** Git runs normally
   when the target is unreachable. Features built on the stream must have an
   answer for the case where no event arrives.
7. **The token is not a credential.** It identifies a terminal session to the
   server for attribution only. It grants nothing, and is never accepted in
   place of a capability.
8. **The stream never leaves the machine.** It is a local socket between Git and
   the Terminay Server on the same host, and is not forwarded to any client,
   extension, or hosted service as a stream.

## Consequences

- Every Git command run in a Terminay terminal does slightly more work and
  sends a few kilobytes to the local server. `env` in a Terminay terminal shows
  the `GIT_TRACE2_*` variables.
- Attribution works the same for an agent, a script, and a person typing, and
  does not depend on repository size.
- The socket must live at a short path; Unix socket paths are capped near 104
  bytes.
- A sandbox that blocks Unix socket connections silences the stream for what
  runs inside it. Worktree capture falls back to the process lookup there.
- The stream is available to later features that need to know which terminal
  ran a Git command. Each new consumer must keep to points 3, 4, and 8; a
  consumer that wants to store or forward Git activity needs its own decision.
- Git older than the version that introduced Trace2 socket targets sends
  nothing. That is the unreachable case and is handled the same way.

## Open items

- Whether the socket is reachable from inside each supported agent's sandbox is
  recorded in the evidence file as it is tested.
