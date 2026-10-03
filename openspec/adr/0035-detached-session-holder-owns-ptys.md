# ADR-0035: A detached session holder owns PTYs, in frozen generations, so shells outlive the server

Status: accepted, supersedes ADR-0004
Date: 2026-10-03
Supersedes: ADR-0004

## Context

ADR-0004 kept `node-pty` with one supervised child per PTY and declared the
supported distribution matrix. In both hosts the process that calls `node-pty`
is the server itself, or a child it supervises, so every shell dies when the
server process exits. Terminay Desktop now updates in place (ADR-0027), and the
standalone server upgrades by restarting its service (ADR-0016), so every
release ends every user's shells. The product contract is changing to keep them:
a server restart for any reason must leave shells running and reattach to them.

That requires a process that outlives the server to hold the PTYs. "One
supervised child per PTY" cannot describe it: a supervised child dies with its
supervisor, and one process per shell is too expensive when the process is a
Node or Electron-as-Node runtime. ADR-0004's topology is therefore revisited.
Its distribution matrix is not, and is restated here unchanged.

## Decision

1. **PTYs are owned by a detached session holder, not by the server.** The
   holder is a separate process, started detached from the server, that calls
   `node-pty`, keeps each PTY master and a bounded ring of each session's recent
   output, and is the authority for a session's output position. The server is
   its only client and reaches it through the existing `PtyFactory` seam in
   `server-core`. Desktop and standalone use the same holder.

2. **One holder serves all sessions of one data root, per generation.** A
   holder's code and protocol are frozen for the life of its sessions. A server
   from a different build never replaces a holder that has sessions: it marks it
   drain-only and starts a new generation for new sessions. A drain-only holder
   refuses to spawn and exits when its last session ends. A holder needs nothing
   from its installation directory after start-up.

3. **The holder protocol is internal, versioned, and local.** It is negotiated
   per holder, carried over an owner-only Unix socket inside the data root, and
   authenticated by a credential stored in the data root with the same
   restriction. It is never a network listener and never part of the application
   protocol. Renderers, browsers, extensions, and MCP do not reach a holder;
   terminal authority stays in the server.

4. **A holder never runs unbounded.** It serves one attached server at a time.
   When none is attached it ends its sessions and exits after a limit the server
   set, which is a user setting. It runs no extensions, parses no terminal
   output, and holds no workspace state.

5. **Terminal output reaches disk only as a bounded tail of a session that
   ended unattached.** A running attached session is never journalled.

6. **The distribution matrix is unchanged from ADR-0004.** Desktop: macOS 12 or
   newer on arm64, and GNU/Linux x64. Standalone Server: GNU/Linux x64 and arm64
   on Debian 12-compatible hosts with glibc 2.36 or newer. macOS x64, Linux arm64
   Desktop, Windows, standalone macOS/Windows Server, and Alpine/musl Linux are
   outside it. There is one PTY implementation, shared by Desktop and
   standalone, and every supported target needs its own native `node-pty` build
   from the release pipeline.

## Consequences

- A release no longer ends anyone's shells. Restart, update, and server crash
  all reattach.
- A holder crash ends every session of its generation. The holder is kept
  minimal for that reason.
- The server must keep speaking every holder protocol version that a live shell
  might still be held under. That set is bounded by shell lifetime and the
  unattached limit, and is pinned by conformance tests.
- Server shutdown is no longer the cleanup for shells. Every exit path has to
  choose between detaching and ending, and service managers must not kill the
  holder with the server.
- Anything injected into a shell's environment at launch must stay valid across
  server restarts.
- Process ancestry of a shell now runs through the holder, not the server or the
  Desktop app.

## Open items

- A spike must show, with evidence under `./evidence/`, that a holder survives
  Squirrel.Mac replacing the app bundle, an AppImage unmounting when the main
  process exits, and a standalone `versions/` directory being removed, and that
  macOS privacy permissions still resolve for shells whose launching app has
  exited. A negative result changes how the holder is launched, not this
  decision.
- ADR-0004's release-gate probe (spawn, cwd, UTF-8, input, resize, inspection,
  exit and signal propagation, descendant cleanup, bounded shutdown) carries
  over and gains reattach after server exit on every supported architecture.
