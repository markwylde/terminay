# ADR-0111: Work done as the service account runs on the release's own runtime, and "ready" means usable

Status: accepted
Date: 2026-11-13

## Context

An installed server runs as an unprivileged account, often a dedicated
`terminay` account. The CLI is run by whoever is at the keyboard, usually root
or a sudo user, on whatever Node.js they installed. nvm and fnm put Node.js
inside a private home. When the CLI re-ran its socket client as the service
account with its own Node.js, the account could not execute it, and the
operator saw a different failure instead.

The CLI also called a server "ready" when its health endpoint said so. That is
the server's own opinion of its startup. It does not show that the operator
can reach the server's socket or that a terminal can start. On a stock VM
both were broken while every command reported success.

## Decision

1. Anything the CLI runs as the service account runs on the Node.js runtime
   shipped in the installed release, which the service itself already runs
   on. The operator's Node.js and the CLI's own installation never cross the
   root-to-service-account boundary. The CLI's own Node.js is a fallback only
   when a release ships no runtime.
2. A failed launch is classified from what the launched process printed,
   never from the command line it was given.
3. "Ready", wherever the CLI reports it for an installed server, means
   usable: the health endpoint is ready, the approval socket answers when
   reached the way operator commands reach it, and the server can start its
   default shell. The server offers a read-only `probe-terminal` operation on
   its owner-only approval socket for that last check.
4. The same checks, with one fix per failure, are available on demand as
   `terminay daemon doctor`.

## Consequences

- The supported operator Node.js setups widen to anything that can run the
  CLI as the invoking user. No system-wide Node.js is required.
- A release must keep shipping an executable runtime at `bin/node`.
- Installs whose terminals were silently broken now fail readiness, so an
  upgrade rolls back until the cause is fixed. The failure names the cause.
- The approval socket gains one read-only operation. It grants no authority
  beyond what owning the socket already grants.
