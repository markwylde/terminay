## Context

See proposal.md. This was the phase 6 release-convergence slice after tasks
41–50: the platform contracts were already specified, so the work was to prove
them, document them, and make the official packages reproducible rather than to
add behaviour.

## Goals / Non-Goals

Goals:
- A third-party author can build, pack, test, and install a conformant provider
  using public documentation only, with no internal imports and no renderer code.
- An operator can install, back up, restore, update, roll back, disable, remove,
  diagnose, and respond to a compromise from written runbooks.
- Mixed Local, SSH, and Puzed environments survive client disconnect and preserve
  every authority, session, draft, VM, and failure boundary the feature contracts
  specify.

Non-Goals:
- Changing the Extension API, the manifest, the permission model, or provider
  behaviour.
- Provisioning experience work, which stayed with the Puzed VM provisioning task.

## Decisions

- **No specification delta.** Everything delivered here is documentation,
  release supply chain, acceptance testing, and measurement. The behaviour under
  test was already normative in the extension platform, project environments,
  SSH, and Puzed specifications, so this change carries `skip_specs: true`.
- **Public docs are the author's only input.** The conformance CLI and example
  provider exist so that the documented contract can be exercised without
  reaching into repository internals; an author who needs an internal import has
  found a documentation defect.
- **Official packages come from separate repository workflows.** The official
  providers are published as their own packages from their own workflows, which
  keeps the ecosystem contract identical for first-party and third-party
  providers.
- **Offline install fails actionably.** A clean supported server needs no system
  Node, npm, or compiler and installs official or custom packages from npmjs; if
  npmjs is unreachable the failure names that cause rather than presenting a
  generic error.
- **Security acceptance is sentinel-shaped.** Hostile package, IPC,
  authentication, project-claim, secret, host-key, redirect, cross-environment,
  and no-fallback suites each assert a specific boundary refusal, so a regression
  surfaces as a named failure rather than as a subtly weakened guard. The
  no-fallback sentinel is the important one: a missing or failed provider must
  never fall back to the Terminay Server machine.

## Risks / Trade-offs

- Publishing a public Extension API contract makes it expensive to change later.
  Accepted deliberately: an ecosystem needs a stable, documented surface.
- Measurement suites bound resource usage at the values observed at the time;
  they will need revisiting as providers grow.

## Open Questions

The first two acceptance items were reopened on 2026-08-13 after the shipped UI
showed that installed provider creation actions and Puzed dynamic options were
not connected end to end. Task 53 owns the corrective journey and its evidence.
