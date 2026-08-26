# Puzed VM provisioning experience

## Reopened release status (2026-08-26)

This task was moved back from completed history after a user observed the
released `v3.5.3` VM-create journey to allow an incompatible worker/bridge
selection. The observed failure was: `HTTP 409 bridge_worker_mismatch`.

The earlier completed items below remain historical evidence. They do not prove
that the current live form prevents this invalid combination or gives the user
a recoverable path when Puzed rejects it. The unchecked corrective work is the
remaining scope for this task.

## Goal

Create new SSH-ready Puzed VMs through the focused progressive Terminay flow and
maintain a durable idempotent provisioning saga through address/SSH readiness.

## Delivery phase

Reopened corrective work against the released `v3.5.3` journey. The original
delivery ran in parallel with [Task 46](../tasks_completed/46-official-ssh-extension.md),
using the stable SSH provider contract/test double until live convergence.

## Dependencies

- [Task 45](../tasks_completed/45-project-environment-and-extension-ui.md)
- [Task 47](../tasks_completed/47-official-puzed-extension-foundation.md)

## Governing specification

- [Puzed project environments](../features/puzed-project-environments.md)

## Parallel work streams

### Progressive form

- [x] Implement Platform, SSH-capable image, size preset/custom, automatic/
  selected host, default/custom network, name, project access/root, advanced,
  review, and sticky create schemas/actions.
- [x] Consume org defaults and preserve async selections; show architecture,
  capacity, bridge, image, disk, and scope disabled reasons.
- [x] Keep blank/non-cloud-init images outside automatic project creation.

### Key and create transaction

- [x] Generate a dedicated SSH key through the SSH broker; keep private key in
  its vault ownership and send only public key with `ssh_key_only`/`vms` access.
- [x] Include the exact `system:Terminay` machine tag in every create request
  and retain the resulting machine-to-key binding before it can be listed/opened.
- [x] Persist idempotency and operation state before POST, persist VM/job ids
  immediately, and retry ambiguous submission with the same key.
- [x] Use Puzed-composed defaults and authoritative create validation.

### Durable saga and recovery

- [x] Resume shared SSE/refetch through provisioning/boot/address; then invoke
  bounded SSH readiness and host trust as independent phases.
- [x] Surface host-key trust and bounded SSH retry actions while the durable VM
  operation is pending; re-verify after approval before marking the connection
  ready.
- [x] Keep an actionless provisioning status card renderable: public status-card
  facts and actions are optional, so their absence must not invalidate and hide
  the complete provider/connection snapshot.
- [x] Support Run in background and recovery after UI/client/server restart.
- [x] Serialize concurrent snapshot-driven recovery of one durable operation,
  so a successful address/SSH transition is committed exactly once rather than
  being lost to a stale compare-and-swap after the SSH binding has been made.
- [x] Project live SSH readiness in the connection chooser while the durable
  operation remains pending, distinguishing VM creation from SSH connection.
- [x] On every failure preserve the VM and offer Retry/Edit SSH/Start/Stop/
  Reboot/Delete/Open in Puzed; never auto-delete or fall back Local.

### Reopened worker and bridge correctness

- [x] Filter bridge choices from the currently selected worker so the form does
  not offer a bridge that Puzed will reject for that worker. Automatic and
  explicit host selection must use the same compatibility source.
- [x] Revalidate dependent host and bridge selections whenever the selected
  worker, placement mode, network mode, or refreshed provider options change.
  Clear or block a stale incompatible value with a safe, actionable explanation
  before submit.
- [x] Add an authoritative server-side preflight for the final worker/bridge
  combination immediately before create, without weakening Puzed's create
  request as the source of truth.
- [x] Recover safely from a Puzed compatibility rejection, including
  `bridge_worker_mismatch`: preserve the entered form state, refresh the
  applicable options, identify the invalid selection, and allow correction and
  resubmission without creating duplicate infrastructure.
- [ ] Perform and record manual acceptance in the released Puzed form using a
  worker/bridge combination that was previously rejectable. Confirm incompatible
  bridges are unavailable or blocked before create, and a valid selection can
  continue through the existing provisioning flow.

## Previously completed acceptance evidence

- Lost create response/restart creates exactly one VM and resumes the same job.
- Private key sentinel never appears in the Puzed request or client/audit/log.
- Every created VM carries `system:Terminay`; untagged VMs never enter the
  Terminay inventory or opening flow.
- Job success waits for observed address, SSH, and trust independently.
- The form matches Puzed's drilldown behavior across wide/narrow clients.

## Reopened acceptance checks

- [ ] The released-form reproduction that returned `HTTP 409
  bridge_worker_mismatch` cannot submit the incompatible worker/bridge pair.
- [x] A changed worker or refreshed option set cannot leave an incompatible
  bridge in the create payload.
- [x] A server-side preflight or authoritative Puzed rejection leaves the form
  recoverable, does not create a duplicate VM, and does not expose raw provider
  errors or secrets.
- [ ] Manual Puzed acceptance confirms both an invalid-pair correction and a
  successful valid VM create through the real form.

Evidence (2026-08-26): Puzed provider tests prove worker-scoped bridge option
loading, paginated final-pair preflight before SSH binding generation or POST,
and a bounded late `bridge_worker_mismatch` rejection. Project-environment
operation tests prove that the rejection commits no environment/operation
record; the declarative form contract reloads option sources and clears a stale
selection while retaining the draft. `npm run test --workspace
terminay-plugin-puzed`, `npm run test:project-environment-ui`, server-core
project-environment operations, and root typecheck passed. The real released
Puzed-account correction/retry/create acceptance remains explicitly open.

## Definition of done

This task remains open. It is complete only when the real Puzed VM form and
server path prevent or safely recover from an incompatible worker/bridge
selection, including the observed `HTTP 409 bridge_worker_mismatch`, and the
reopened manual acceptance checks have recorded evidence. The prior durable
provisioning guarantees remain required: an authorized user can create a VM in
the background and recover it to a ready SSH descriptor without duplicate or
silently deleted infrastructure.
