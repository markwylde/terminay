# Puzed-to-SSH environment composition

## Goal

Converge existing/new/stopped `system:Terminay` Puzed VM workflows with the
official SSH provider into durable projects without leaking credentials or
coupling project and VM lifecycle.

## Delivery phase

Phase 4 convergence after the SSH and Puzed provider journeys are individually
accepted.

## Dependencies

- [Task 46](../tasks_completed/46-official-ssh-extension.md)
- [Task 47](../tasks_completed/47-official-puzed-extension-foundation.md)
- [Task 48](../tasks_completed/48-puzed-vm-provisioning-experience.md)

## Governing specifications

- [Project environments](../features/project-environments.md)
- [Puzed project environments](../features/puzed-project-environments.md)
- [SSH project environments](../features/ssh-project-environments.md)

## Implementation slices

- [x] Finalize versioned provider-dependency RPC for public-key creation,
  readiness/trust, runtime open, status, and credential/address/root updates.
- [x] Persist composed Puzed management + SSH runtime identities/revisions and
  stable machine-scoped host identity independent of DHCP dial address.
- [x] Atomically create projects only after environment/root validation while
  retaining recoverable provider operations that have already created a VM.
- [x] Keep Puzed API outage, VM lifecycle state, address changes, and SSH runtime
  status independent; never retarget live sessions on address change.
- [x] Implement reference-aware disable/update/remove across both extensions and
  exact recovery when either dependency is unavailable/incompatible.
- [x] Prove project close/server shutdown never changes VM power and explicit VM
  deletion never silently deletes the Terminay project/credentials.

## Acceptance checks

- Existing tagged running/stopped and newly provisioned VMs open identical
  SSH-backed terminal/filesystem projects after their distinct management
  journeys; arbitrary Puzed VMs never enter the flow.
- Only the SSH extension resolves private credentials; Puzed receives public
  keys and opaque dependency handles.
- Puzed management can fail while an existing SSH workspace remains live, and
  vice versa, with accurate separate status.
- External deletion or changed host key never selects/recreates another VM.

## Definition of done

Puzed is a composed infrastructure provider rather than a special-case or
duplicate workspace runtime, with complete lifecycle and recovery evidence.

## Completion evidence

- `packages/server-core/test/puzed-ssh-composition.test.mjs` proves the
  privileged dependency authorization, standards-readable dedicated key,
  secret rollback, stable identity/address revisions, restart recovery,
  independent outage state, atomic canonical open, and lifecycle isolation.
- `packages/server-core/test/puzed-ssh-packed-composition.e2e.test.mjs` packs
  both official extensions and drives a real Docker OpenSSH server through
  strict explicit trust, root validation, project creation, restart, and
  idempotent replay. Run it with `npm run test:e2e:puzed-ssh` and the two
  documented `TERMINAY_*_PLUGIN_REPO` checkout paths.
- Official Puzed provider tests prove tagged-only inventory, identical stable
  SSH descriptors for retained running/stopped machines, non-cascading project
  close/delete behavior, external deletion identity retention, and bounded
  recovery. Official SSH tests prove exact host-key mismatch/replacement and
  stable logical identity across dial-address changes.
- `packages/server-core/test/extension-installer.test.mjs` proves referenced
  extensions cannot be removed and disable/remove never cascades namespaced
  provider data.
