## Context

See proposal.md. This was Phase 2 work following the Extension API contract,
running in parallel with environment-routed project services, extension
installation and management, and the project environment and extension UI. It
depends on the extension API, manifest, and host work.

## Goals / Non-Goals

Goals:
- A genuinely separate, conformant extension package that proves the public
  extension API is sufficient.
- Manage and describe existing Puzed VMs safely.
- Produce a stable, tested SSH dependency descriptor for composition.

Non-Goals:
- Provisioning new VMs. That journey is deliberately out of scope here.
- Any Puzed UI inside Terminay's own bundle.

## Decisions

- **Package boundary is enforced by dependency direction.** The package depends
  on the SSH extension and imports no internal Terminay or Puzed UI, so the
  public extension API carries all of it.
- **Generated contract, not hand-written DTOs.** The client is generated from
  the current Go-authored OpenAPI contract, so provider drift is a regeneration
  rather than a manual edit.
- **Transport is exact-origin and bounded.** HTTPS to an exact origin, bearer
  key held in the vault, `/me` organization and scope validation before use,
  and a safe URL, redirect, and error policy so keys and scopes never reach
  clients or logs and never cross a redirect.
- **Only tagged machines exist.** Inventory is paginated and filtered to
  `system:Terminay`. Unrelated machines are never selectable, and an untagged VM
  is rejected outright.
- **A tagged VM without a retained key is not openable.** Rather than offering
  arbitrary credential adoption, a tagged VM with no retained private-key
  binding renders as non-openable.
- **One stream per profile organization.** A single authenticated resumable SSE
  stream carries payload-free invalidations; the client refetches the exact
  resource. This avoids polling and avoids putting resource content on the
  event channel.
- **Lifecycle is idempotent and revisioned.** Start, stop, resume, reboot, and
  delete carry revisions, report operation conflicts and disk disposition, and
  keep management status independent of project state, so lifecycle never
  couples to project close and never assumes SSH readiness.

## Risks / Trade-offs

- A separate published package adds release coordination; the payoff is proof
  that the extension API is complete enough for a real infrastructure provider.
- Payload-free invalidations cost an extra refetch per event, chosen so event
  delivery cannot leak resource content and so state survives client disconnect
  and server restart through refetch rather than replayed payloads.
- SSH handoff is exercised through test doubles at this stage; real composed
  acceptance belongs to the composition work.
