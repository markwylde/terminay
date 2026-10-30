# ADR-0083: A Windows pipe admits only the user's principals for writing, and serves only a peer that proves its credential

Status: accepted, supersedes ADR-0080
Date: 2026-10-30
Supersedes: ADR-0080

## Context

ADR-0080 §3 required a Windows holder pipe to refuse remote clients. Spike 1.1
of `native-windows-desktop` disproved the premise that this is available (see
[the named-pipe spike](./evidence/windows-named-pipe-spike.md)):

- libuv creates the pipe as the first instance of its name, so squatting is
  refused;
- the pipe's default DACL grants write access only to SYSTEM, Administrators
  and the creator, and read access to Everyone and Anonymous;
- libuv does not set `PIPE_REJECT_REMOTE_CLIENTS`, and a client reaching the
  pipe through `\\<machine>\pipe\…` is served;
- Node exposes no server-side pipe handle, so the server cannot ask who
  connected with `GetNamedPipeClientComputerNameW`.

Refusing remote clients would need a pipe server written outside libuv, with
its own I/O loop. The owner chose not to build one, and approved the contract
below instead.

ADR-0080 §2 also required a runtime copy "private to its generation". The
implementation shares one copy across every holder of a build, which is
simpler and no less safe. This ADR restates ADR-0080 with both corrections.

## Decision

1. **PTYs are owned by a detached session holder, not by the server.**
   Unchanged from ADR-0080 §1.

2. **One holder serves all sessions of one data root, per generation.**
   Unchanged from ADR-0080 §2, except that the copy is per build, not per
   generation:
   - every holder of one build runs from that build's single copy;
   - a copy is used only once it is complete;
   - a copy is removed once no holder runs from it, and never while one does.

3. **The holder protocol is internal, versioned, and local, and both ends
   prove the credential.** It is carried over an owner-only Unix socket inside
   the data root, or, on Windows, a named pipe:
   - its name is derived from the user's SID, the data root, and the
     generation;
   - it is created as the first instance of that name;
   - only the user, SYSTEM and Administrators can write to it.

   The pipe does not distinguish a client on this machine from one that
   reaches it over the network as one of those principals. Neither is
   admitted by connecting. Before any session frame, each end proves to the
   other, by an HMAC over both ends' nonces, that it holds the credential
   stored in the data root. The credential never crosses the channel, and the
   holder sends nothing until the client has spoken. The same applies to every
   Windows pipe Terminay serves. The MCP control pipe serves nothing that a
   capability token does not authorise. Renderers, browsers, extensions, and
   MCP do not reach a holder.

4. **A holder never runs unbounded.** Unchanged from ADR-0080 §4.

5. **Terminal output reaches disk only as a bounded tail of a session that
   ended unattached.** Unchanged from ADR-0080 §5.

6. **The distribution matrix.** Unchanged from ADR-0080 §6.

7. **The floor is a build input, not a runner property.** Unchanged from
   ADR-0080 §7.

8. **No Linux artifact merges or publishes without proof that it meets the
   floor.** Unchanged from ADR-0080 §8.

9. **No Windows artifact publishes without running on Windows.** Unchanged
   from ADR-0080 §9.

## Consequences

- The consequences of ADR-0080 hold.
- A process on another machine that authenticates as this user, or as an
  administrator, can open a Terminay pipe. It still needs the credential or a
  capability token, which live in the user's data root. A principal able to
  read those can already act as the user.
- A principal with read access can open a pipe read-only and occupy an
  instance. It receives nothing, and the only cost is a connection the server
  ends.
- The holder writes no DACL on its pipe, and the server writes none on the
  pipes it serves. The data root's directories carry the explicit DACL instead.

## Open items

- ADR-0080's open items carry over, less the spike, which is recorded.
- If Node gains a way to set `PIPE_REJECT_REMOTE_CLIENTS` or to read the
  client's computer name, remote refusal can be added without changing this
  decision.
