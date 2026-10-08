# ADR-0054: A local socket that does not fit in the data directory lives in an owner-only runtime directory

Status: accepted
Date: 2026-10-09

## Context

Terminay's local sockets with a fixed address have lived inside the data
directory: the Desktop MCP control socket, the standalone server's approval
socket, and the session holder's sockets (ADR-0035). The data directory is
owner-only, and the code treats that as what makes a socket inside it the
owner's channel.

A Unix socket's path is limited to 104 bytes on macOS and 108 on Linux. A data
directory at a long path cannot hold a socket at all. The session holder
already steps aside when its socket would not fit. The MCP control socket did
not check, and Desktop failed to start with a general message
(`control-socket-path-fits`).

The Git command socket (ADR-0052) is in the temporary directory under a short
random name, but it is created fresh by each server and its address is handed
to each Git process as it starts. A socket whose address is given to a terminal
that may outlive the server (ADR-0035) cannot have a random address.

Three shapes were considered for a socket that does not fit:

- **Refuse to start and explain.** Honest, and leaves a user with a long home
  directory unable to run Terminay.
- **A random runtime directory per launch.** Cannot be prepared by anyone else,
  but changes the address on every launch.
- **A runtime directory named for the data directory, used only if it is the
  user's own and closed to others.**

## Decision

1. **The data directory is the first place for a local socket with a fixed
   address.** When the socket's path there is within the platform limit, that
   is where it goes.
2. **When it does not fit, the socket goes in a runtime directory outside the
   data directory.** The directory's name is derived from the data directory's
   absolute path, so one data directory always resolves to one address. It is
   created in the user's runtime directory where the platform provides one and
   in the system temporary directory otherwise.
3. **A runtime directory is used only if it is a directory, is not a symbolic
   link, is owned by the user the process runs as, and grants nothing to anyone
   else.** Terminay creates it that way when it is absent. A path that exists
   and fails a condition is not used, repaired, or removed, and the failure is
   reported.
4. **Permissions on a socket are never the authority for a request.** Whatever
   authenticates callers of a socket inside the data directory authenticates
   them the same way in a runtime directory.
5. **The limit is measured in bytes of the encoded path**, with one definition
   of it shared by every socket.

## Consequences

- A local socket's address is no longer always inside the data directory. Code
  that finds a socket from a data directory must resolve it the same way the
  listener does, or be handed the address.
- A data directory that fits is unaffected, and so is its trust argument.
- A runtime directory in a shared temporary directory can be created first by
  another local user. The result is a refusal to start with the reason, never a
  listener in a directory someone else controls.
- Files in a temporary directory can be cleared by the operating system. A
  socket placed there is exposed to that; a socket in the data directory is
  not.

## Open items

- The standalone server's approval socket and the session holder's sockets
  still follow their earlier behaviour. Adopting this decision for them is
  separate work.
