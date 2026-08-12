# Puzed-to-SSH environment composition

## Goal

Converge existing/new/stopped `system:Terminay` Puzed VM workflows with the
official SSH provider into durable projects without leaking credentials or
coupling project and VM lifecycle.

## Delivery phase

Phase 4 convergence after the SSH and Puzed provider journeys are individually
accepted.

## Dependencies

- [Task 46](./46-official-ssh-extension.md)
- [Task 47](./47-official-puzed-extension-foundation.md)
- [Task 48](./48-puzed-vm-provisioning-experience.md)

## Governing specifications

- [Project environments](../features/project-environments.md)
- [Puzed project environments](../features/puzed-project-environments.md)
- [SSH project environments](../features/ssh-project-environments.md)

## Implementation slices

- [ ] Finalize versioned provider-dependency RPC for public-key creation,
  readiness/trust, runtime open, status, and credential/address/root updates.
- [ ] Persist composed Puzed management + SSH runtime identities/revisions and
  stable machine-scoped host identity independent of DHCP dial address.
- [ ] Atomically create projects only after environment/root validation while
  retaining recoverable provider operations that have already created a VM.
- [ ] Keep Puzed API outage, VM lifecycle state, address changes, and SSH runtime
  status independent; never retarget live sessions on address change.
- [ ] Implement reference-aware disable/update/remove across both extensions and
  exact recovery when either dependency is unavailable/incompatible.
- [ ] Prove project close/server shutdown never changes VM power and explicit VM
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
