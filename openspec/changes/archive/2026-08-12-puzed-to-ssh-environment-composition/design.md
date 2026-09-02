## Context

See proposal.md. This was Phase 4 convergence, run only after the SSH and Puzed
provider journeys were individually accepted, and it depended on the official
SSH extension, the official Puzed extension foundation, and the Puzed VM
provisioning experience.

## Goals / Non-Goals

Goals: Puzed becomes a composed infrastructure provider rather than a
special-case or duplicate workspace runtime, with complete lifecycle and
recovery evidence.

Non-Goals: a second SSH implementation inside the Puzed extension, and any
coupling that would let a Terminay action change VM power state implicitly.

## Decisions

- **Only the SSH extension resolves private credentials.** Puzed receives public
  keys and opaque dependency handles. This is the security boundary of the whole
  composition: a management provider must never be able to read a runtime
  provider's secrets.
- **Machine-scoped host identity is independent of the dial address.** DHCP can
  move a VM without changing which machine it is, so an address change updates
  the binding and never retargets a live session and never selects or recreates
  another VM.
- **Project creation is atomic after validation, but provider operations stay
  recoverable.** A VM that has already been created is not orphaned by a failed
  project creation; recovery is explicit.
- **The two lifecycles are independent in both directions.** A Puzed API outage
  can occur while an existing SSH workspace stays live, and vice versa, with
  accurate separate status. Project close and server shutdown never change VM
  power, and external VM deletion leaves a detached project rather than deleting
  Terminay state.
- **Removal is reference-aware.** A referenced extension cannot be removed, and
  disable or remove never cascades namespaced provider data.
- **Arbitrary Puzed VMs never enter the flow** — only `system:Terminay` tagged
  inventory.

## Risks / Trade-offs

Composition adds a versioned RPC surface between two independently versioned
extensions, so incompatibility is a real failure mode; the change requires exact
recovery behaviour when either dependency is unavailable or incompatible rather
than a silent degrade.

## Migration Plan

Composed identities and revisions are persisted so a server restart recovers the
binding, and replay of an idempotent open is proven rather than assumed.
