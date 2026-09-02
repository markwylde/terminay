## Context

See proposal.md. This is a containment fix in the hosted WebRTC host: the
generation set was append-only in practice, because nothing removed a generation
whose lifecycle had failed.

## Goals / Non-Goals

Goals:
- A closed or failed generation leaves the live peer set immediately.
- A new connect after a long reconnect history still hydrates a checkpoint and
  then streams later PTY output normally.

Non-Goals:
- Changing the connection or authentication contract.

## Decisions

**Removal is driven by lifecycle failure, not by a sweep.** A generation is
dropped from the set the moment its lifecycle fails, and `closeAll` runs on host
stop. There is no periodic reaper to tune or to miss.

**Device signaling refresh is delayed twenty minutes after registration.** The
refresh is what previously re-registered peers often enough to keep the dead
ones visible; delaying it to twenty minutes after register means refresh no
longer accumulates closed peers.

## Risks / Trade-offs

- A twenty-minute refresh delay lengthens the worst-case window before a stale
  signaling registration is renewed. Accepted: the reconnect-storm test shows
  the live generation is retained and a fresh connect still hydrates and streams
  correctly.
