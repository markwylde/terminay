## MODIFIED Requirements

### Requirement: Worker-scoped bridge validation

Bridge choices SHALL be discovered from the selected worker's authoritative `/workers/{id}/bridges` route and never from the organization-wide bridge list. Automatic and explicit host selection SHALL use the same compatibility source, so the form cannot offer a bridge Puzed will reject for the selected worker. Changing the worker, the placement mode, the network mode, or refreshing provider options SHALL revalidate the dependent host and bridge selections; an incompatible stale bridge SHALL be cleared or blocked with a safe actionable explanation before submit while the rest of the draft remains intact. Immediately before create, the server SHALL repeat the worker-scoped compatibility check before generating a binding or POSTing, without weakening the Puzed create request as the source of truth. If Puzed returns `bridge_worker_mismatch` because infrastructure changed, Terminay SHALL preserve the draft, refresh its choices, identify the invalid selection, and expose only the bounded rejection so the user can correct and resubmit without a duplicate VM and without raw provider errors or secrets.

#### Scenario: Worker changed
- **WHEN** a user changes the selected worker after picking a bridge
- **THEN** the bridge is revalidated and cleared with an explanation if incompatible, leaving the rest of the draft intact

#### Scenario: Automatic placement uses the same source
- **WHEN** placement is automatic rather than explicit
- **THEN** bridge compatibility is resolved from the same worker-scoped source as an explicit host selection

#### Scenario: Dependent selection revalidated
- **WHEN** the placement mode, the network mode, or a refreshed option set changes
- **THEN** dependent host and bridge selections are revalidated and a stale incompatible value is cleared or blocked before submit

#### Scenario: Server-side preflight before create
- **WHEN** a create is submitted
- **THEN** the server repeats the worker-scoped compatibility check before generating an SSH binding or POSTing, and the Puzed create request remains authoritative

#### Scenario: Late bridge mismatch
- **WHEN** Puzed rejects a create with `bridge_worker_mismatch`
- **THEN** the draft is preserved, choices are refreshed, the invalid selection is identified, a bounded rejection is shown, and no duplicate VM is created

#### Scenario: Rejection commits nothing
- **WHEN** a compatibility preflight or a Puzed compatibility rejection ends a create attempt
- **THEN** no project-environment or operation record is committed and no raw provider error or secret is exposed

### Requirement: Address and SSH readiness after job success

Job success SHALL NOT imply that an IP or SSH is ready. After success, the provider SHALL read machine interfaces, SHALL wait for an observed or static address, then SHALL hand a descriptor to SSH for a bounded connection and readiness check. A guest that has no reachability SHALL remain retryable in the SSH readiness phase and SHALL NOT be reported ready.

#### Scenario: Job succeeds without address
- **WHEN** the Puzed job succeeds but no address is observed yet
- **THEN** the operation waits for an address before attempting SSH and is not reported as ready

#### Scenario: Address answers nothing
- **WHEN** a guest address is observed but the guest does not answer SSH
- **THEN** the operation stays in the SSH readiness phase as retryable and is never reported ready
