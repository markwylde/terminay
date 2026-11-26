# ADR-0144: Stored bot transcript updates carry the server receive time

Status: accepted
Date: 2026-11-26

## Context

A bot session's transcript is stored as the normalized session updates that
Terminay's native CLI drivers emit (ADR-0096), plus a few server records. The
updates carry no time, so the Sessions view cannot say when a prompt, reply or
tool call happened. Update content originates with the agent in the bot
container, which is untrusted, so a time inside it cannot be relied on.

## Decision

When the server admits a transcript update that is a JSON object to storage,
it sets a top-level `receivedAt` field on it to its own clock's epoch
milliseconds, overwriting any value already there. It is the admission time, not
the moment the CLI produced the event. Updates stay otherwise as the agent sent them; there is no
wrapper record. Folding takes each transcript entry's time from the update that
starts it. A stored update without a valid `receivedAt` (an integer Date can represent)
folds to an entry without a time. Transcript text search ignores the top-level
`receivedAt` only.

## Consequences

- Every surface that reads stored transcripts can show or order by a trustworthy
  receive time without a second storage format.
- `receivedAt` is reserved on stored transcript updates; agent-supplied values
  in it are lost.
- Each update costs about 25 more bytes against the 8 MiB transcript cap.
- Readers must tolerate updates with no `receivedAt`.
