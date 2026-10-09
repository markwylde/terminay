# ADR-0056: Terminal output reaches workspace state only as sanitised display text the server resolves

Status: accepted
Date: 2026-10-09

## Context

A program names its terminal by writing the xterm title sequence (`OSC 0` or
`OSC 2`) to its output. Honouring it means bytes from a PTY, which are
untrusted (ADR-0011) and may come from a remote host, a `cat` of a hostile
file, or an agent, become a field of persisted workspace state that syncs to
every device.

Until now terminal output has reached only the activity model, which is
derived, ephemeral, and typed. Panel state was written only for a person: a
client command, the AI metadata command, or MCP. The title sequence is the
first request to let output write panel state, and it will not be the last:
`OSC 7` working directories, `OSC 1337` user variables, and hyperlinks all
ask the same question.

## Decision

1. **The server is the only reader.** Output that changes workspace state is
   decoded on the server that owns the session, from the PTY stream it
   already observes. A client never turns something its xterm parsed into a
   workspace command.
2. **Output writes its own field, never a person's.** A value taken from
   output is stored in a field of its own on the panel. A field a person set
   is never overwritten by output, and the server resolves what is displayed
   with the person's value first.
3. **The value is display text and nothing else.** It is stripped of control
   and direction-override characters, bounded in length, and never read to
   select, authorize, or scope an operation.
4. **Nothing is echoed back.** Terminay does not answer a query that would
   return output-supplied text to the program's input.
5. **Commits are bounded by time, not by output.** An output-driven workspace
   change is coalesced so that a program cannot make the server persist and
   broadcast state at the rate it prints. The per-event work stays constant
   (ADR-0044) and the coalescing timer is armed by an event (ADR-0028).

## Consequences

- Program-set tab titles are the first use: `programTitle` beside
  `namedTitle`, resolved by the server into `title`.
- A future output-driven fact (a reported working directory, say) follows the
  same five rules or records a superseding decision.
- A program can still show misleading text on its own tab. That is accepted;
  rule 3 keeps it from mattering to anything but the reader's eye, and rule 2
  lets a person override it.
- A terminal with no client attached still updates, because rule 1 does not
  depend on one.
