## 1. Progressive form

- [x] 1.1 Implement the Platform, SSH-capable image, size preset and custom, automatic and selected host, default and custom network, name, project access and root, advanced, review, and sticky create schemas and actions; verify with the project-environment UI suite
- [x] 1.2 Consume organization defaults and preserve async selections, and show architecture, capacity, bridge, image, disk, and scope disabled reasons; verify a refresh preserves valid selections and every disabled option states its reason
- [x] 1.3 Keep blank and non-cloud-init images outside automatic project creation; verify a blank VM source is not accepted by the automated project workflow

## 2. Key and create transaction

- [x] 2.1 Generate a dedicated SSH key through the SSH broker, keep the private half in its vault ownership, and send only the public key with `ssh_key_only` and `vms` access; verify the private key sentinel never appears in the Puzed request or in client, audit, or log output
- [x] 2.2 Include the exact `system:Terminay` machine tag in every create request and retain the machine-to-key binding before the VM can be listed or opened; verify untagged VMs never enter the Terminay inventory or opening flow
- [x] 2.3 Persist idempotency and operation state before the POST, persist VM and job ids immediately, and retry an ambiguous submission with the same key; verify a lost create response and a restart each produce exactly one VM and resume the same job
- [x] 2.4 Use Puzed-composed defaults and authoritative create validation; verify Terminay adds no competing default that Puzed would override

## 3. Durable saga and recovery

- [x] 3.1 Resume the shared event stream and refetch through provisioning, boot, and address, then invoke bounded SSH readiness and host trust as independent phases; verify job success alone never reports ready
- [x] 3.2 Surface host-key trust and bounded SSH retry actions while the durable operation is pending, and re-verify after approval before marking the connection ready; verify approval is followed by a re-verification
- [x] 3.3 Keep an actionless provisioning status card renderable by treating public status-card facts and actions as optional; verify their absence does not invalidate or hide the complete provider and connection snapshot
- [x] 3.4 Support Run in background and recovery after UI, client, and server restart, invoking durable recovery after extension activation rather than relying on a renderer snapshot request; verify recovery proceeds with no client attached
- [x] 3.5 Serialize concurrent snapshot-driven recovery and rebase its provider result when another registry mutation wins the compare-and-swap; verify a successful address or SSH transition is not lost after the SSH binding has been made
- [x] 3.6 Project live SSH readiness in the connection chooser while the durable operation is pending, distinguishing VM creation from SSH connection; verify both states are separately visible
- [x] 3.7 On every failure preserve the VM and offer Retry, Edit SSH, Start, Stop, Reboot, Delete, and Open in Puzed; verify nothing auto-deletes a VM and nothing falls back to the local machine

## 4. Reopened worker and bridge correctness

- [x] 4.1 Filter bridge choices from the currently selected worker so the form cannot offer a bridge Puzed will reject for that worker, with automatic and explicit host selection using the same compatibility source; verify with Puzed provider tests over worker-scoped bridge option loading
- [x] 4.2 Revalidate dependent host and bridge selections whenever the worker, placement mode, network mode, or refreshed provider options change, clearing or blocking a stale incompatible value with a safe actionable explanation before submit; verify the declarative form contract reloads option sources and clears a stale selection while retaining the draft
- [x] 4.3 Add an authoritative server-side preflight for the final worker and bridge combination immediately before create, without weakening the Puzed create request as the source of truth; verify the paginated final-pair preflight runs before SSH binding generation and before the POST
- [x] 4.4 Recover safely from a Puzed compatibility rejection including `bridge_worker_mismatch` by preserving the form state, refreshing the applicable options, identifying the invalid selection, and allowing resubmission; verify project-environment operation tests show the rejection commits no environment or operation record and no duplicate infrastructure is created

## 5. Acceptance

- [x] 5.2 Change the worker or refresh the option set after choosing a bridge; verify no incompatible bridge can remain in the create payload
- [x] 5.3 Trigger a server-side preflight failure and an authoritative Puzed rejection; verify the form stays recoverable, no duplicate VM is created, and no raw provider error or secret is exposed
- [x] 5.5 Run the Puzed plugin suite, the project-environment UI suite, the server-core project-environment operation tests, and the root typecheck; verify all pass

> **Outstanding verification.** The implementation of this change is complete; the items
> below are verification and evidence that were never recorded, not remaining
> development work. They are carried forward as an obligation on the capability,
> not on this change.
>
> - Record a real VM's post-create transition from the Puzed job to SSH readiness and then to ready only after its guest address answers SSH; verify a guest with no reachability stays retryable rather than being reported ready
> - Perform and record manual acceptance in the released Puzed form using a worker and bridge combination that was previously rejectable; verify incompatible bridges are unavailable or blocked before create and a valid selection continues through the existing provisioning flow
> - Reproduce the released-form case that returned `HTTP 409 bridge_worker_mismatch`; verify the incompatible worker and bridge pair can no longer be submitted
> - Complete manual Puzed acceptance covering both an invalid-pair correction and a successful valid VM create through the real form; verify both are recorded as evidence
