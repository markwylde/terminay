# Puzed VM provisioning experience

## Goal

Create new SSH-ready Puzed VMs through the focused progressive Terminay flow and
maintain a durable idempotent provisioning saga through address/SSH readiness.

## Delivery phase

Phase 3, in parallel with [Task 46](./46-official-ssh-extension.md), using the
stable SSH provider contract/test double until live convergence.

## Dependencies

- [Task 45](../tasks_completed/45-project-environment-and-extension-ui.md)
- [Task 47](../tasks_completed/47-official-puzed-extension-foundation.md)

## Governing specification

- [Puzed project environments](../features/puzed-project-environments.md)

## Parallel work streams

### Progressive form

- [ ] Implement Platform, SSH-capable image, size preset/custom, automatic/
  selected host, default/custom network, name, project access/root, advanced,
  review, and sticky create schemas/actions.
- [ ] Consume org defaults and preserve async selections; show architecture,
  capacity, bridge, image, disk, and scope disabled reasons.
- [ ] Keep blank/non-cloud-init images outside automatic project creation.

### Key and create transaction

- [ ] Generate a dedicated SSH key through the SSH broker; keep private key in
  its vault ownership and send only public key with `ssh_key_only`/`vms` access.
- [ ] Include the exact `system:Terminay` machine tag in every create request
  and retain the resulting machine-to-key binding before it can be listed/opened.
- [ ] Persist idempotency and operation state before POST, persist VM/job ids
  immediately, and retry ambiguous submission with the same key.
- [ ] Use Puzed-composed defaults and authoritative create validation.

### Durable saga and recovery

- [ ] Resume shared SSE/refetch through provisioning/boot/address; then invoke
  bounded SSH readiness and host trust as independent phases.
- [ ] Support Run in background and recovery after UI/client/server restart.
- [ ] On every failure preserve the VM and offer Retry/Edit SSH/Start/Stop/
  Reboot/Delete/Open in Puzed; never auto-delete or fall back Local.

## Acceptance checks

- Lost create response/restart creates exactly one VM and resumes the same job.
- Private key sentinel never appears in the Puzed request or client/audit/log.
- Every created VM carries `system:Terminay`; untagged VMs never enter the
  Terminay inventory or opening flow.
- Job success waits for observed address, SSH, and trust independently.
- The form matches Puzed's drilldown behavior across wide/narrow clients.

## Definition of done

An authorized user can create a VM in the background and recover it to a ready
SSH descriptor without duplicate or silently deleted infrastructure.
