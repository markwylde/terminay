# ADR-0095: Session holders retain bounded terminal presentation in memory

Status: accepted, supersedes ADR-0086
Date: 2026-11-03
Supersedes: ADR-0086

## Context

A session holder can preserve a running TUI while losing the state needed to
interact with it. Its 1 MiB raw ring eventually evicts the program's initial
mouse, focus, paste, and alternate-screen setup. On server restart a default
emulator interpreting only that ring keeps drawing the program but no longer
reports its mouse input. The long-history Docker regression reproduces this;
the short-history control passes, and a DECRQM response proves the input mode
changed while the process PID remained the same.

ADR-0086 carries forward ADR-0035's prohibition on parsing terminal output.
A raw-only holder cannot reconstruct evicted state, and a checkpoint retained
only by its server cannot follow output or mode changes after that server
exits. Keeping a running transcript on disk would violate the storage policy.

## Decision

1. **The holder retains bounded, in-memory terminal presentation for each
   held PTY from spawn until the session is released.** It reuses the shared
   headless checkpoint implementation and consumes the same ordered output and
   canonical resizes while attached or detached. This replaces the inherited
   no-terminal-parsing clause of ADR-0086 decision 4. The holder still runs no
   extensions, holds no workspace authority, and remains bounded by explicit
   session, grid, scrollback, state, tail, and parser-queue limits.
2. **Recovery carries a parser-safe checkpoint and ordered tail over the
   authenticated internal holder protocol.** New wire behaviour has a new
   negotiated version. Restoration bytes travel in bounded binary chunks,
   scoped to one exact session, and are never PTY output or input. The server
   validates and installs them before exposing recovered presentation and
   parsing later live bytes. Existing generations keep their frozen protocols.
3. **Presentation is observational.** Neither headless query replies nor
   parser failures may write to, terminate, replace, or change authority over a
   PTY. Resource exhaustion yields an explicit presentation-recovery failure;
   it must not silently replace unavailable modes with defaults. Output work
   and backpressure remain event-driven and bounded under ADRs 0028 and 0044.
4. **Every other commitment of ADR-0086 remains in force.** This includes
   detached PTY ownership, generation/build lifecycle and runtime copies,
   principal restrictions and mutual credential proof on local transports,
   session lifetime limits, the no-running-output-disk-journal policy, and
   distribution/release-floor verification. The applicable macOS floor from
   ADR-0079 and other independent runtime decisions remain unchanged.

Rejected alternatives: enlarging the raw ring merely postpones loss; forcing
capture changes the program's contract; a hand-written mode scanner duplicates
terminal parsing and misses reset/buffer/fragmentation semantics; opaque
server-only state becomes stale while disconnected; running disk journals
expand terminal-data retention beyond the established policy.

## Consequences

- A long-running held TUI recovers its screen and input state independently of
  the raw ring, including changes made while no server was attached.
- Holders become larger and use additional bounded parser memory and CPU.
  They must ship the shared headless implementation and keep it isolated from
  all interactive input and extension bridges.
- The server and holder must agree on raw offsets, geometry, safe boundaries,
  and ordered tails. Conformance tests cover malformed transfers, races,
  legacy negotiation, queue limits, and query-reply isolation.
- Old holders cannot recover information they already discarded. Their
  sessions remain running under the existing negotiated raw attach path.
- Neither the macOS unlock trigger nor a Codex-specific cause is established
  by the recovery regression; the decision is independent of agent identity.
