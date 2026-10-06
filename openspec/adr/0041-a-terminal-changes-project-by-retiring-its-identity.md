# ADR-0041: A terminal changes project by retiring its identity and binding a new one

Status: accepted
Date: 2026-10-07

## Context

A live terminal is identified at the server boundary by an immutable
`{serverId, projectId, sessionId}`. Attachments, presentation leases, checkpoint
pins, input queues, consumer subscriptions, and MCP capabilities are all bound
to that triple, and ADR-0011 makes the project and terminal-session boundaries
security boundaries: a credential resolves to immutable server, project, and
session state.

Workspace state, separately, lets a panel move between projects with
`panel.move` and rewrites the session record's project when it does. The two
were never reconciled, because no client sent `panel.move` for a live terminal.
The desktop renderer moved the presentation locally instead and kept attaching
under the launch project, which left the server and the screen disagreeing about
where a terminal lived and produced duplicated, disconnected tabs.

Moving a terminal between projects is a product requirement and has to be
permanent: visible on every device and after a restart. Three shapes were
considered:

- Keep the launch project as the terminal's identity for its whole life and move
  only the panel. Authorization, MCP reach, close protection, and listings would
  then belong to a project the terminal is no longer shown in.
- Make the project part of the identity mutable and re-key every structure that
  embeds it. Each of those structures compares identity to authorize, so one
  missed key leaves a credential for one project resolving to a terminal in
  another.
- Treat a move as the end of one identity and the start of another for the same
  PTY.

## Decision

1. **The session id is what persists across a move; the identity triple does
   not.** A terminal's PTY, session id, scrollback, and output position continue.
   Its `{serverId, projectId, sessionId}` identity under the source project is
   retired, and a new identity under the target project is bound.
2. **An identity is never edited.** Nothing bound to the retired identity is
   carried over, re-keyed, or redirected. Attachments, leases, pins, queued
   input, resize ownership, consumer subscriptions, and capabilities end with
   it, and holders obtain new ones under the new identity through the ordinary
   paths. A request naming the retired identity is refused.
3. **Only a committed `panel.move` re-homes a terminal.** The server performs the
   re-home itself as part of that command, after the workspace commit and before
   the revision is published. No client, host, or extension can re-home a
   terminal by another route, and no client is trusted to say which project a
   terminal belongs to.
4. **Workspace state is the record of where a terminal lives.** Every other
   server component that stores a terminal's project — the terminal service,
   activity and agent status, an active recording, a host's session cache —
   follows the workspace commit in the same step, and a restart rebuilds identity
   from workspace state.
5. **A move never widens a credential.** A capability issued for the source
   project is revoked by the move, not re-scoped. A process that needs authority
   in the target project obtains it the way a new terminal there would.

## Consequences

- "Which project is this terminal in" has one answer on the server, on every
  client, and after restart.
- A client attached to a terminal when it moves loses that attachment and
  attaches again. Clients must treat a terminal's project as something the
  workspace projection tells them, not something fixed when a panel was created.
- Input queued in the instant of a move is dropped with the retired identity.
- An agent running in a moved terminal loses its Terminay MCP capability and
  does not get another, because the token lives in the shell's environment.
- A new component that keys state by terminal identity must release that state
  when the identity is retired. The re-home is the one place that enumerates
  them, and it is tested by asserting nothing remains under the old key.
- The running process is not relaunched: its environment, working directory, and
  shell profile are those of the project it was started in.
- ADR-0011's invariant is unchanged and is read as covering this case: a
  credential still resolves only to the immutable identity it was issued for,
  and that identity can end.
