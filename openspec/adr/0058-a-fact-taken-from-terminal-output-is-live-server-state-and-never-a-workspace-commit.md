# ADR-0058: A fact taken from terminal output is live server state, and never a workspace commit

Status: accepted, supersedes ADR-0056
Date: 2026-10-10
Supersedes: ADR-0056

## Context

ADR-0056 let terminal output write workspace state for the first time, for
program-set tab titles. It set five rules. Four are about trust: the server is
the only reader, output writes a field of its own, the value is display text
that selects nothing, and nothing is echoed back. The fifth made the value a
persisted workspace field and bounded its commits by time, one per terminal per
250 ms.

The fifth rule was wrong about what a commit costs. A workspace commit is the
path built for a change a person makes: it is validated against the whole
model, written to disk before it is published, and advances the revision that
tells every client the workspace's structure may have changed. An agent CLI
animates its title about once a second for hours, so a rate that looked bounded
was a steady commit per second per agent. One day after it shipped, forced Git
measurements on an ordinary install had risen from 15 to 45 an hour to between
500 and 1,250, and typing lagged whenever an agent was working. See
[what one workspace change cost](./evidence/workspace-change-fanout-cost.md).

Making the commit cheaper does not repair the rule. A commit that cost nothing
would still advance the revision, and a client is right to treat a new revision
as a reason to look at everything. The mistake was the category: a value a
program rewrites every second is not a workspace change.

ADR-0056 also named the facts that would follow: a reported working directory,
user variables, hyperlinks. Each would have inherited the same path.

## Decision

1. **The server is the only reader.** Output that produces a fact is decoded on
   the server that owns the session, from the PTY stream it already observes.
   A client never turns something its xterm parsed into state.
2. **The fact is live state, held in memory beside the session.** It is not a
   field of the workspace model, is not written to disk, and does not advance
   the workspace revision. It ends with the server process.
3. **It is published as current state, per terminal.** The server publishes the
   fact through a keyed projection in which a newer value for a terminal
   replaces one still waiting to be sent. Publication is coalesced by a timer
   an output event arms (ADR-0028), and the work per output event stays
   constant (ADR-0044).
4. **A person's value is never overwritten, and the server resolves what is
   shown.** Where a fact competes with something a person set, the person's
   value wins, and the server publishes the resolved result. A client presents
   it and does not resolve it.
5. **The value is display text and nothing else.** It is stripped of control
   and direction-override characters, bounded in length, and never read to
   select, authorize, or scope an operation.
6. **Nothing is echoed back.** Terminay does not answer a query that would
   return output-supplied text to the program's input.

## Consequences

- A program-set title is the first such fact. `programTitle` and its commands
  leave the workspace model; the displayed title is published as a live
  terminal fact. The named title and the default name stay workspace state.
- Output-supplied text no longer reaches disk or the synced durable model at
  all, which is a narrower exposure than ADR-0056 accepted.
- A program title does not survive a server restart. A tab shows its named
  title or default name until the program writes a title again.
- A terminal with no client attached still updates, and MCP still reads the
  resolved title, because both are served from the server's own store.
- A future output-driven fact follows these six rules or records a superseding
  decision. One that must survive a restart is not this kind of fact and needs
  its own decision about why.
