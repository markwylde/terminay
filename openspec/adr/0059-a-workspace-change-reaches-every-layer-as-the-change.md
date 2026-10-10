# ADR-0059: A workspace change reaches every layer as the change, and each layer's work is proportional to it

Status: accepted
Date: 2026-10-10

## Context

The workspace model is one revisioned document the server owns. Until now a
change to it travelled as a new revision number: the server announced that the
revision had advanced, each client fetched the whole document again, replaced
its copy, and rebuilt what it showed from the top.

That was simple and it was correct. It also meant every layer did work sized by
the workspace for a change sized by one object. The server copied its whole
state about eleven times a commit, mostly to read single fields. A client gave
every object a new identity, so nothing in the interface could tell what had
stayed the same; in React that turned one changed panel into a re-render of
every project and terminal, a reset of every file explorer, and a forced Git
measurement per folder. See
[what one workspace change cost](./evidence/workspace-change-fanout-cost.md).

ADR-0044 already says this for the terminal output path: a bound on size is
not a bound on work, and work per event is proportional to the event. Nothing
said it for the workspace path, where the event rate is a person's rather than
a program's and each site looked harmless.

## Decision

1. **A commit produces a change record.** The record is the ordered outcome of
   one commit: the revision it starts from and produces, and per collection the
   objects it created or replaced and the ids it removed. It is derived by the
   store, not declared by the command.
2. **The change record is what travels.** The ordered change event carries it.
   A client applies it when it starts from the revision the client holds, and
   otherwise asks for the records it missed. A whole snapshot is for a first
   load, a gap the server's history no longer covers, and recovery.
3. **A record is scoped like a snapshot.** It passes the same authorization
   projection. Where a record cannot be scoped exactly for a connection, that
   connection is told to fetch; a record is never widened.
4. **What did not change keeps its identity.** On the server and in every
   client projection, an object a change did not touch is the same object
   before and after, however the change arrived. Identity is the signal that
   nothing happened.
5. **Committed state is read, not copied.** The store hands out one read-only
   value. A copy is made to change the state, once per commit, and for no other
   reason.
6. **Work follows the record.** A subscriber, effect, or component acts on a
   change only if the record names something it depends on. Nothing is keyed
   on the revision number as a stand-in for "something changed".
7. **Durable before published stays.** A commit is on disk before any client
   hears of it. Proportionality is sought everywhere except by publishing a
   revision that a crash could take back.

## Consequences

- The protocol gains change records on the change event and a delta that
  returns records. Both are negotiated as a capability, and the full-state
  envelope remains for a peer without it.
- The server's reducer still works on a draft copy. One copy per commit at the
  rate people act was measured at 0.1 to 3.5 ms and is accepted.
- The idempotency cache holds change records, not states, and is bounded in
  bytes.
- Client stores expose selections with their own subscriptions, so a component
  hears about the object it shows.
- Code that mutates state it read from the store is a defect the type system
  and a frozen state in tests are expected to catch.
- A value that changes at the rate a program prints does not belong on this
  path however cheap the path becomes (ADR-0058).
