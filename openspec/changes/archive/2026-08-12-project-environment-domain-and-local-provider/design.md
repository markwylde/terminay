## Context

See proposal.md. This was the phase-1 foundation delivered in parallel with the
extension API, manifest, and host work; it establishes the domain those
providers later plug into.

## Goals / Non-Goals

Goals:
- One canonical environment domain that every project operation can resolve
  through a stable environment identity.
- A safe built-in **This server** adapter that is a production authority, not a
  special case.
- Migration and recovery proven, with all existing local behaviour unchanged.

Non-Goals:
- Enabling npm-installed providers.
- Adding a second local authority alongside the existing services.
- Project retargeting between environments.

## Decisions

**The environment domain is a separate revisioned repository.** Environments,
profiles, revisions, capabilities, and statuses are runtime-validated records in
a crash-safe store kept apart from workspace state, so an environment failure
cannot corrupt layout and a workspace migration cannot silently rewrite routing.

**This server is reserved and undeletable.** Every legacy project and session
migrates to it idempotently, preserving all identities and layouts. Being
undeletable is what makes the migration total: there is always a valid
environment for a project to be bound to.

**Authority comes from the authenticated transport, never from `ClientHello`.**
Actor, scope, project claim, and explicit permissions are bound to the
authenticated transport in embedded, standalone, and test compositions alike.
This is the security boundary the change exists to close: a forged client id or
admin claim in a hello previously reached production dispatch.

**Every workspace mutation resolves an explicit project scope.** Source and
destination project scope is derived for panel create, update, close, and move,
and for generic project update. Object-derived commands no longer bypass the
project claim.

**Cross-environment moves fail before mutation.** A panel move across
environments, or a project/session environment mismatch, is rejected atomically
before any process, file, or workspace mutation occurs. Generic project updates
are presentation-only; a root change must use the prepared command.

**The built-in provider uses the existing services.** This server routes to the
existing terminal, filesystem, Git, and shell services through the internal
registry and router contract, so there is no second local authority to keep in
sync. Capability and status queries return bounded, safe presentation DTOs.

## Risks / Trade-offs

- A schema migration touching every project and session risks identity or
  layout drift. Mitigated by idempotent migration proven against schema-v2
  fixtures that assert all ids and state are preserved.
- Adding an indirection layer in front of every project operation risks
  regressing local behaviour. Mitigated by proving existing Local launch, files,
  Git, recording, agents, MCP, macros, project moves, reconnect, and server
  restart are unchanged, and by requiring This server to pass the existing
  server-core tests with no second Local authority.

## Migration Plan

Schema-v2 fixtures migrate exactly once to the reserved This server
environment, preserving every id and all state. The migration is idempotent, so
a repeated run is a no-op. Existing projects continue to behave identically;
npm-installed providers remain disabled.
